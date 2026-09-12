"""Optional, read-only research. Adapted ideas, not the donor dependency graph."""
from __future__ import annotations

from copy import deepcopy
import hashlib
import math
from typing import Annotated, Literal

from pydantic import Field

from .canonical_adapter import evaluate
from .case_loader import CaseRepository
from .contracts import EPS, ServiceError, canonical_json
from .decision import evaluation_input
from .decision_model import rank
from .intelligence import (IntelligenceRequest, acceptance_boundary, analyze,
                           eligible_without_budget, matches_locks, research_rows)
from .schemas import StrictModel, validate_request
from .search import get_population

VERSION = "kosmos-research-math/1"
Nonnegative = Annotated[float, Field(ge=0, allow_inf_nan=False)]


class CostRiskSettings(StrictModel):
    sigma: Nonnegative
    rho: Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]
    q: Annotated[float, Field(gt=0, lt=1, allow_inf_nan=False)]


class ResearchRequest(StrictModel):
    format_version: Literal[VERSION]
    intelligence: IntelligenceRequest
    u: Nonnegative = 0.0
    cost_risk: CostRiskSettings | None = None


def budget_effect(rows, weights, bounds, scenario, cap, uplift, locks):
    """Exact step envelope. Equal-value tie changes do not create value jumps."""
    eligible = eligible_without_budget(rows, scenario, locks)
    max_cap = max((r["metrics"]["c0_mrub"] * (1 + uplift) for r in eligible), default=0)
    ordered = rank(research_rows(eligible, scenario, max_cap, uplift), weights, bounds, "RESEARCH")
    events, levels = [], []
    best = None
    key = lambda r: (-r["metrics"]["vpub_mrub_per_year"], r["rank"])
    groups = {}
    for row in ordered:
        boundary = acceptance_boundary(row["metrics"]["c0_mrub"] * (1 + uplift))
        groups.setdefault(boundary, []).append(row)
    for boundary, group in sorted(groups.items()):
        winner = min(group, key=key)
        if best is not None and key(winner) >= key(best):
            continue
        point = {"lower_inclusive": boundary, "upper_exclusive": None,
                 "budget_threshold": winner["metrics"]["c0_mrub"] * (1 + uplift),
                 "vpub": winner["metrics"]["vpub_mrub_per_year"],
                 "portfolio_id": winner["portfolio_id"], "request": evaluation_input(winner),
                 "canonical_c0": winner["metrics"]["c0_mrub"]}
        if events:
            events[-1]["upper_exclusive"] = boundary
        events.append(point)
        if best is None or point["vpub"] > best["metrics"]["vpub_mrub_per_year"]:
            if levels:
                levels[-1]["upper_exclusive"] = boundary
            levels.append(deepcopy(point))
        best = winner
    current = next((p for p in reversed(events) if p["lower_inclusive"] <= cap), None)
    following = next((p for p in levels if p["lower_inclusive"] > cap and
                      (current is None or p["vpub"] > current["vpub"])), None)
    return {"current": current, "next": None if following is None else {
                **following, "required_increase": max(following["budget_threshold"] - cap, 0),
                "delta_vpub": None if current is None else following["vpub"] - current["vpub"]},
            "levels": levels, "candidate_intervals": events,
            "tie_break": "VPUB descending, then existing MCDA rank: score descending, canonical C0 ascending, portfolio_id ascending",
            "formula": "F(B)=max VPUB with other hard constraints, locks and C0*(1+u)<=B+EPS",
            "eps": EPS, "before_first": "NO_SOLUTION"}


def verify_candidate(candidate, repository, scenario, cap, uplift, locks):
    """Public strict adapter + same research condition, never canonical PASS alone."""
    result = evaluate(evaluation_input(candidate), repository)
    checks = {d["id"]: d["ok"] for d in result["scenarios"][scenario]["diagnostics"]}
    c0 = result["metrics"]["c0_mrub"]
    research_c0 = c0 * (1 + uplift)
    checks["c0_limit"] = research_c0 <= cap + EPS
    locked = matches_locks(candidate, locks)
    return {"portfolio_id": candidate["portfolio_id"], "checks": checks,
            "locks_satisfied": locked, "feasible": all(checks.values()) and locked,
            "canonical_c0": c0, "research_c0": research_c0, "cap": cap,
            "margin": cap - research_c0, "u": uplift,
            "critical_u": cap / c0 - 1, "selection": result["selection"]}


def research_math(value, repository: CaseRepository | None = None):
    request = validate_request(ResearchRequest, value)
    if request.intelligence.context != "RESEARCH" or request.intelligence.budget_cap is None:
        raise ServiceError("research_only", "Исследование требует RESEARCH и явно заданного cap.")
    repository = repository or CaseRepository()
    settings = request.model_dump()
    analysis = analyze(settings["intelligence"], repository, uplift=request.u)
    snapshot = repository.load()
    population = get_population(snapshot)
    scenario = request.intelligence.search.scenario
    cap = request.intelligence.budget_cap
    locks = request.intelligence.locks
    effect = budget_effect(population["rows"], request.intelligence.search.weights.model_dump(),
                           population["reference"]["bounds"], scenario, cap, request.u, locks)
    current = analysis["current"]["candidate"]
    proof = verify_candidate(current, repository, scenario, cap, request.u, locks)
    proposals = [*analysis["recovery"]]
    if analysis["recommendation"]:
        proposals.append(analysis["recommendation"])
    for item in proposals:
        item["research_check"] = verify_candidate(item["candidate"], repository, scenario, cap, request.u, locks)
        if not item["research_check"]["feasible"]:
            raise ServiceError("research_verification_failed", "Повторная проверка корректировки не пройдена.", 500)
        item["research_delta_c0"] = item["research_check"]["research_c0"] - proof["research_c0"]
    # Same context for a maximum-VPUB comparison; the next step is checked at its own explicit threshold.
    for name in ("current", "next"):
        point = effect[name]
        if point:
            candidate = next(r for r in population["rows"] if r["portfolio_id"] == point["portfolio_id"])
            point["research_check"] = verify_candidate(candidate, repository, scenario,
                cap if name == "current" else point["budget_threshold"], request.u, locks)
            if not point["research_check"]["feasible"]:
                raise ServiceError("research_verification_failed", "Проверка бюджетного порога не пройдена.", 500)
            if name == "next":
                point["at_current_cap"] = verify_candidate(candidate, repository, scenario, cap, request.u, locks)
    risk = None
    if request.cost_risk is not None:
        from .research_risk import cost_risk
        bundle = evaluate(evaluation_input(current), repository)
        try:
            risk = cost_risk([row["c0_mrub"] for row in bundle["detail"]], cap, request.u,
                             **request.cost_risk.model_dump())
        except ValueError as exc:
            raise ServiceError("invalid_cost_risk", str(exc)) from exc
        risk["hard_constraints_and_locks_satisfied"] = proof["feasible"]
    if request.u or request.cost_risk is not None:
        analysis["input_fingerprint"] = hashlib.sha256(canonical_json(settings)).hexdigest()
    return {"format_version": VERSION, "context": "RESEARCH",
            "input_fingerprint": hashlib.sha256(canonical_json(settings)).hexdigest(),
            "settings": {"u": request.u, "cap": cap, "scenario": scenario,
                         "locks": [lock.model_dump() for lock in locks],
                         "cost_risk": None if request.cost_risk is None else request.cost_risk.model_dump()},
            "analysis": analysis, "current": proof, "budget_effect": effect, "cost_risk": risk}
