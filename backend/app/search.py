"""Exhaustive A/B/C search. Every row is independently reproducible with original core."""
from __future__ import annotations

from collections import OrderedDict
from copy import deepcopy
import hashlib
from itertools import combinations, product
from threading import RLock
from typing import Annotated, Literal

import numpy as np
from pydantic import Field, field_validator

from .canonical_adapter import INDICES
from .case_loader import CaseRepository, CaseSnapshot
from .constraints import RULES
from .contracts import CASE_ID, CASE_VERSION, ServiceError, canonical_json
from .decision_model import FIELDS, METHOD_VERSION, TIE_BREAK, Weights, normalize_weights, rank
from .schemas import EvaluateRequest, StrictModel, validate_request

SEARCH_VERSION = "kosmos-search/1"
ENGINE_VERSION = "original-contributions-numpy-aggregate/1"
_CACHE: OrderedDict[str, dict] = OrderedDict()
_SEARCH_CACHE: OrderedDict[str, dict] = OrderedDict()
_LOCK = RLock()


class SearchRequest(StrictModel):
    format_version: Literal[SEARCH_VERSION]
    case_id: Literal[CASE_ID]
    case_version: Literal[CASE_VERSION]
    source_hashes: dict[str, str]
    modes: Literal["A/B/C"]
    method_version: Literal[METHOD_VERSION]
    scenario: Literal["BASE", "STRESS"]
    weights: Weights
    limit: Annotated[int, Field(ge=1, le=100)] = 10
    baseline: EvaluateRequest | None = None

    @field_validator("baseline")
    @classmethod
    def complete_baseline(cls, value):
        if value is not None and len(value.selection) != 4:
            raise ValueError("Для исходного решения sensitivity нужны четыре уникальных лота.")
        return value


def snapshot_identity(snapshot: CaseSnapshot) -> str:
    return hashlib.sha256(canonical_json({"engine_version": ENGINE_VERSION, "source_hashes": snapshot.source_hashes,
                                         "lots": snapshot.lots.to_dict("records"), "modes": snapshot.modes.to_dict("records"),
                                         "config": snapshot.config})).hexdigest()


def portfolio_id(selection):
    return "|".join(f"{row['lot_id']}:{row['mode_id']}" for row in selection)


def enumerate_population(snapshot: CaseSnapshot, engine: str = "fast") -> list[dict]:
    """No cache here: a public Python seam for all-5670 original/fast verification.

    Fast uses original apply_mode and check_constraints. Numpy reductions use the
    same sorted four-row order as the canonical adapter/pandas original engine.
    """
    if engine not in ("fast", "original"):
        raise ValueError("engine must be fast or original")
    lots = {row.lot_id: row for row in snapshot.lots.itertuples(index=False)}
    modes = {row.mode_id: row for row in snapshot.modes.itertuples(index=False)}
    pairs = {(lot, mode): snapshot.core.apply_mode(lots[lot], modes[mode]) for lot in sorted(lots) for mode in sorted(modes)}
    sums = ("c0_mrub", "opex_mrub_per_year", "vpub_mrub_per_year", "cash_mrub_per_year")
    population = []
    for ids in combinations(sorted(lots), 4):
        for access in product(sorted(modes), repeat=4):
            keys = list(zip(ids, access))
            selection = [{"lot_id": lot, "mode_id": mode} for lot, mode in keys]
            rows = [pairs[key] for key in keys]
            if engine == "original":
                _, metrics = snapshot.core.evaluate_portfolio(keys, snapshot.lots, snapshot.modes, snapshot.config)
            else:
                metrics = {field: float(np.array([r[field] for r in rows], dtype=float).sum()) for field in sums}
                metrics.update({field: float(np.array([r[field] for r in rows], dtype=float).mean()) for field in INDICES})
                caps = set()
                for row in rows:
                    for token in str(row["capability_groups"]).split(";"):
                        caps |= snapshot.core.normalize_capability(token)
                metrics.update(selected_lots=4, kcash=metrics["cash_mrub_per_year"] / metrics["opex_mrub_per_year"],
                               territorial_archetypes=len({r["territorial_archetype"] for r in rows if not r["federal"]}),
                               capability_groups=len(caps), capability_set=sorted(caps),
                               public_core_lots=sum(r["public_core"] for r in rows))
            for field, coefficient in (("anchor_cash_mrub_per_year", "k_anchor"), ("commercial_cash_mrub_per_year", "k_commercial")):
                metrics[field] = float(np.array([float(getattr(lots[lot], field)) * float(getattr(modes[mode], coefficient)) for lot, mode in keys]).sum())
            scenarios = {}
            for scenario in ("BASE", "STRESS"):
                frame = snapshot.core.check_constraints(metrics, snapshot.config, scenario)
                checks = {str(row.constraint): bool(row.ok) for row in frame.itertuples(index=False)}
                ok = all(checks.values())
                scenarios[scenario] = {"ok": ok, "status": "PASS" if ok else "FAIL", "checks": checks,
                                       "c0_limit": snapshot.config["scenarios"][scenario]["c0_max_mrub"],
                                       "c0_margin": snapshot.config["scenarios"][scenario]["c0_max_mrub"] - metrics["c0_mrub"]}
            population.append({"portfolio_id": portfolio_id(selection), "selection": selection, "metrics": metrics,
                               "scenarios": scenarios, "public_core_ids": [r["lot_id"] for r in rows if r["public_core"]],
                               "net_operating_balance": metrics["cash_mrub_per_year"] - metrics["opex_mrub_per_year"],
                               "portfolio_funding_gap": max(metrics["opex_mrub_per_year"] - metrics["cash_mrub_per_year"], 0),
                               "sum_lot_funding_gaps": sum(max(r["opex_mrub_per_year"] - r["cash_mrub_per_year"], 0) for r in rows)})
    return population


