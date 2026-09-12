"""Declared team preferences and fixed-population weighted MCDA, not a case score."""
from __future__ import annotations

import math
from typing import Annotated

from pydantic import Field, model_validator

from .case_loader import PROJECT_ROOT
from .contracts import ServiceError, parse_json
from .schemas import StrictModel

METHOD_VERSION = "weighted-mcda/base-reference/1"
FIELDS = {"vpub": "vpub_mrub_per_year", "c0": "c0_mrub", "opex": "opex_mrub_per_year",
          "kcash": "kcash", "t_rep": "t_rep", "readiness": "readiness_1_5",
          "resilience": "resilience_1_5", "scale": "scale_1_5"}
DIRECTIONS = {key: "minimize" if key in ("c0", "opex") else "maximize" for key in FIELDS}
TIE_BREAK = ["unrounded_score_descending", "c0_mrub_ascending", "lexicographic_sorted_lot_id_mode_id"]
Weight = Annotated[float, Field(ge=0, allow_inf_nan=False)]


class Weights(StrictModel):
    vpub: Weight
    c0: Weight
    opex: Weight
    kcash: Weight
    t_rep: Weight
    readiness: Weight
    resilience: Weight
    scale: Weight

    @model_validator(mode="after")
    def positive_total(self):
        if not any(self.model_dump().values()):
            raise ValueError("Сумма весов должна быть больше нуля.")
        return self


def normalize_weights(weights: dict) -> dict:
    values = Weights.model_validate(weights).model_dump()
    # Scaling first supports every finite input without overflowing the sum.
    largest = max(values.values())
    scaled = {key: value / largest for key, value in values.items()}
    total = math.fsum(scaled.values())
    return {key: value / total for key, value in scaled.items()}


def normalize_metrics(metrics: dict, bounds: dict) -> dict:
    result = {}
    for key, field in FIELDS.items():
        low, high = bounds[key]["min"], bounds[key]["max"]
        result[key] = (0.0 if high == low else
                       (high - metrics[field]) / (high - low) if DIRECTIONS[key] == "minimize" else
                       (metrics[field] - low) / (high - low))
    return result


def rank(population: list[dict], weights: dict, bounds: dict, scenario: str) -> list[dict]:
    applied = normalize_weights(weights)
    scored = []
    for row in population:
        if not row["scenarios"][scenario]["ok"]:
            continue
        normalized = normalize_metrics(row["metrics"], bounds)
        contributions = {key: applied[key] * normalized[key] for key in FIELDS}
        scored.append({**row, "normalized": normalized, "contributions": contributions,
                       "score": math.fsum(contributions.values())})
    scored.sort(key=lambda row: (-row["score"], row["metrics"]["c0_mrub"], row["portfolio_id"]))
    return [{**row, "rank": index + 1} for index, row in enumerate(scored)]


def declared_method():
    """M0 file is preferences/provenance, never a source of computed answers."""
    try:
        declared = parse_json((PROJECT_ROOT / "config/decision.json").read_bytes())
        weights = Weights.model_validate(declared["weights"]).model_dump()
        equal = Weights.model_validate(declared["equal_weight_profile"]).model_dump()
        return {"method_version": METHOD_VERSION, "name": "Weighted MCDA — модель команды",
                "weights": weights, "applied_weights": normalize_weights(weights),
                "equal_weight_profile": equal, "provenance": declared["provenance"],
                "strategy_thesis": declared["strategy_thesis"], "limitations": [*declared["limitations"],
                    "C0 и OPEX могут коррелировать; OPEX также стоит в знаменателе KCASH. t_rep и readiness могут отражать связанные свойства. Равные интервалы полезности этих индексов — допущение метода, а не факт источника.",
                    "В M0 суммарный вес C0/OPEX/KCASH больше веса отдельного VPUB. Это взвешенный компромисс, не лексикографический приоритет VPUB и не веса официальной рубрики 75/25."],
                "field_mapping": FIELDS, "directions": DIRECTIONS, "tie_break": TIE_BREAK,
                "score_interpretation": "Вспомогательный безразмерный индекс предпочтений; не официальная оценка, деньги или вероятность.",
                "reference_rule": "Все BASE-feasible A/B/C этой версии; одна шкала для BASE, STRESS и альтернатив.",
                "constant_criterion_contribution": 0,
                "sensitivity": {"criteria": ["vpub", "c0"], "multipliers": [0.8, 1.2]},
                "recommendation_rule": "Лидер MCDA среди BASE-feasible. При STRESS сохранить его, если допустим; иначе пересмотреть состав на лидера STRESS с теми же весами и шкалой. Переход требует решения заказчика и новой проверки условий реализации."}
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise ServiceError("decision_method_unavailable", "Не удалось прочитать объявленную конфигурацию метода.", 503) from exc
