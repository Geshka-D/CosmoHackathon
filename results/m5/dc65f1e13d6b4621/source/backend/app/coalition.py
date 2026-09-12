"""Exact Shapley allocation for the proposed shared regional platform."""
from __future__ import annotations

from itertools import combinations
from math import factorial
from typing import Annotated, Callable, Literal

from pydantic import Field

from .canonical_adapter import evaluate_validated
from .case_loader import CaseRepository, CaseSnapshot
from .contracts import CASE_ID, CASE_VERSION, EPS, ServiceError
from .schemas import EvaluateRequest, StrictModel, validate_request
from .team_assumptions import load_analysis_presets, load_team_settings

VERSION = "kosmos-coalition/1"


class CoalitionRequest(StrictModel):
    format_version: Literal[VERSION]
    case_id: Literal[CASE_ID]
    case_version: Literal[CASE_VERSION]
    source_hashes: dict[str, str]
    request: EvaluateRequest
    phi: Annotated[float | None, Field(ge=0, le=1)] = None


def powerset(values):
    values = tuple(values)
    for size in range(len(values) + 1):
        yield from combinations(values, size)


def shapley_values(players: list[str], cost: Callable[[frozenset[str]], float]) -> dict[str, float]:
    n = len(players)
    result = {player: 0.0 for player in players}
    for player in players:
        others = [value for value in players if value != player]
        for subset in powerset(others):
            coalition = frozenset(subset)
            weight = factorial(len(coalition)) * factorial(n - len(coalition) - 1) / factorial(n)
            result[player] += weight * (cost(coalition | {player}) - cost(coalition))
    return result


def characteristic_cost(players: dict[str, dict], coalition: frozenset[str], phi: float) -> float:
    if not coalition:
        return 0.0
    groups = sorted({group for player in coalition for group in players[player]["capabilities"]})
    platform = sum(phi * max(players[player]["c0_mrub"] / len(players[player]["capabilities"])
                             for player in coalition if group in players[player]["capabilities"])
                   for group in groups)
    regional = sum((1.0 - phi) * players[player]["c0_mrub"] for player in coalition)
    return platform + regional


def _players(result: dict, snapshot: CaseSnapshot) -> dict[str, dict]:
    values = {}
    for row in result["detail"]:
        capabilities = set()
        for token in str(row["capability_groups"]).split(";"):
            capabilities |= snapshot.core.normalize_capability(token)
        values[row["lot_id"]] = {"lot_id": row["lot_id"], "mode_id": row["mode_id"],
                                  "region": row["territorial_archetype"], "c0_mrub": row["c0_mrub"],
                                  "capabilities": sorted(capabilities)}
    return values


def analyse_result(result: dict, snapshot: CaseSnapshot, phi: float, sensitivity_values: list[float] | None = None) -> dict:
    players = _players(result, snapshot)
    ids = sorted(players)

    def compute(value):
        cost = lambda subset: characteristic_cost(players, subset, value)
        allocation = shapley_values(ids, cost)
        grand = cost(frozenset(ids))
        inequalities = []
        for subset in powerset(ids):
            if not subset or len(subset) == len(ids):
                continue
            subset_set = frozenset(subset)
            allocated = sum(allocation[player] for player in subset)
            standalone = cost(subset_set)
            inequalities.append({"coalition": list(subset), "allocated_mrub": allocated,
                                 "standalone_mrub": standalone, "margin_mrub": standalone - allocated,
                                 "ok": allocated <= standalone + EPS})
        return allocation, grand, inequalities

    allocation, grand, inequalities = compute(phi)
    standalone_total = sum(player["c0_mrub"] for player in players.values())
    proportional = {player: grand * players[player]["c0_mrub"] / standalone_total for player in ids}
    equal = {player: grand / len(ids) for player in ids}
    rows = []
    for player in ids:
        info = players[player]
        rows.append({**info, "standalone_mrub": info["c0_mrub"], "shapley_mrub": allocation[player],
                     "share": allocation[player] / grand, "proportional_mrub": proportional[player],
                     "equal_mrub": equal[player]})
    sensitivity = []
    for value in sensitivity_values or []:
        values, total, checks = compute(value)
        sensitivity.append({"phi": value, "grand_cost_mrub": total,
                            "shares": {player: values[player] / total for player in ids},
                            "core_ok": all(item["ok"] for item in checks)})
    return {"format_version": VERSION, "marker": "TEAM_INDICATOR", "phi": phi,
            "phi_source": "config/assumptions.json#A21", "players": rows,
            "standalone_total_mrub": standalone_total, "grand_cost_mrub": grand,
            "cooperation_savings_mrub": standalone_total - grand,
            "cooperation_savings_share": (standalone_total - grand) / standalone_total,
            "efficiency_error_mrub": sum(allocation.values()) - grand,
            "core": {"ok": all(item["ok"] for item in inequalities), "checked": len(inequalities),
                     "inequalities": inequalities}, "sensitivity": sensitivity,
            "formulas": {"characteristic_cost": "sum_g phi*max(c0_r/|caps(r)|) + sum_r (1-phi)*c0_r",
                         "shapley": "sum over S of |S|!*(n-|S|-1)!/n! * (c(S union r)-c(S))",
                         "core": "sum allocation_r for r in S <= c(S)"},
            "unit": "млн руб. стартовых затрат", "assumption_refs": ["config/assumptions.json#A21"]}


def coalition(value, repository: CaseRepository | None = None):
    request = validate_request(CoalitionRequest, value)
    repository = repository or CaseRepository()
    snapshot = repository.load()
    if request.source_hashes != snapshot.source_hashes:
        raise ServiceError("incompatible_sources", "Запрос консорциума относится к другой версии источников.")
    if len(request.request.selection) != 4:
        raise ServiceError("incomplete_portfolio", "Для распределения затрат нужны четыре лота.")
    settings = load_team_settings(repository.root)
    phi = settings.phi if request.phi is None else request.phi
    result = evaluate_validated(request.request, snapshot, settings)
    presets = load_analysis_presets(repository.root)
    analysis = analyse_result(result, snapshot, phi, presets["phi_sensitivity"])
    analysis["request"] = request.model_dump()
    analysis["result_fingerprint"] = result["input_fingerprint"]
    return analysis
