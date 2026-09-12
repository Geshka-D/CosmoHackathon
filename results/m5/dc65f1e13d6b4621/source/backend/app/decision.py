"""Reproducible choice, explicit alternative strategies and stress action."""
from __future__ import annotations

import hashlib
from typing import Annotated, Literal

from pydantic import Field

from .canonical_adapter import evaluate_validated
from .case_loader import CaseRepository
from .contracts import CASE_ID, CASE_VERSION, SCHEMA_VERSION, ServiceError, canonical_json
from .decision_model import FIELDS, declared_method, normalize_weights, rank
from .decision_context import service_context
from .schemas import EvaluateRequest, StrictModel, validate_request
from .search import SearchRequest, get_population, search_validated
from .sensitivity import selection_changes, sensitivity_validated

DECISION_VERSION = "kosmos-decision/1"


class DecisionEnvelope(StrictModel):
    format_version: Literal[DECISION_VERSION]
    request: SearchRequest
    expected_population_id: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")] | None = None


def evaluation_input(row):
    return {"schema_version": SCHEMA_VERSION, "case_id": CASE_ID, "case_version": CASE_VERSION, "selection": row["selection"]}


def comparison_delta(reference, alternative):
    return {field: value - reference["metrics"][field] for field, value in alternative["metrics"].items()
            if isinstance(value, (int, float)) and not isinstance(value, bool)}


def recompute_decision(value, repository: CaseRepository | None = None):
    envelope = validate_request(DecisionEnvelope, value)
    snapshot = (repository or CaseRepository()).load()
    if envelope.request.source_hashes != snapshot.source_hashes:
        raise ServiceError("incompatible_sources", "Конфигурация поиска относится к другой версии источников.")
    population = get_population(snapshot)
    if envelope.expected_population_id is not None and envelope.expected_population_id != population["reference"]["population_id"]:
        raise ServiceError("incompatible_population", "Эталонная BASE-популяция отличается от сохранённой. Результаты не импортированы.")
    weights = envelope.request.weights.model_dump()
    bounds = population["reference"]["bounds"]
    rankings = {scenario: rank(population["rows"], weights, bounds, scenario) for scenario in ("BASE", "STRESS")}
    if not rankings["BASE"] or not rankings["STRESS"]:
        raise ServiceError("no_feasible_strategy", "Для заявленного правила нет допустимой BASE или STRESS стратегии.")
    base = rankings["BASE"][0]
    stress = base if base["scenarios"]["STRESS"]["ok"] else rankings["STRESS"][0]
    scenario = envelope.request.scenario
    current = rankings[scenario][0]
    chosen = rankings[scenario]
    max_vpub = min(rankings["BASE"], key=lambda r: (-r["metrics"]["vpub_mrub_per_year"], r["metrics"]["c0_mrub"], r["portfolio_id"]))
    min_c0 = min(rankings["BASE"], key=lambda r: (r["metrics"]["c0_mrub"], r["portfolio_id"]))
    equal = rank(population["rows"], {key: 1.0 for key in FIELDS}, bounds, "BASE")[0]
    strategies = [
        ("weighted_mcda", "BASE: баланс объявленных предпочтений", base, "Лидер BASE по восьми взвешенным критериям; может уступать по отдельному показателю."),
        ("max_vpub", "BASE: максимум общественной ценности", max_vpub, "Максимизировать VPUB после BASE-ограничений; общественная ценность не является CASH и не покрывает бюджетный разрыв."),
        ("min_c0", "BASE: минимум стартовых затрат", min_c0, "Снизить C0 после BASE-ограничений; экономия может сопровождаться меньшей VPUB или операционным дефицитом."),
        ("equal_weights", "BASE: равные веса восьми критериев", equal, "Альтернативный профиль 1/8 на BASE; проверка зависимости решения от исходных предпочтений и финансового акцента."),
        ("stress_action", "Действие при STRESS", stress, "Сохранить BASE-лидера, если он допустим; иначе взять STRESS-лидера с теми же весами и фиксированной шкалой."),
    ]
    alternatives = []
    first_ids = {}
    for strategy_id, title, row, rationale in strategies:
        # The score/rank under current weights/scenario is separate from a
        # strategy's own objective. Infeasible entries never receive a rank.
        current_row = next((r for r in chosen if r["portfolio_id"] == row["portfolio_id"]), None)
        alternatives.append({"strategy_id": strategy_id, "title": title, "rationale": rationale,
                             "strategy_weights": {key: 0.125 for key in FIELDS} if strategy_id == "equal_weights" else normalize_weights(weights),
                             "service_context": service_context(row["selection"], snapshot),
                             "candidate": row, "current_profile_score": current_row["score"] if current_row else None,
                             "current_profile_rank": current_row["rank"] if current_row else None,
                             "same_portfolio_as": first_ids.get(row["portfolio_id"]),
                             "request": evaluation_input(row), "delta_to_current_leader": comparison_delta(current, row),
                             "selection_changes": selection_changes(current["selection"], row["selection"])})
        first_ids.setdefault(row["portfolio_id"], strategy_id)
    config = {"format_version": DECISION_VERSION, "request": envelope.request.model_dump(),
              "expected_population_id": population["reference"]["population_id"]}
    selected_results = {"BASE": evaluate_validated(EvaluateRequest.model_validate(evaluation_input(base)), snapshot),
                        "STRESS": evaluate_validated(EvaluateRequest.model_validate(evaluation_input(stress)), snapshot)}
    return {"format_version": DECISION_VERSION, "configuration": config,
            "input_fingerprint": hashlib.sha256(canonical_json(config)).hexdigest(), "method": declared_method(),
            "search": search_validated(envelope.request, snapshot, population),
            "sensitivity": sensitivity_validated(envelope.request, snapshot, population),
            "recommendation": {"base": base, "stress": stress,
                               "action": "RETAIN" if base["portfolio_id"] == stress["portfolio_id"] else "REVISE",
                               "selection_changes": selection_changes(base["selection"], stress["selection"]),
                               "stress_delta_to_base": comparison_delta(base, stress),
                               "results": selected_results,
                               "condition": "Решение принимает условный межрегиональный заказчик совместно с плательщиками и владельцами задач до необратимых обязательств (допущение A10). Изменение состава не возвращает уже потраченный C0; переходные затраты и остаточные обязательства не заданы. Финансирование запуска, адресное покрытие дефицитов, местное качество и права доступа требуют M4. Межлотовое перераспределение CASH не предполагается автоматически.",
                               "assumption_refs": ["config/assumptions.json#A10"],
                               "service_context": service_context(base["selection"], snapshot)},
            "alternatives": alternatives, "distinct_strategy_portfolios": len(first_ids)}
