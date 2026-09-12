"""Versioned browser workspace. Imported calculations are never trusted."""
from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field, field_validator

from .canonical_adapter import evaluate_validated
from .case_loader import CaseRepository
from .contracts import ServiceError
from .portfolio_analysis import enhance_result
from .search import get_population
from .schemas import EvaluateRequest, StrictModel, TeamSettings, validate_request
from .team_assumptions import load_team_settings, settings_payload

WORKSPACE_VERSION = "kosmos-workspace/1"


class NamedPortfolio(StrictModel):
    name: Annotated[str, Field(min_length=1, max_length=80)]
    request: EvaluateRequest

    @field_validator("name")
    @classmethod
    def meaningful_name(cls, value):
        if not value.strip() or any(ord(c) < 32 for c in value):
            raise ValueError("Название должно содержать текст без управляющих символов.")
        return value


class SavedAlternative(NamedPortfolio):
    alternative_id: Annotated[str, Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")]


class Workspace(StrictModel):
    current: NamedPortfolio
    alternatives: Annotated[list[SavedAlternative], Field(max_length=3)]
    scenario: Literal["BASE", "STRESS"]
    team_settings: TeamSettings | None = None

    @field_validator("alternatives")
    @classmethod
    def complete_distinct_alternatives(cls, values):
        if len({item.alternative_id for item in values}) != len(values):
            raise ValueError("Идентификаторы альтернатив должны различаться.")
        if any(len(item.request.selection) != 4 for item in values):
            raise ValueError("Сохраняйте для сравнения только полные составы из четырёх лотов.")
        if len({item.name.strip().casefold() for item in values}) != len(values):
            raise ValueError("Названия альтернатив должны различаться.")
        signatures = [tuple(sorted((row.lot_id, row.mode_id) for row in item.request.selection)) for item in values]
        if len(set(signatures)) != len(signatures):
            raise ValueError("Для сравнения сохраните разные составы или режимы.")
        return values


class WorkspaceEnvelope(StrictModel):
    format_version: Literal[WORKSPACE_VERSION]
    source_hashes: dict[str, str]
    workspace: Workspace


def recompute_workspace(value, repository: CaseRepository | None = None):
    envelope = validate_request(WorkspaceEnvelope, value)
    snapshot = (repository or CaseRepository()).load()
    if envelope.source_hashes != snapshot.source_hashes:
        raise ServiceError("incompatible_sources", "Файл относится к другой версии источников. Текущая конфигурация сохранена; используйте JSON этого выпуска кейса.")
    settings = envelope.workspace.team_settings or load_team_settings(snapshot.root)
    population = get_population(snapshot)
    current = enhance_result(evaluate_validated(envelope.workspace.current.request, snapshot, settings), snapshot, settings, population)
    alternatives = [{"alternative_id": item.alternative_id, "name": item.name,
                     "result": enhance_result(evaluate_validated(item.request, snapshot, settings), snapshot, settings, population)}
                    for item in envelope.workspace.alternatives]
    # Display differences are computed in Python, never as a second browser model.
    deltas = []
    if len(alternatives) >= 2:
        reference = alternatives[0]["result"]["metrics"]
        for item in alternatives:
            deltas.append({"alternative_id": item["alternative_id"], "name": item["name"], "reference_name": alternatives[0]["name"],
                           "metrics": {key: number - reference[key]
                                       for key, number in item["result"]["metrics"].items()
                                       if isinstance(number, (int, float)) and not isinstance(number, bool)}})
    workspace = envelope.workspace.model_dump(by_alias=True)
    workspace["team_settings"] = settings_payload(settings)
    return {"format_version": WORKSPACE_VERSION, "source_hashes": snapshot.source_hashes,
            "workspace": workspace,
            "computed": {"current": current, "alternatives": alternatives, "deltas": deltas}}
