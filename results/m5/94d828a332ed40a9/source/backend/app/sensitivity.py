"""Four independent preference perturbations on one fixed BASE reference."""
from __future__ import annotations

import hashlib

from .case_loader import CaseRepository
from .contracts import canonical_json
from .decision_model import FIELDS, normalize_weights, rank
from .search import SearchRequest, get_population, portfolio_id, search_validated
from .schemas import validate_request


def selection_changes(before, after):
    prior = {r["lot_id"]: r["mode_id"] for r in before}
    current = {r["lot_id"]: r["mode_id"] for r in after}
    return {"added": sorted(set(current) - set(prior)), "removed": sorted(set(prior) - set(current)),
            "mode_changes": [{"lot_id": lot, "from": prior[lot], "to": current[lot]} for lot in sorted(set(prior) & set(current)) if prior[lot] != current[lot]],
            "unchanged": prior == current}


def sensitivity_validated(request, snapshot, population=None):
    population = population or get_population(snapshot)
    baseline = search_validated(request, snapshot, population)
    if not baseline["ranking"]:
        return {"baseline": baseline, "original_choice": None, "runs": [], "status": "NO_FEASIBLE_PORTFOLIOS"}
    if request.baseline is None:
        choice = baseline["ranking"][0]
    else:
        selected_id = portfolio_id(sorted(request.baseline.model_dump()["selection"], key=lambda r: (r["lot_id"], r["mode_id"])))
        choice = next(row for row in population["rows"] if row["portfolio_id"] == selected_id)
    # Perturb a proportional copy, avoiding overflow even for weights near 1e308.
    normalized = normalize_weights(request.weights.model_dump())
    runs = []
    for criterion in ("vpub", "c0"):
        for multiplier in (0.8, 1.2):
            modified = {key: value * multiplier if key == criterion else value for key, value in normalized.items()}
            applied = normalize_weights(modified)
            ranking = rank(population["rows"], modified, population["reference"]["bounds"], request.scenario)
            original = next((row for row in ranking if row["portfolio_id"] == choice["portfolio_id"]), None)
            leader = ranking[0]
            runs.append({"criterion": criterion, "multiplier": multiplier, "original_weights": request.weights.model_dump(),
                         "input_fingerprint": hashlib.sha256(canonical_json({"operation": "sensitivity", "search_fingerprint": baseline["input_fingerprint"], "criterion": criterion, "multiplier": multiplier, "baseline_id": choice["portfolio_id"]})).hexdigest(),
                         "perturbed_proportional_weights": modified, "applied_weights": applied,
                         "zero_weight_unchanged": normalized[criterion] == 0, "leader": leader,
                         "original_choice_rank": original["rank"] if original else None, "original_choice_score": original["score"] if original else None,
                         "original_choice_status": "RANKED" if original else "INFEASIBLE_NOT_RANKED",
                         "selection_changes": selection_changes(choice["selection"], leader["selection"])})
    equal = {key: 1 / len(FIELDS) for key in FIELDS}
    equal_ranking = rank(population["rows"], equal, population["reference"]["bounds"], request.scenario)
    original_equal = next((row for row in equal_ranking if row["portfolio_id"] == choice["portfolio_id"]), None)
    return {"status": "COMPUTED", "baseline": baseline, "original_choice": choice, "runs": runs,
            "baseline_kind": "EXPLICIT_PORTFOLIO" if request.baseline else "CURRENT_PROFILE_LEADER",
            "equal_weight_profile": {"applied_weights": equal, "leader": equal_ranking[0],
                                     "original_choice_rank": original_equal["rank"] if original_equal else None, "original_choice_score": original_equal["score"] if original_equal else None,
                                     "selection_changes": selection_changes(choice["selection"], equal_ranking[0]["selection"])},
            "interpretation": "Четыре пересчёта предпочтений, не вероятность и не новый официальный STRESS. Нулевой вес остаётся нулевым; это явно отмечается."}


def sensitivity(value, repository: CaseRepository | None = None):
    request = validate_request(SearchRequest, value)
    return sensitivity_validated(request, (repository or CaseRepository()).load())
