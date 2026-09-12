"""Strict input models. Client-supplied results and source overrides are forbidden."""
from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

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
