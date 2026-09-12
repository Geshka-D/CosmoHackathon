# Deterministic Decision Support · additive API

The accepted decision engine, formulas, weights and fixed BASE reference are
unchanged. Both endpoints are read-only; neither exports nor activates results.
The existing strict JSON parser, size limit, source verification and error
envelope apply. No new dependency or service is required.

## POST /api/intelligence

```json
{
  "format_version": "kosmos-intelligence/1",
  "search": "Use the request object from config/m3_decision.json or the existing decision UI",
  "current": "Use an existing /api/evaluate request with exactly four unique lots",
  "context": "RESEARCH",
  "budget_cap": 1180,
  "locks": [{"lot_id": "FLOOD", "mode_id": null}]
}
```

The two descriptive strings above are placeholders for existing typed objects.
`OFFICIAL` requires a null/omitted cap and uses `search.scenario` BASE/STRESS.
`RESEARCH` requires a finite nonnegative cap and changes only C0. A lot lock
allows any mode; a mode lock requires that exact lot/mode. Duplicate or unknown
locks are rejected. More than four distinct locks produces honest no-solution.

The request is ephemeral: official endpoints reject its schema. Comparison
transfers only the ordinary four-lot selection, with an explicit context label;
the existing comparison recomputes official BASE/STRESS. It does not transfer cap
or locks, apply a portfolio, overwrite saved recommendation or export research.

`ranking_context` identifies the fixed BASE population, bounds, original and
normalized weights, method version and existing tie rule. Research beyond BASE
bounds extrapolates the unchanged formula; there is no clipping or new reference.
MCDA means preference at the given management priorities, not objective truth.

`recovery` contains at most three distinct portfolios. Strategy A minimizes
replaced service count, then changed modes on retained services, then existing
rank (unrounded score descending, C0 ascending, lexical portfolio ID). B maximizes
VPUB, then rank; C minimizes C0, then rank. Coinciding strategies are merged.
Every proposal has canonical metrics, numeric deltas, explicit composition and
mode changes, resolved constraints and trade-offs. ΔC0 is not transition cost.

`budget.minimum_feasible_budget` is the lowest portfolio C0 satisfying all other
hard constraints and locks. Null means that removing C0 cap cannot solve the
problem. A non-null minimum with an empty feasible set is a budget-only blocker.
The current portfolio's C0 breakpoint is necessary but does not certify its
other hard constraints or locks.

The economic breakpoint is the actual C0. The original core also accepts
`C0 <= cap + 1e-9`. Separate acceptance-boundary fields report the smallest
nonnegative representable float satisfying that comparison. Transition intervals
use those numerical boundaries, [lower inclusive, upper exclusive), and expose
economic C0 separately. A sweep across actual C0 values merges consecutive
identical recommendations. It never estimates boundaries from a slider grid.

`explorer.points` contains every feasible portfolio for the active scenario and
locks, with extrema and strong alternatives. The graph is a C0/VPUB projection,
not a full Pareto frontier. No diagnostic changes the winner.

`explanation` compares the leader with the next three feasible ranked choices.
The main gain/compromise against second place uses the largest positive/negative
score-contribution difference, accompanied by raw metric deltas. It also exposes
official STRESS and funding conditions. There is no mixed-unit robustness score.

`local_sensitivity` performs four real rerankings (VPUB and C0 × 0.8/1.2) with the
same cap/locks/reference and the original normalization. It reports applied
weights, new leader, leader change, saved recommendation rank and score gap.
Null rank means infeasible under the current conditions. The saved recommendation
is recalculated from the active M3 input, never taken from control answers.
This local check does not claim full robustness.

## POST /api/passport

Accepts the ordinary four-lot evaluate request. Reads each active M4/M5 pointer
once through the existing verified readers. Both releases, source identity and
finance must agree with a fresh canonical calculation. Missing or inconsistent
releases fail closed with HTTP 503; there is no historical fallback.

Returns per-service C0, OPEX, anchor/commercial CASH and service gaps; portfolio
totals and portfolio gap remain separate. VPUB is never included in CASH. The
accepted ENV A gap of 2.5 remains an implementation condition even at portfolio
gap zero. Existing M4 roles and coverage conditions apply only to identical
lot/mode pairs. Other pairs show UNKNOWN, not invented contracts. Claims carry
CASE DATA / CALCULATED / TEAM ASSUMPTION / IMPLEMENTATION CONDITION / UNKNOWN.

## Verification and run

```powershell
python -m unittest discover -s tests -p test_intelligence.py -v
python -B tests/m3_independent.py --output out/session1-m3-fresh
npm --prefix frontend run build
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8011
$env:KOSMOS_BASE_URL='http://127.0.0.1:8011'
npm --prefix frontend run test:browser -- --workers=1
```

UI entry: construct/apply a four-service selection, then scroll to “Корректировка
и бюджетные переходы” and run recovery. Research controls and locks have their
own Reset. Preference weights and their Reset reuse the existing panel.
Late responses are ignored using cancellation, cleanup flags and request keys.
The existing three-column comparison limit is respected without dropping data.

Historical final submission, result pointers, and delivery exports are preserved.
This feature updates application code and the tracked frontend build; a future
submission packaging pass is separate from the accepted M4/M5 publication.
