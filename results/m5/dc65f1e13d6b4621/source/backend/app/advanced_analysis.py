"""Exact portfolio-wide team indicators built on the cached canonical population."""
from __future__ import annotations

from collections import Counter
from copy import deepcopy

from .canonical_adapter import evaluate_validated
from .coalition import analyse_result
from .contracts import EPS, CASE_ID, CASE_VERSION, SCHEMA_VERSION
from .reliability import reliability
from .schemas import EvaluateRequest, TeamSettings
from .search import get_population
from .stress_response import classify_population, population_row
from .team_assumptions import load_analysis_presets, load_team_settings, settings_payload


def _max_vpub(rows):
    if not rows:
        return None
    return max(rows, key=lambda row: (row["metrics"]["vpub_mrub_per_year"], -row["metrics"]["c0_mrub"], row["portfolio_id"]))


def _non_c0_ok(row, scenario="BASE"):
    return all(ok for key, ok in row["scenarios"][scenario]["checks"].items() if key != "c0_limit")


def optimism_ladder(population: dict, snapshot, uplifts: list[float]) -> list[dict]:
    rows = []
    for uplift in uplifts:
        item = {"uplift": uplift, "marker": "TEAM_INDICATOR"}
        for scenario in ("BASE", "STRESS"):
            limit = snapshot.config["scenarios"][scenario]["c0_max_mrub"]
            feasible = [row for row in population["rows"] if _non_c0_ok(row, scenario)
                        and row["metrics"]["c0_mrub"] * (1.0 + uplift) <= limit + EPS]
            best = _max_vpub(feasible)
            item[scenario] = {"feasible": len(feasible),
                              "max_vpub_mrub_per_year": None if best is None else best["metrics"]["vpub_mrub_per_year"],
                              "portfolio_id": None if best is None else best["portfolio_id"]}
        rows.append(item)
    return rows


SHADOW_EXPERIMENTS = (
    ("c0_plus_10", "Лимит C0 +10 млн", "c0", 10.0),
    ("c0_plus_50", "Лимит C0 +50 млн", "c0", 50.0),
    ("public_core_to_1", "public_core: минимум 1", "min_public_core_lots", 1),
    ("opex_plus_10", "Лимит OPEX +10 млн/год", "opex_max_mrub_per_year", 370.0),
    ("vpub_to_900", "Порог VPUB: минимум 900", "vpub_min_mrub_per_year", 900.0),
    ("kcash_to_05", "Порог KCASH: минимум 0,5", "kcash_min", 0.5),
    ("trep_to_060", "Порог t_rep: минимум 0,60", "t_rep_min", 0.60),
    ("territories_to_4", "Территории: минимум 4", "min_territorial_archetypes", 4),
    ("capabilities_to_3", "Группы возможностей: минимум 3", "min_capability_groups", 3),
)


def shadow_prices(population: dict, snapshot, scenario: str) -> dict:
    baseline_rows = [row for row in population["rows"] if row["scenarios"][scenario]["ok"]]
    baseline = _max_vpub(baseline_rows)
    experiments = []
    for experiment_id, label, field, value in SHADOW_EXPERIMENTS:
        rule = {"c0": "c0_limit", "min_public_core_lots": "public_core_lots",
                "opex_max_mrub_per_year": "opex_limit", "vpub_min_mrub_per_year": "vpub_floor",
                "kcash_min": "kcash_floor", "t_rep_min": "t_rep_floor",
                "min_territorial_archetypes": "territorial_archetypes",
                "min_capability_groups": "capability_groups"}[field]
        candidates = []
        for row in population["rows"]:
            if not all(ok for key, ok in row["scenarios"][scenario]["checks"].items() if key != rule):
                continue
            metrics = row["metrics"]
            if field == "c0":
                ok = metrics["c0_mrub"] <= snapshot.config["scenarios"][scenario]["c0_max_mrub"] + value + EPS
            elif field == "min_public_core_lots":
                ok = metrics["public_core_lots"] >= value
            elif field == "opex_max_mrub_per_year":
                ok = metrics["opex_mrub_per_year"] <= value + EPS
            elif field == "vpub_min_mrub_per_year":
                ok = metrics["vpub_mrub_per_year"] >= value - EPS
            elif field == "kcash_min":
                ok = metrics["kcash"] >= value - EPS
            elif field == "t_rep_min":
                ok = metrics["t_rep"] >= value - EPS
            elif field == "min_territorial_archetypes":
                ok = metrics["territorial_archetypes"] >= value
            else:
                ok = metrics["capability_groups"] >= value
            if ok:
                candidates.append(row)
        best = _max_vpub(candidates)
        best_value = None if best is None else best["metrics"]["vpub_mrub_per_year"]
        delta = None if best_value is None else best_value - baseline["metrics"]["vpub_mrub_per_year"]
        experiments.append({"id": experiment_id, "label": label, "best_vpub_mrub_per_year": best_value,
                            "delta_vpub_mrub_per_year": delta, "portfolio_id": None if best is None else best["portfolio_id"]})
    return {"scenario": scenario, "marker": "TEAM_INDICATOR", "baseline": baseline,
            "experiments": experiments,
            "formula": "max(VPUB | modified constraint) - max(VPUB | canonical constraints)",
            "unit": "синтетические млн руб./год общественной ценности"}


