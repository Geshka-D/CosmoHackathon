"""Session-author validation. Donor synthetic boundaries adapted; new brute-force oracles.

No independent agent acceptance claim. Expected answers are test-only.
"""
from copy import deepcopy
import hashlib
import json
import math
from pathlib import Path
import unittest

from fastapi.testclient import TestClient
from backend.app.canonical_adapter import evaluate
from backend.app.case_loader import CaseRepository
from backend.app.constraints import RULES, scenario_diagnostics
from backend.app.contracts import EPS, ServiceError, canonical_json
from backend.app.decision import evaluation_input, recompute_decision
from backend.app.decision_model import rank
from backend.app.intelligence import Lock, analyze, matches_locks, research_rows
from backend.app.main import create_app
from backend.app.research_math import budget_effect, research_math
from backend.app.search import get_population

ROOT = Path(__file__).resolve().parents[1]


class ResearchMathTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.repo = CaseRepository(ROOT)
        cls.snapshot = cls.repo.load()
        cls.population = get_population(cls.snapshot)
        cls.rows = cls.population['rows']
        cls.config = json.loads((ROOT/'config/m3_decision.json').read_bytes())
        cls.weights = cls.config['request']['weights']
        cls.bounds = cls.population['reference']['bounds']
        cls.current = rank(cls.rows, cls.weights, cls.bounds, 'BASE')[0]
        cls.client = TestClient(create_app(cls.repo))

    def request(self, cap=1180, u=0, locks=None):
        return {'format_version': 'kosmos-research-math/1', 'u': u,
                'intelligence': {'format_version': 'kosmos-intelligence/1',
                    'search': deepcopy(self.config['request']), 'current': evaluation_input(self.current),
                    'context': 'RESEARCH', 'budget_cap': cap, 'locks': locks or []}}

    def test_a_counts_monotonic_and_critical(self):
        prior = {}
        for u, counts in [(0,(1031,143)),(.05,(648,1)),(.10,(151,0))]:
            for scenario, cap, count in zip(('BASE','STRESS'),(1300,1180),counts):
                rows = research_rows(self.rows, scenario, cap, u)
                ids = {r['portfolio_id'] for r in rows if r['scenarios']['RESEARCH']['ok']}
                self.assertEqual(len(ids), count)
                if scenario in prior: self.assertLessEqual(ids,prior[scenario])
                prior[scenario]=ids
        result = research_math(self.request(),self.repo)
        self.assertEqual(result['current']['canonical_c0'],1150.8)
        self.assertAlmostEqual(result['current']['critical_u'],.02537365311,places=10)

    def test_a_zero_preserves_existing_analysis(self):
        payload=self.request()
        old=analyze(payload['intelligence'],self.repo)
        new=research_math(payload,self.repo)['analysis']
        for proposal in new['recovery']+[new['recommendation']]:
            if proposal:
                proposal.pop('research_check');proposal.pop('research_delta_c0')
        self.assertEqual(new,old)

    def test_a_recovery_same_cap_u_locks_and_no_solution(self):
        for u,locks in [(.05,[]),(.10,[]),(.05,[{'lot_id':'FLOOD','mode_id':'A'}]),
                        (.05,[{'lot_id':r['lot_id'],'mode_id':r['mode_id']} for r in self.current['selection']])]:
            request=self.request(u=u,locks=locks); value=research_math(request,self.repo)
            feasible=[]
            for row in self.rows:
                selected={r['lot_id']:r['mode_id'] for r in row['selection']}
                locked=all(x['lot_id'] in selected and (x.get('mode_id') is None or selected[x['lot_id']]==x['mode_id']) for x in locks)
                if locked and row['metrics']['c0_mrub']*(1+u)<=1180+EPS and all(v for k,v in row['scenarios']['BASE']['checks'].items() if k!='c0_limit'):feasible.append(row)
            self.assertEqual(value['analysis']['feasible_count'],len(feasible))
            self.assertEqual(bool(value['analysis']['recovery']),bool(feasible))
            for p in value['analysis']['recovery']:
                result=evaluate(p['request'],self.repo)
                self.assertLessEqual(result['metrics']['c0_mrub']*(1+u),1180+EPS)
                self.assertTrue(p['research_check']['feasible'])
                self.assertEqual(len(p['research_check']['checks']),9)
                self.assertAlmostEqual(p['research_delta_c0'],p['delta']['c0_mrub']*(1+u))
            base=evaluate(request['intelligence']['current'],self.repo)
            for d in value['analysis']['current']['diagnostics']['diagnostics']:
                if d['id']!='c0_limit': self.assertEqual(d,next(x for x in base['scenarios']['BASE']['diagnostics'] if x['id']==d['id']))

    def test_a_scaled_tolerance_direct_checker(self):
        c0=self.current['metrics']['c0_mrub'];u=.1; cost=c0*(1+u)
        for cap,expected in [(cost,True),(cost-EPS/2,True),(cost-2*EPS,False)]:
            value=research_math(self.request(cap=cap,u=u),self.repo)
            self.assertEqual(value['current']['checks']['c0_limit'],expected)
            d=next(d for d in value['analysis']['current']['diagnostics']['diagnostics'] if d['id']=='c0_limit')
            self.assertEqual(d['ok'],expected)
            self.assertEqual(d['fact'],cost)

    def test_b_bruteforce_all_thresholds_steps_ties_locks(self):
        for u,locks in [(0,[]),(.05,[Lock(lot_id='FLOOD')])]:
            value=budget_effect(self.rows,self.weights,self.bounds,'BASE',1180,u,locks)
            nonbudget=[r for r in self.rows if matches_locks(r,locks) and all(v for k,v in r['scenarios']['BASE']['checks'].items() if k!='c0_limit')]
            ordering=rank(research_rows(nonbudget,'BASE',1e6,u),self.weights,self.bounds,'RESEARCH')
            for event in value['candidate_intervals']:
                for cap in [event['budget_threshold'], event['lower_inclusive'], math.nextafter(event['lower_inclusive'],-math.inf)]:
                    direct=[r for r in ordering if r['metrics']['c0_mrub']*(1+u)<=cap+EPS]
                    expected=min(direct,key=lambda r:(-r['metrics']['vpub_mrub_per_year'],r['rank'])) if direct else None
                    actual=next((e for e in reversed(value['candidate_intervals']) if e['lower_inclusive']<=cap),None)
                    self.assertEqual(actual and actual['portfolio_id'],expected and expected['portfolio_id'])
            self.assertTrue(all(b['vpub']>a['vpub'] for a,b in zip(value['levels'],value['levels'][1:])))
        for cap in [1180,1190]:
            value=budget_effect(self.rows,self.weights,self.bounds,'BASE',cap,0,[])
            self.assertAlmostEqual(value['current']['vpub'],1370.4 if cap==1180 else 1410)
            if cap==1180:
                self.assertEqual(value['next']['budget_threshold'],1186.5)
                self.assertEqual(value['next']['vpub'],1410)
        for rows,locks in [([],[]),(self.rows,[Lock(lot_id=x) for x in ('AGRI','FLOOD','FIRE','ENV','SSA')])]:
            value=budget_effect(rows,self.weights,self.bounds,'BASE',1180,0,locks)
            self.assertIsNone(value['current']);self.assertEqual(value['levels'],[])
        self.assertIsNone(budget_effect(self.rows,self.weights,self.bounds,'BASE',0,0,[])['current'])

    def test_all_nine_boundaries_public_checker_and_adapter(self):
        valid=dict(self.current['metrics'])
        for scenario in ('BASE','STRESS'):
            for index,(rule,metric,comparator,field,*_) in enumerate(RULES):
                limit=self.snapshot.config['scenarios'][scenario][field] if rule=='c0_limit' else self.snapshot.config['constraints_common'][field]
                direction=1 if comparator=='<=' or comparator=='==' else -1
                for delta,expected in [(0,True),((EPS/2 if index>=4 else 0),True),((2*EPS if index>=4 else 1),False)]:
                    metrics={**valid,metric:limit+direction*delta}
                    diagnostics=scenario_diagnostics(metrics,self.snapshot.config,self.snapshot.core,True)[scenario]
                    self.assertEqual(next(d['ok'] for d in diagnostics['diagnostics'] if d['id']==rule),expected,(rule,delta))
        duplicate=deepcopy(evaluation_input(self.current));duplicate['selection'][1]=duplicate['selection'][0]
        with self.assertRaises(ServiceError):evaluate(duplicate,self.repo)
        for row in [self.current,next(r for r in self.rows if not r['scenarios']['BASE']['ok'])]:
            result=evaluate(evaluation_input(row),self.repo)
            for scenario in ('BASE','STRESS'):
                self.assertEqual({d['id']:d['ok'] for d in result['scenarios'][scenario]['diagnostics']},row['scenarios'][scenario]['checks'])

    def test_api_invalid_schema_official_isolation(self):
        self.assertEqual(self.client.post('/api/research-math',json=self.request()).status_code,200)
        for update in [{'u':-1},{'stress_plan':{}},{'cost_risk':{'sigma':.05,'rho':2,'q':.9}}]:
            self.assertEqual(self.client.post('/api/research-math',json={**self.request(),**update}).status_code,422)
        for u in [float('inf'),float('nan'),1e308]:
            with self.assertRaises(ServiceError):research_math(self.request(u=u),self.repo)
        request=self.request();request['intelligence']['context']='OFFICIAL'
        with self.assertRaises(ServiceError):research_math(request,self.repo)
        self.assertEqual(canonical_json(recompute_decision(self.config,self.repo)),(ROOT/'docs/research-official-before.json').read_bytes())
        protected=json.loads((ROOT/'docs/research-baseline-files.json').read_bytes())
        for name,item in protected.items():
            if name.startswith(('config/','case_source/','results/')):
                self.assertEqual(hashlib.sha256((ROOT/name).read_bytes()).hexdigest(),item['sha256'],name)

    def test_supplement_equal_value_tie_change_and_same_budget_group(self):
        a=deepcopy(self.current);b=deepcopy(self.current);c=deepcopy(self.current)
        for row,ident,cost,ready in [(a,'A',1100,1),(b,'B',1200,5),(c,'C',1200,5)]:
            row['portfolio_id']=ident
            row['metrics'].update(c0_mrub=cost,vpub_mrub_per_year=1200,readiness_1_5=ready)
        weights={k:float(k=='readiness') for k in self.weights}
        value=budget_effect([c,a,b],weights,self.bounds,'BASE',1190,0,[])
        self.assertEqual(len(value['levels']),1)
        self.assertEqual([r['portfolio_id'] for r in value['candidate_intervals']],['A','B'])
        self.assertIsNone(value['next'])
        self.assertEqual(budget_effect([c,a,b],weights,self.bounds,'BASE',1200,0,[])['current']['portfolio_id'],'B')

    def test_supplement_risk_api_actual_settings_sources_and_lazy_isolation(self):
        from unittest.mock import patch
        request=self.request(u=.03)
        request['cost_risk']={'sigma':.07,'rho':.4,'q':.95}
        response=self.client.post('/api/research-math',json=request)
        self.assertEqual(response.status_code,200,response.text)
        value=response.json()
        self.assertEqual(value['cost_risk']['settings'],{'u':.03,'cap':1180,'sigma':.07,'rho':.4,'q':.95})
        self.assertEqual(value['settings']['cost_risk'],request['cost_risk'])
        changed=deepcopy(request);changed['u']=.04
        other=self.client.post('/api/research-math',json=changed).json()
        self.assertNotEqual(value['input_fingerprint'],other['input_fingerprint'])
        self.assertNotEqual(value['analysis']['input_fingerprint'],other['analysis']['input_fingerprint'])
        changed['intelligence']['search']['source_hashes']={}
        self.assertEqual(self.client.post('/api/research-math',json=changed).status_code,422)
        with patch.dict('sys.modules',{'backend.app.research_math':None,'backend.app.research_risk':None}):
            self.assertEqual(self.client.get('/api/case').status_code,200)
            self.assertEqual(self.client.post('/api/decision/recompute',json=self.config).content,(ROOT/'docs/research-official-before.json').read_bytes())


if __name__=='__main__':unittest.main()
