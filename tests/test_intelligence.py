"""Session-author tests; not independent stage acceptance or organizer tests.

Oracles: actual canonical engine and independent brute force ordering. No stored
control answers enter production. Run: python -m unittest discover -s tests -p test_intelligence.py
"""
import hashlib
import json
import math
from copy import deepcopy
from pathlib import Path
import unittest

from fastapi.testclient import TestClient

from backend.app.canonical_adapter import evaluate
from backend.app.case_loader import CaseRepository
from backend.app.constraints import RULES
from backend.app.contracts import EPS, canonical_json
from backend.app.decision import recompute_decision, evaluation_input
from backend.app.decision_model import normalize_weights, rank
from backend.app.intelligence import (Lock, acceptance_boundary, analyze, change_cost,
    eligible_without_budget, matches_locks, recovery, research_rows, transition_map, tradeoffs)
from backend.app.main import create_app
from backend.app.passport import passport
from backend.app.search import get_population

ROOT = Path(__file__).resolve().parents[1]


class IntelligenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.repo = CaseRepository()
        cls.snapshot = cls.repo.load()
        cls.population = get_population(cls.snapshot)
        cls.rows = cls.population['rows']
        cls.bounds = cls.population['reference']['bounds']
        cls.config = json.loads((ROOT / 'config/m3_decision.json').read_bytes())
        cls.weights = cls.config['request']['weights']
        cls.official_before = canonical_json(recompute_decision(cls.config))
        cls.base = rank(cls.rows, cls.weights, cls.bounds, 'BASE')
        cls.bad = next(r for r in cls.rows if not r['scenarios']['BASE']['ok'])
        cls.saved = cls.base[0]
        cls.client = TestClient(create_app())

    def request(self, current=None, **options):
        return {'format_version': 'kosmos-intelligence/1', 'search': deepcopy(self.config['request']),
                'current': evaluation_input(current or self.bad), **options}

    def test_01_recovery_bruteforce_minimality_engine_deltas(self):
        result = analyze(self.request())
        self.assertFalse(result['current']['feasible'])
        self.assertGreater(len(result['recovery']), 0)
        self.assertLessEqual(len(result['recovery']), 3)
        self.assertEqual(len({p['candidate']['portfolio_id'] for p in result['recovery']}), len(result['recovery']))
        before = evaluate(evaluation_input(self.bad))
        for p in result['recovery']:
            computed = evaluate(p['request'])
            self.assertTrue(computed['scenarios']['BASE']['ok'])
            for key, delta in p['delta'].items():
                self.assertAlmostEqual(delta, computed['metrics'][key] - before['metrics'][key], places=9)
            expected = [r['id'] for r in before['scenarios']['BASE']['diagnostics'] if not r['ok']]
            self.assertEqual(p['resolved_constraints'], expected)
        # Independent ordering: removed service count, changed retained modes,
        # then the existing rank. Do not call the production change counter.
        prior = {r['lot_id']: r['mode_id'] for r in self.bad['selection']}
        def key(row):
            new = {r['lot_id']: r['mode_id'] for r in row['selection']}
            return (len(prior.keys() - new.keys()), sum(prior[k] != new[k] for k in prior.keys() & new.keys()), row['rank'])
        a = next(p for p in result['recovery'] if 'A_MINIMAL_CHANGE' in p['strategies'])
        self.assertEqual(a['candidate']['portfolio_id'], min(self.base, key=key)['portfolio_id'])
        b = next(p for p in result['recovery'] if 'B_MAX_VPUB' in p['strategies'])
        c = next(p for p in result['recovery'] if 'C_MIN_C0' in p['strategies'])
        self.assertEqual(b['candidate']['metrics']['vpub_mrub_per_year'], max(r['metrics']['vpub_mrub_per_year'] for r in self.base))
        self.assertEqual(c['candidate']['metrics']['c0_mrub'], min(r['metrics']['c0_mrub'] for r in self.base))

    def test_02_lot_and_mode_locks_differ(self):
        lot = analyze(self.request(locks=[{'lot_id': 'FLOOD'}]))
        mode = analyze(self.request(locks=[{'lot_id': 'FLOOD', 'mode_id': 'A'}]))
        ids_lot = {r['portfolio_id'] for r in lot['explorer']['points']}
        ids_mode = {r['portfolio_id'] for r in mode['explorer']['points']}
        self.assertTrue(ids_mode < ids_lot)
        for result in (lot, mode):
            for p in result['recovery']:
                choice = {r['lot_id']: r['mode_id'] for r in p['candidate']['selection']}
                self.assertIn('FLOOD', choice)
                if result is mode:
                    self.assertEqual(choice['FLOOD'], 'A')
        self.assertTrue(matches_locks(mode['recovery'][0]['candidate'], [Lock(lot_id='FLOOD', mode_id='A')]))

    def test_03_no_solution_and_budget_only_diagnosis(self):
        blocked = [{'lot_id': r['lot_id'], 'mode_id': 'C'} for r in self.saved['selection']]
        result = analyze(self.request(context='RESEARCH', budget_cap=1000000, locks=blocked))
        self.assertEqual(result['status'], 'NO_SOLUTION')
        self.assertEqual(result['no_solution_reason'], 'NON_BUDGET_CONSTRAINTS_OR_LOCKS')
        self.assertIsNone(result['budget']['minimum_feasible_budget'])
        self.assertIsNone(result['recommendation'])
        self.assertEqual(result['transition_map'], [])
        result = analyze(self.request(context='RESEARCH', budget_cap=0))
        self.assertTrue(result['budget']['budget_only_blocker'])
        minimum = result['budget']['minimum_feasible_budget']
        self.assertEqual(minimum, min(r['metrics']['c0_mrub'] for r in self.rows if all(v for k, v in r['scenarios']['BASE']['checks'].items() if k != 'c0_limit')))
        at = analyze(self.request(context='RESEARCH', budget_cap=minimum))
        self.assertGreater(at['feasible_count'], 0)

    def test_04_exact_breakpoint_and_canonical_epsilon(self):
        c0 = self.saved['metrics']['c0_mrub']
        for cap, passed in ((c0, True), (c0 - 1e-6, False), (c0 + 1e-6, True), (c0 - EPS / 2, True)):
            result = analyze(self.request(self.saved, context='RESEARCH', budget_cap=cap))
            self.assertEqual(result['current']['feasible'], passed)
            self.assertEqual(result['budget']['current_breakpoint'], c0)
        boundary = acceptance_boundary(c0)
        self.assertTrue(c0 <= boundary + EPS)
        self.assertFalse(c0 <= math.nextafter(boundary, -math.inf) + EPS)
        self.assertEqual(acceptance_boundary(0), 0)
        self.assertEqual(acceptance_boundary(1e-10), 0)

    def test_05_monotonicity_and_transition_intervals_exact(self):
        eligible = eligible_without_budget(self.rows, 'BASE', [])
        intervals = transition_map(eligible, self.weights, self.bounds, 'BASE')
        previous_ids = None
        for cap in (2000, 1300, 1180, 1150, 1100, 0):
            ranked = rank(research_rows(self.rows, 'BASE', cap), self.weights, self.bounds, 'RESEARCH')
            ids = {r['portfolio_id'] for r in ranked}
            if previous_ids is not None:
                self.assertTrue(ids <= previous_ids)
            previous_ids = ids
        for index, interval in enumerate(intervals):
            lower = interval['lower_inclusive']
            at = rank(research_rows(eligible, 'BASE', lower), self.weights, self.bounds, 'RESEARCH')
            below = rank(research_rows(eligible, 'BASE', math.nextafter(lower, -math.inf)), self.weights, self.bounds, 'RESEARCH')
            self.assertEqual(at[0]['portfolio_id'], interval['portfolio_id'])
            self.assertEqual(below[0]['portfolio_id'] if below else None, intervals[index-1]['portfolio_id'] if index else None)
            if interval['upper_exclusive'] is not None:
                self.assertEqual(interval['upper_exclusive'], intervals[index+1]['lower_inclusive'])
                self.assertNotEqual(interval['portfolio_id'], intervals[index+1]['portfolio_id'])
        # Verify every actual C0 entry point, not slider samples.
        for cap in sorted({r['metrics']['c0_mrub'] for r in eligible}):
            # Scores are invariant across budgets: take the first affordable in
            # the full-budget ranking, independently of the production sweep.
            full = rank(research_rows(eligible, 'BASE', 1e6), self.weights, self.bounds, 'RESEARCH') if previous_ids is not None else full
            previous_ids = None
            expected = next(r for r in full if r['metrics']['c0_mrub'] <= cap + EPS)
            interval = next(i for i in intervals if i['lower_inclusive'] <= cap and (i['upper_exclusive'] is None or cap < i['upper_exclusive']))
            self.assertEqual(interval['portfolio_id'], expected['portfolio_id'])

    def test_06_hard_filter_normalization_determinism(self):
        hostile = deepcopy(self.bad)
        hostile['metrics']['vpub_mrub_per_year'] = 1e12
        ranked = rank([hostile, self.saved], self.weights, self.bounds, 'BASE')
        self.assertEqual([r['portfolio_id'] for r in ranked], [self.saved['portfolio_id']])
        result = analyze(self.request(context='RESEARCH', budget_cap=1250))
        self.assertEqual(result['ranking_context']['weights']['applied'], normalize_weights(self.weights))
        self.assertEqual(result['ranking_context']['reference'], self.population['reference'])
        for point in result['explorer']['points']:
            evaluated = evaluate(evaluation_input(point))
            config = deepcopy(self.snapshot.config)
            config['scenarios']['BASE']['c0_max_mrub'] = 1250
            self.assertTrue(self.snapshot.core.check_constraints(evaluated['metrics'], config, 'BASE').ok.all())
        a, b = deepcopy(self.saved), deepcopy(self.saved)
        a['portfolio_id'], b['portfolio_id'] = 'A', 'B'
        self.assertEqual([r['portfolio_id'] for r in rank([b, a], self.weights, self.bounds, 'BASE')], ['A', 'B'])
        self.assertEqual(canonical_json(result), canonical_json(analyze(self.request(context='RESEARCH', budget_cap=1250))))

    def test_07_passport_finance_provenance_and_unknowns(self):
        p = passport(evaluation_input(self.saved))
        totals = p['finance']['totals']
        self.assertAlmostEqual(totals['cash_mrub_per_year'], totals['anchor_cash_mrub_per_year'] + totals['commercial_cash_mrub_per_year'])
        self.assertNotEqual(totals['cash_mrub_per_year'], totals['vpub_mrub_per_year'])
        self.assertEqual(totals['portfolio_funding_gap'], 0)
        self.assertEqual(next(s['finance']['lot_funding_gap'] for s in p['services'] if s['lot_id'] == 'ENV'), 2.5)
        self.assertEqual(totals['sum_lot_funding_gaps'], 2.5)
        pointer = json.loads((ROOT / 'results/m4_current.json').read_bytes())
        active = json.loads((ROOT / pointer['directory'] / 'results/m4_management.json').read_bytes())
        self.assertEqual(p['finance'], active['finance'])
        for service in p['services']:
            self.assertEqual(service['confirmed_contracts']['provenance'], 'UNKNOWN')
        alternate = deepcopy(evaluation_input(self.saved))
        alternate['selection'][0]['mode_id'] = 'B'
        changed = passport(alternate)
        self.assertEqual(changed['services'][0]['chain'][0]['provenance'], 'UNKNOWN')
        self.assertEqual(changed['services'][0]['conditions'][0]['provenance'], 'UNKNOWN')

    def test_08_api_strict_contract_and_research_cannot_export(self):
        ok = self.client.post('/api/intelligence', json=self.request())
        self.assertEqual(ok.status_code, 200)
        for bad in (self.request(budget_cap=1000), self.request(context='RESEARCH'), self.request(locks=[{'lot_id':'FLOOD'},{'lot_id':'FLOOD','mode_id':'A'}]), self.request(locks=[{'lot_id':'UNKNOWN'}]), self.request(current_override=True)):
            self.assertEqual(self.client.post('/api/intelligence', json=bad).status_code, 422)
        incomplete = self.request()
        incomplete['current']['selection'] = incomplete['current']['selection'][:3]
        self.assertEqual(self.client.post('/api/intelligence', json=incomplete).status_code, 422)
        incompatible = self.request()
        incompatible['search']['source_hashes'] = {}
        self.assertEqual(self.client.post('/api/intelligence', json=incompatible).status_code, 422)
        for endpoint in ('/api/decision/export', '/api/export', '/api/decision/recompute'):
            self.assertEqual(self.client.post(endpoint, json=self.request(context='RESEARCH', budget_cap=1200)).status_code, 422)
        self.assertEqual(self.client.get('/api/health').status_code, 200)
        self.assertEqual(self.client.post('/api/passport', json=evaluation_input(self.saved)).status_code, 200)

    def test_09_diagnostics_explanation_and_sensitivity(self):
        result = analyze(self.request(self.saved))
        self.assertEqual(len(result['current']['diagnostics']['diagnostics']), len(RULES))
        original = evaluate(evaluation_input(self.saved))
        self.assertEqual(result['current']['diagnostics'], original['scenarios']['BASE'])
        explanation = result['explanation']
        for peer in explanation['nearest_alternatives']:
            row = next(r for r in self.base if r['portfolio_id'] == peer['portfolio_id'])
            self.assertEqual(peer['score_gap'], self.saved['score'] - row['score'])
            self.assertEqual(peer['delta'], tradeoffs(row, self.saved)['delta'])
        for run in result['local_sensitivity']:
            reranked = rank(self.rows, run['weights'], self.bounds, 'BASE')
            saved = next(r for r in reranked if r['portfolio_id'] == result['accepted_recommendation_id'])
            self.assertEqual(run['leader_id'], reranked[0]['portfolio_id'])
            self.assertEqual(run['original_recommendation_rank'], saved['rank'])
            self.assertAlmostEqual(run['score_gap_to_original'], reranked[0]['score'] - saved['score'])
        self.assertEqual(change_cost(self.saved, self.saved), (0, 0))
        self.assertEqual(recovery(self.bad, [], 'BASE'), [])

    def test_99_official_bytes_sources_and_pointers_preserved(self):
        self.assertEqual(canonical_json(recompute_decision(self.config)), self.official_before)
        self.assertEqual(canonical_json(get_population(self.snapshot)), canonical_json(self.population))
        protected = json.loads((ROOT / 'docs/decision-intelligence-protected.json').read_bytes())
        for relative, sha in protected.items():
            self.assertEqual(hashlib.sha256((ROOT / relative).read_bytes()).hexdigest(), sha, relative)


if __name__ == '__main__':
    unittest.main(verbosity=2)