def frontier(population: dict, snapshot) -> dict:
    candidates = sorted((row for row in population["rows"] if _non_c0_ok(row)),
                        key=lambda row: (row["metrics"]["c0_mrub"], -row["metrics"]["vpub_mrub_per_year"], row["portfolio_id"]))
    points, best = [], None
    for row in candidates:
        value = row["metrics"]["vpub_mrub_per_year"]
        if best is None or value > best["metrics"]["vpub_mrub_per_year"] + EPS:
            best = row
            points.append({"budget_mrub": row["metrics"]["c0_mrub"], "max_vpub_mrub_per_year": value,
                           "portfolio_id": row["portfolio_id"]})

    def at(limit):
        eligible = [row for row in candidates if row["metrics"]["c0_mrub"] <= limit + EPS]
        row = _max_vpub(eligible)
        return {"budget_mrub": limit, "feasible": len(eligible),
                "max_vpub_mrub_per_year": None if row is None else row["metrics"]["vpub_mrub_per_year"],
                "portfolio_id": None if row is None else row["portfolio_id"]}

    base_limit = snapshot.config["scenarios"]["BASE"]["c0_max_mrub"]
    stress_limit = snapshot.config["scenarios"]["STRESS"]["c0_max_mrub"]
    survival_depths = [0.0, 0.025, 0.05, 0.075, 0.092, 0.10, 0.125, 0.136]
    survival = [at(base_limit * (1.0 - depth)) | {"cut_share": depth} for depth in survival_depths]
    anchors = {"minimum": at(points[0]["budget_mrub"]), "stress": at(stress_limit), "base": at(base_limit),
               "saturation": points[-1]}
    v_stress = anchors["stress"]["max_vpub_mrub_per_year"]
    v_base = anchors["base"]["max_vpub_mrub_per_year"]
    v_1400 = at(1400.0)["max_vpub_mrub_per_year"]
    return {"marker": "TEAM_INDICATOR", "efficiency_curve": points, "survival_curve": survival,
            "anchors": anchors, "marginal_public_value": {
                "stress_to_base": (v_base - v_stress) / (base_limit - stress_limit),
                "base_to_1400": (v_1400 - v_base) / (1400.0 - base_limit),
                "elasticity_stress_cut": ((v_base - v_stress) / v_base) / ((base_limit - stress_limit) / base_limit)},
            "formula": "F(B)=max VPUB among portfolios satisfying all non-C0 rules and C0<=B",
            "units": {"budget": "млн руб. при запуске", "vpub": "синтетические млн руб./год общественной ценности"}}


def regional_equity(population: dict, snapshot) -> dict:
    rows = [row for row in population["rows"] if row["scenarios"]["STRESS"]["ok"]]
    lots = snapshot.lots.set_index("lot_id")
    regional_ids = sorted(row.lot_id for row in snapshot.lots.itertuples(index=False) if not row.federal)
    counts = Counter(item["lot_id"] for row in rows for item in row["selection"] if item["lot_id"] in regional_ids)
    service_counts = Counter(sum(not bool(lots.loc[item["lot_id"], "federal"]) for item in row["selection"]) for row in rows)
    return {"marker": "TEAM_INDICATOR", "stress_feasible": len(rows),
            "regions": [{"lot_id": lot, "territory": lots.loc[lot, "territorial_archetype"], "count": counts[lot],
                         "share": counts[lot] / len(rows)} for lot in regional_ids],
            "regional_services_per_portfolio": {str(key): value for key, value in sorted(service_counts.items())},
            "interpretation": "Четыре позиции не обеспечивают собственный сервис всем семи нефедеральным архетипам."}


def _pair_costs(snapshot) -> dict[tuple[str, str], float]:
    lots = snapshot.lots.set_index("lot_id", drop=False)
    modes = snapshot.modes.set_index("mode_id", drop=False)
    return {(lot, mode): snapshot.core.apply_mode(lots.loc[lot], modes.loc[mode])["c0_mrub"]
            for lot in lots.index for mode in modes.index}


