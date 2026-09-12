"""Strict input models. Client-supplied results and source overrides are forbidden."""
from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from .contracts import CASE_ID, CASE_VERSION, LOT_IDS, SCHEMA_VERSION, ServiceError


class StrictModel(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", allow_inf_nan=False,
                              revalidate_instances="always")


class SelectionRow(StrictModel):
    lot_id: Annotated[str, Field(min_length=1, max_length=16)]
    mode_id: Literal["A", "B", "C"]

    @field_validator("lot_id")
    @classmethod
    def known_lot(cls, value):
        if value not in LOT_IDS:
            raise ValueError("Неизвестный lot_id; используйте каталог /api/case.")
        return value


class StressAction(StrictModel):
    lot_id: Annotated[str, Field(min_length=1, max_length=16)]
    from_mode: Literal["A", "B", "C"] = Field(alias="from")
    to: Literal["A", "B", "C"]

    @field_validator("lot_id")
    @classmethod
    def known_action_lot(cls, value):
        if value not in LOT_IDS:
            raise ValueError("Неизвестный lot_id в stress_plan.")
        return value

    @model_validator(mode="after")
    def changes_mode(self):
        if self.from_mode == self.to:
            raise ValueError("Договорный опцион должен менять режим.")
        return self


class StressPlan(StrictModel):
    trigger: Annotated[str, Field(min_length=1, max_length=500)]
    actions: Annotated[list[StressAction], Field(min_length=1, max_length=4)]
    rationale: Annotated[str, Field(min_length=1, max_length=2000)]

    @field_validator("actions")
    @classmethod
    def distinct_action_lots(cls, rows):
        if len({row.lot_id for row in rows}) != len(rows):
            raise ValueError("Каждый лот может встречаться в stress_plan один раз.")
        return rows


class TeamSettings(StrictModel):
    """Editable team assumptions; never a replacement for canonical case inputs."""
    optimism_uplift: Annotated[float, Field(ge=0, le=2)]
    sigma: Annotated[float, Field(ge=0, le=1)]
    rho: Annotated[float, Field(ge=0, le=1)]
    confidence: Annotated[float, Field(gt=0.5, lt=1)]
    alpha: Annotated[float, Field(ge=0, le=1)]
    phi: Annotated[float, Field(ge=0, le=1)]
    stress_plan: StressPlan


class EvaluateRequest(StrictModel):
    schema_version: Literal[SCHEMA_VERSION]
    case_id: Literal[CASE_ID]
    case_version: Literal[CASE_VERSION]
    selection: Annotated[list[SelectionRow], Field(max_length=4)]

    @field_validator("selection")
    @classmethod
    def distinct_lots(cls, rows):
        if len({row.lot_id for row in rows}) != len(rows):
            raise ValueError("Каждый lot_id разрешён только один раз, независимо от режима.")
        return rows


class Alternative(StrictModel):
    alternative_id: Annotated[str, Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")]
    request: EvaluateRequest

    @field_validator("request")
    @classmethod
    def complete(cls, value):
        if len(value.selection) != 4:
            raise ValueError("Для сравнения нужны четыре уникальных лота в каждом варианте.")
        return value


class CompareRequest(StrictModel):
    schema_version: Literal[SCHEMA_VERSION]
    alternatives: Annotated[list[Alternative], Field(min_length=2, max_length=10)]

    @field_validator("alternatives")
    @classmethod
    def distinct_ids(cls, values):
        if len({v.alternative_id for v in values}) != len(values):
            raise ValueError("alternative_id должен быть уникальным.")
        return values


def validate_request(model, value):
    try:
        return model.model_validate(value)
    except ValidationError as exc:
        issues = [{"location": list(e["loc"]), "type": e["type"], "message": e["msg"]}
                  for e in exc.errors(include_url=False, include_input=False)]
        raise ServiceError("invalid_request", "Исправьте поля запроса.", issues=issues) from exc
