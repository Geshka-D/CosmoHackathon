# Research math contract · safe port

Accepted base: root frontend confirmed by user; versioned ancestry c7c683d4c881c33532a0fe34f9f863f88aa2d1a1.
Feature worktree: research-math-safe-port, branch feature/research-math-safe-port.
No writes to the original root application or dirty delivery/github-publish tree.
Baseline manifests: research-baseline-files.json, research-inherited-source-hashes.json.

POST /api/research-math (lazy import; not required by case/official/PDF routes).
Request: format_version=kosmos-research-math/1, intelligence (existing request,
context=RESEARCH and explicit budget_cap required), u (finite >=0, default 0),
cost_risk (null by default; explicit sigma>=0, 0<=rho<=1, 0<q<1).
Unknown fields are rejected; no TeamSettings or persistent settings.

Response: separate research result: settings, input_fingerprint, analysis
(existing Intelligence response under the same cap/u/locks), budget_effect,
cost_risk. Official ResultBundle is never extended or mutated.

Canonical metrics stay canonical. Research C0 is separately labelled; only its
hard constraint changes. Every Recovery candidate is checked again through the
public canonical adapter plus the identical research comparison and locks.
Comparison includes canonical and research C0 and their deltas. Ordinary
comparison/export still uses canonical RequestInput; research proof remains here.
MCDA uses unchanged weights, BASE normalization and tie-break; its transition
map is retained. F(B) is a separate maximum of raw VPUB, ties resolved by existing
MCDA rank (score descending, canonical C0 ascending, portfolio_id ascending).
Economic thresholds and numerical EPS acceptance boundaries are both returned.
Equal VPUB plateaus are merged; candidate tie changes are separately retained.
No solution is null, never zero VPUB. No interpolation or ROI claim.

Risk is analytical and optional. Display actual u/sigma/rho/q, conditional budget
probability, existing margin, z_q*sd, missing budget. No donor risk_premium,
independent supplier count, risk rank or official acceptance claim.
Client keys include the complete request: selection, sources, weights, scenario,
cap, u, risk settings and locks. Abort + stale response guards; Reset clears all.

Donor provenance: selective reads of four files from the allowed local ZIP;
research-donor.json. Adapted optimism ladder, F(B), analytic covariance and
synthetic checker-boundary test ideas. Rejected coalition/Shapley, equity,
relaxed constraints, repair replacement, settings infrastructure and all donor UI,
results, pointers, materials and generators. This is author validation only.
