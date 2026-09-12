"""Read-only deterministic decision support over the existing exhaustive search.

Research adds one scenario to copies of rows. It never edits BASE/STRESS, the
fixed BASE bounds, declared weights, saved configuration or result pointers.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import math
from typing import Annotated, Literal

from pydantic import Field, field_validator

from .case_loader import CaseRepository
from .constraints import scenario_diagnostics
from .contracts import EPS, LOT_IDS, ServiceError, canonical_json, parse_json
from .decision import comparison_delta, evaluation_input
from .decision_model import DIRECTIONS, FIELDS, TIE_BREAK, normalize_weights, rank
from .schemas import EvaluateRequest, StrictModel, validate_request
from .search import SearchRequest, get_population, portfolio_id
from .sensitivity import selection_changes

VERSION = "kosmos-intelligence/1"


class Lock(StrictModel):
    lot_id: str
    mode_id: Literal["A", "B", "C"] | None = None

    @field_validator("lot_id")
    @classmethod
    def known(cls, value):
        if value not in LOT_IDS:
            raise ValueError("Неизвестный сервис lock.")
        return value


class IntelligenceRequest(StrictModel):
    format_version: Literal[VERSION]
    search: SearchRequest
    current: EvaluateRequest
    context: Literal["OFFICIAL", "RESEARCH"] = "OFFICIAL"
    budget_cap: Annotated[float, Field(ge=0, allow_inf_nan=False)] | None = None
    locks: Annotated[list[Lock], Field(max_length=8)] = []

    @field_validator("current")
    @classmethod
    def complete(cls, value):
        if len(value.selection) != 4:
            raise ValueError("Для корректировки и сравнения нужны четыре уникальных сервиса.")
        return value

    @field_validator("locks")
    @classmethod
    def distinct(cls, value):
        if len({lock.lot_id for lock in value}) != len(value):
            raise ValueError("Один lock на сервис: любой режим либо конкретный режим.")
        return value


def matches_locks(row, locks):
    selected = {r["lot_id"]: r["mode_id"] for r in row["selection"]}
    return all(lock.lot_id in selected and
               (lock.mode_id is None or selected[lock.lot_id] == lock.mode_id) for lock in locks)


def acceptance_boundary(c0):
    """Smallest nonnegative float accepted by canonical c0 <= cap + EPS.

    The economic breakpoint is C0 itself. Expose the separate numerical boundary
    so even near-EPS queries and transition intervals agree with the engine.
    """
    cap = max(0.0, c0 - EPS)
    while c0 > cap + EPS:
        cap = math.nextafter(cap, math.inf)
    while cap > 0 and c0 <= math.nextafter(cap, -math.inf) + EPS:
        cap = math.nextafter(cap, -math.inf)
    return cap


def eligible_without_budget(rows, scenario, locks):
    return [r for r in rows if matches_locks(r, locks) and
            all(ok for key, ok in r["scenarios"][scenario]["checks"].items() if key != "c0_limit")]


def research_rows(rows, scenario, cap):
    result = []
    for row in rows:
        checks = {**row["scenarios"][scenario]["checks"], "c0_limit": row["metrics"]["c0_mrub"] <= cap + EPS}
        ok = all(checks.values())
        result.append({**row, "scenarios": {**row["scenarios"], "RESEARCH": {
            "ok": ok, "status": "PASS" if ok else "FAIL", "checks": checks,
            "c0_limit": cap, "c0_margin": cap - row["metrics"]["c0_mrub"]}}})
    return result


def change_cost(before, after):
    changes = selection_changes(before["selection"], after["selection"])
    return len(changes["removed"]), len(changes["mode_changes"])


def tradeoffs(reference, alternative):
    delta = comparison_delta(reference, alternative)
    gains, losses = [], []
    for key, field in FIELDS.items():
        signed = delta[field] * (-1 if DIRECTIONS[key] == "minimize" else 1)
        if signed:
            (gains if signed > 0 else losses).append({"metric": field, "delta": delta[field]})
    return {"delta": delta, "gains_under_declared_directions": gains, "losses_under_declared_directions": losses,
            "interpretation": "Разница вариантов при одинаковых условиях; не причинный эффект и не стоимость перехода."}


def proposal(before, after, scenario, strategies):
    return {"strategies": strategies, "candidate": after, "request": evaluation_input(after),
            "changes": selection_changes(before["selection"], after["selection"]),
            "change_count": dict(zip(("service_replacements", "mode_changes"), change_cost(before, after))),
            **tradeoffs(before, after),
            "resolved_constraints": [key for key, ok in before["scenarios"][scenario]["checks"].items()
                                     if not ok and after["scenarios"][scenario]["checks"][key]]}


def recovery(before, ranking, scenario):
    if not ranking:
        return []
    choices = [
        ("A_MINIMAL_CHANGE", min(ranking, key=lambda r: (*change_cost(before, r), r["rank"]))),
        ("B_MAX_VPUB", min(ranking, key=lambda r: (-r["metrics"]["vpub_mrub_per_year"], r["rank"]))),
        ("C_MIN_C0", min(ranking, key=lambda r: (r["metrics"]["c0_mrub"], r["rank"]))),
    ]
    unique = {}
    for strategy, row in choices:
        if row["portfolio_id"] in unique:
            unique[row["portfolio_id"]]["strategies"].append(strategy)
        else:
            unique[row["portfolio_id"]] = proposal(before, row, scenario, [strategy])
    return list(unique.values())


def transition_map(eligible, weights, bounds, scenario):
    """Sweep actual portfolio C0 breakpoints once; retain only leader changes."""
    if not eligible:
        return []
    max_cap = max(r["metrics"]["c0_mrub"] for r in eligible)
    order = rank(research_rows(eligible, scenario, max_cap), weights, bounds, "RESEARCH")
    best, intervals = None, []
    for row in sorted(order, key=lambda r: (acceptance_boundary(r["metrics"]["c0_mrub"]), r["rank"])):
        if best is not None and row["rank"] >= best["rank"]:
            continue
        lower = acceptance_boundary(row["metrics"]["c0_mrub"])
        if intervals:
            intervals[-1]["upper_exclusive"] = lower
        intervals.append({"lower_inclusive": lower, "upper_exclusive": None,
                          "economic_breakpoint_c0": row["metrics"]["c0_mrub"],
                          "portfolio_id": row["portfolio_id"], "request": evaluation_input(row),
                          "metrics": row["metrics"],
                          "change_from_previous": None if best is None else {
                              "changes": selection_changes(best["selection"], row["selection"]),
                              **tradeoffs(best, row)}})
        best = row
    return intervals


def explain(ranking, scenario):
    if not ranking:
        return None
    leader = ranking[0]
    peers = ranking[1:4]
    comparisons = [{"portfolio_id": peer["portfolio_id"],
                    "score_gap": leader["score"] - peer["score"],
                    "contribution_delta": {k: leader["contributions"][k] - peer["contributions"][k] for k in FIELDS},
                    **tradeoffs(peer, leader)} for peer in peers]
    return {"interpretation": "Предпочтительный портфель при заданных управленческих приоритетах после hard constraints.",
            "strongest_weighted_criterion": max(FIELDS, key=lambda k: leader["contributions"][k]),
            "nearest_alternatives": comparisons, "official_stress": leader["scenarios"]["STRESS"],
            "real_vulnerabilities": {"c0_margin": leader["scenarios"][scenario]["c0_margin"],
                                     "sum_service_gaps": leader["sum_lot_funding_gaps"]},
            "unconfirmed_conditions": ["Договоры, права доступа, местное качество и SLA требуют подтверждения.",
                                       "Финансирование запуска и адресное покрытие дефицитов не подтверждены; см. активный M4-паспорт."],
            "caution": "Индексы трактуются согласно объявленному MCDA; t_rep не означает окупаемость."}


def analyze(value, repository: CaseRepository | None = None):
    request = validate_request(IntelligenceRequest, value)
    if (request.context == "RESEARCH") != (request.budget_cap is not None):
        raise ServiceError("context_budget_mismatch", "Произвольный budget_cap разрешён только в RESEARCH и обязателен в нём.")
    repository = repository or CaseRepository()
    snapshot = repository.load()
    if request.search.source_hashes != snapshot.source_hashes:
        raise ServiceError("incompatible_sources", "Поиск относится к другой версии источников.")
    population = get_population(snapshot)
    weights, scenario = request.search.weights.model_dump(), request.search.scenario
    cap = request.budget_cap if request.context == "RESEARCH" else snapshot.config["scenarios"][scenario]["c0_max_mrub"]
    active = "RESEARCH" if request.context == "RESEARCH" else scenario
    rows = research_rows(population["rows"], scenario, cap) if active == "RESEARCH" else population["rows"]
    current_id = portfolio_id(sorted(request.current.model_dump()["selection"], key=lambda r: r["lot_id"]))
    current = next(r for r in rows if r["portfolio_id"] == current_id)
    eligible = eligible_without_budget(rows, scenario, request.locks)
    ranking = rank([r for r in rows if matches_locks(r, request.locks)], weights, population["reference"]["bounds"], active)
    minimum = min((r["metrics"]["c0_mrub"] for r in eligible), default=None)
    diagnostic_config = deepcopy(snapshot.config)
    if active == "RESEARCH":
        diagnostic_config["scenarios"][scenario]["c0_max_mrub"] = cap
    diagnostics = scenario_diagnostics(current["metrics"], diagnostic_config, snapshot.core, True)[scenario]
    if active == "RESEARCH":
        diagnostics["scenario"] = "RESEARCH"
        for d in diagnostics["diagnostics"]:
            if d["id"] == "c0_limit":
                d["limit_source"] = {"file": "RESEARCH request", "pointer": "/budget_cap"}
    locked = matches_locks(current, request.locks)
    leader = ranking[0] if ranking else None
    # Accepted recommendation is recalculated from the saved input, never a
    # control answer. Temporary preferences cannot overwrite that baseline.
    saved_search = validate_request(SearchRequest, parse_json((repository.root / "config/m3_decision.json").read_bytes())["request"])
    if saved_search.source_hashes != snapshot.source_hashes:
        raise ServiceError("incompatible_sources", "Сохранённая рекомендация относится к другим источникам.")
    accepted = rank(population["rows"], saved_search.weights.model_dump(), population["reference"]["bounds"], "BASE")[0]
    local_sensitivity = []
    proportional = normalize_weights(weights)
    for criterion in ("vpub", "c0"):
        for multiplier in (0.8, 1.2):
            modified = {k: v * multiplier if k == criterion else v for k, v in proportional.items()}
            reranked = rank([r for r in rows if matches_locks(r, request.locks)], modified, population["reference"]["bounds"], active)
            original = next((r for r in reranked if r["portfolio_id"] == accepted["portfolio_id"]), None)
            local_sensitivity.append({"criterion": criterion, "multiplier": multiplier,
                "weights": normalize_weights(modified), "leader_id": reranked[0]["portfolio_id"] if reranked else None,
                "original_recommendation_rank": original["rank"] if original else None,
                "score_gap_to_original": reranked[0]["score"] - original["score"] if original else None,
                "leader_changed": (reranked[0]["portfolio_id"] != leader["portfolio_id"]) if reranked and leader else None})
    extrema = {} if not ranking else {
        "max_vpub": min(ranking, key=lambda r: (-r["metrics"]["vpub_mrub_per_year"], r["rank"]))["portfolio_id"],
        "min_c0": min(ranking, key=lambda r: (r["metrics"]["c0_mrub"], r["rank"]))["portfolio_id"]}
    return {"format_version": VERSION, "context": request.context, "active_scenario": active,
            "input_fingerprint": hashlib.sha256(canonical_json(request.model_dump())).hexdigest(),
            "ranking_context": {"method_version": request.search.method_version, "reference": population["reference"],
                                "weights": {"original": weights, "applied": normalize_weights(weights)}, "tie_break": TIE_BREAK,
                                "outside_base_range": "Fixed BASE formula extrapolates; values are not clamped or renormalized."},
            "budget": {"cap": cap, "current_margin": cap - current["metrics"]["c0_mrub"],
                       "current_breakpoint": current["metrics"]["c0_mrub"], "eps": EPS,
                       "current_acceptance_boundary": acceptance_boundary(current["metrics"]["c0_mrub"]),
                       "minimum_feasible_budget": minimum,
                       "minimum_acceptance_boundary": None if minimum is None else acceptance_boundary(minimum),
                       "budget_only_blocker": not ranking and minimum is not None,
                       "current_budget_suffices_only_if_other_constraints_pass": True},
            "status": "FEASIBLE_OPTIONS" if ranking else "NO_SOLUTION",
            "message": "Допустимые решения найдены." if ranking else "При заданных условиях допустимого решения нет.",
            "no_solution_reason": None if ranking else "BUDGET_ONLY" if eligible else "NON_BUDGET_CONSTRAINTS_OR_LOCKS",
            "locks": [lock.model_dump() for lock in request.locks],
            "current": {"candidate": current, "locks_satisfied": locked,
                        "feasible": current["scenarios"][active]["ok"] and locked, "diagnostics": diagnostics},
            "feasible_count": len(ranking), "recovery": recovery(current, ranking, active),
            "accepted_recommendation_id": accepted["portfolio_id"], "local_sensitivity": local_sensitivity,
            "recommendation": None if leader is None else proposal(current, leader, active, ["EXISTING_MCDA"]),
            "explanation": explain(ranking, active),
            "transition_map": transition_map(eligible, weights, population["reference"]["bounds"], scenario),
            "explorer": {"projection": "C0 × VPUB; two of eight criteria, not a multidimensional Pareto frontier",
                         "extrema": extrema, "strong_alternatives": [r["portfolio_id"] for r in ranking[1:4]],
                         "points": [{"portfolio_id": r["portfolio_id"], "selection": r["selection"],
                                     "metrics": r["metrics"], "rank": r["rank"], "score": r["score"]} for r in ranking]}}