def get_population(snapshot: CaseSnapshot) -> dict:
    identity = snapshot_identity(snapshot)
    with _LOCK:
        if identity in _CACHE:
            _CACHE.move_to_end(identity)
            return deepcopy(_CACHE[identity])
        rows = enumerate_population(snapshot)
        base = [r for r in rows if r["scenarios"]["BASE"]["ok"]]
        if not base:
            raise ServiceError("empty_reference", "Нет допустимых BASE-вариантов для фиксированной шкалы.", 422)
        bounds = {key: {"min": min(row["metrics"][field] for row in base), "max": max(row["metrics"][field] for row in base)} for key, field in FIELDS.items()}
        reference = {"population_id": hashlib.sha256(canonical_json({"identity": identity, "members": base})).hexdigest(),
                     "definition": "All BASE-feasible four-lot canonical A/B/C selections for these verified sources, independent of weights and display limit",
                     "size": len(base), "scenario": "BASE", "modes": "A/B/C", "bounds": bounds,
                     "source_identity": identity, "constant_criterion_contribution": 0,
                     "same_scale_in_stress_and_comparison": True}
        summary = {}
        for scenario in ("BASE", "STRESS"):
            feasible = sum(row["scenarios"][scenario]["ok"] for row in rows)
            summary[scenario] = {"feasible": feasible, "excluded": len(rows) - feasible,
                                 "exclusion_reasons": [{"id": rule[0], "condition": rule[4],
                                                        "count": sum(not row["scenarios"][scenario]["checks"][rule[0]] for row in rows)} for rule in RULES],
                                 "reasons_overlap": True}
        value = {"rows": rows, "reference": reference, "summary": {"total": len(rows), "scenarios": summary,
                 "stress_is_subset_of_base": all(not row["scenarios"]["STRESS"]["ok"] or row["scenarios"]["BASE"]["ok"] for row in rows)}}
        _CACHE[identity] = value
        while len(_CACHE) > 2:
            _CACHE.popitem(last=False)
        return deepcopy(value)


def search_validated(request: SearchRequest, snapshot: CaseSnapshot, population=None) -> dict:
    if request.source_hashes != snapshot.source_hashes:
        raise ServiceError("incompatible_sources", "Поиск относится к другой версии источников.")
    population = population or get_population(snapshot)
    weights = request.weights.model_dump()
    applied = normalize_weights(weights)
    identity = {"operation": "search", "source_identity": population["reference"]["source_identity"], "request": request.model_dump(),
                "applied_weights": applied, "method_version": METHOD_VERSION, "reference": population["reference"]}
    fingerprint = hashlib.sha256(canonical_json(identity)).hexdigest()
    with _LOCK:
        if fingerprint in _SEARCH_CACHE:
            _SEARCH_CACHE.move_to_end(fingerprint)
            return deepcopy(_SEARCH_CACHE[fingerprint])
    ranking = rank(population["rows"], weights, population["reference"]["bounds"], request.scenario)
    result = {"format_version": SEARCH_VERSION, "original_request": request.model_dump(),
            "input_fingerprint": fingerprint,
            "weights": {"original": weights, "applied": applied}, "scenario": request.scenario,
            "reference_population": population["reference"], "population": population["summary"],
            "tie_break": TIE_BREAK, "ranking": ranking[:request.limit], "ranked_count": len(ranking),
            "engine_version": ENGINE_VERSION}
    with _LOCK:
        _SEARCH_CACHE[fingerprint] = deepcopy(result)
        while len(_SEARCH_CACHE) > 16:
            _SEARCH_CACHE.popitem(last=False)
    return result


def search(value, repository: CaseRepository | None = None):
    request = validate_request(SearchRequest, value)
    snapshot = (repository or CaseRepository()).load()  # verify before any cache lookup
    return search_validated(request, snapshot)