def reliability_population(population: dict, snapshot, settings: TeamSettings) -> dict:
    pairs = _pair_costs(snapshot)
    result = {}
    for scenario in ("BASE", "STRESS"):
        limit = snapshot.config["scenarios"][scenario]["c0_max_mrub"]
        rows = []
        for row in population["rows"]:
            if not _non_c0_ok(row, scenario):
                continue
            costs = [pairs[(item["lot_id"], item["mode_id"])] * (1.0 + settings.optimism_uplift)
                     for item in row["selection"]]
            indicator = reliability(costs, limit, settings.sigma, settings.rho, settings.confidence)
            if indicator["reliable"]:
                rows.append(row)
        best = _max_vpub(rows)
        result[scenario] = {"reliable": len(rows), "max_vpub_mrub_per_year": None if best is None else best["metrics"]["vpub_mrub_per_year"],
                            "portfolio_id": None if best is None else best["portfolio_id"]}
    deterministic_best = _max_vpub([row for row in population["rows"] if row["scenarios"]["STRESS"]["ok"]])
    robust_value = result["STRESS"]["max_vpub_mrub_per_year"]
    result["price_of_reliability_mrub_per_year"] = None if robust_value is None else deterministic_best["metrics"]["vpub_mrub_per_year"] - robust_value
    result.update(marker="TEAM_INDICATOR", settings=settings_payload(settings))
    return result


def _request(selection) -> EvaluateRequest:
    return EvaluateRequest.model_validate({"schema_version": SCHEMA_VERSION, "case_id": CASE_ID,
                                           "case_version": CASE_VERSION, "selection": selection})


def _brief(row: dict, snapshot, settings: TeamSettings) -> dict:
    result = evaluate_validated(_request(row["selection"]), snapshot, settings)
    lot_gaps = [max(item["opex_mrub_per_year"] - item["cash_mrub_per_year"], 0.0) for item in result["detail"]]
    portfolio_gap = max(result["metrics"]["opex_mrub_per_year"] - result["metrics"]["cash_mrub_per_year"], 0.0)
    return {"portfolio_id": row["portfolio_id"], "selection": row["selection"], "metrics": result["metrics"],
            "scenarios": result["scenarios"], "portfolio_funding_gap": portfolio_gap,
            "sum_lot_funding_gaps": sum(lot_gaps),
            "result_fingerprint": result["input_fingerprint"]}


def strategic_triad(population: dict, snapshot, selection: list[dict], settings: TeamSettings,
                    evidence_sigma: float) -> dict | None:
    current = population_row(selection, population)
    if current is None:
        return None
    lot_ids = {row["lot_id"] for row in selection}
    same = [row for row in population["rows"] if {item["lot_id"] for item in row["selection"]} == lot_ids]
    benefit = _max_vpub([row for row in same if row["scenarios"]["BASE"]["ok"]])
    option = _max_vpub([row for row in same if row["scenarios"]["STRESS"]["ok"]])
    if benefit is None or option is None:
        return None
    illustrative = settings.model_copy(update={"optimism_uplift": 0.0, "sigma": evidence_sigma})
    return {"marker": "TEAM_INDICATOR", "probability_sigma": evidence_sigma,
            "current": _brief(current, snapshot, illustrative),
            "benefit_maximum": _brief(benefit, snapshot, illustrative),
            "after_option": _brief(option, snapshot, illustrative),
            "option_changes": [{"lot_id": item["lot_id"], "from": next(x["mode_id"] for x in benefit["selection"] if x["lot_id"] == item["lot_id"]),
                                "to": item["mode_id"]} for item in option["selection"]
                               if next(x["mode_id"] for x in benefit["selection"] if x["lot_id"] == item["lot_id"]) != item["mode_id"]]}


def build_advanced_bundle(snapshot, settings: TeamSettings | None = None, selection: list[dict] | None = None,
                          result: dict | None = None) -> dict:
    settings = settings or load_team_settings(snapshot.root)
    presets = load_analysis_presets(snapshot.root)
    population = get_population(snapshot)
    evidence_settings = settings.model_copy(update={"optimism_uplift": 0.0, "sigma": presets["reliability_sigma"]})
    selected = selection or (result or {}).get("selection")
    output = {"marker": "TEAM_INDICATORS", "settings": settings_payload(settings), "presets": presets,
              "optimism_ladder": optimism_ladder(population, snapshot, presets["optimism_ladder"]),
              "shadow_prices": {scenario: shadow_prices(population, snapshot, scenario) for scenario in ("BASE", "STRESS")},
              "frontier": frontier(population, snapshot), "regional_equity": regional_equity(population, snapshot),
              "stress_response_population": classify_population(population, snapshot, settings.alpha),
              "reliability_population": reliability_population(population, snapshot, evidence_settings)}
    if selected:
        triad = strategic_triad(population, snapshot, selected, settings, presets["reliability_sigma"])
        output["strategic_triad"] = triad
        selected_result = result or evaluate_validated(_request(selected), snapshot, settings)
        from .portfolio_analysis import risk_tornado
        output["risk_tornado"] = risk_tornado(selected_result)
        output["coalition"] = analyse_result(selected_result, snapshot, settings.phi, presets["phi_sensitivity"])
        if triad:
            costs = [item["c0_mrub"] for item in evaluate_validated(_request(triad["benefit_maximum"]["selection"]), snapshot, evidence_settings)["detail"]]
            output["risk_premium_by_rho"] = [reliability(costs, snapshot.config["scenarios"]["STRESS"]["c0_max_mrub"],
                                                                  presets["reliability_sigma"], rho, settings.confidence)
                                                  for rho in (0.0, 0.65, 1.0)]
    return output
