"""Exercise a declared access-mode option and reuse the canonical evaluator."""
from __future__ import annotations

from typing import Literal

from .canonical_adapter import evaluate_validated
from .case_loader import CaseRepository
from .contracts import CASE_ID, CASE_VERSION, ServiceError
from .portfolio_analysis import enhance_result
from .schemas import EvaluateRequest, StressPlan, StrictModel, TeamSettings, validate_request
from .team_assumptions import load_team_settings, settings_payload

VERSION = "kosmos-option/1"


class ExerciseOptionRequest(StrictModel):
    format_version: Literal[VERSION]
    case_id: Literal[CASE_ID]
    case_version: Literal[CASE_VERSION]
    source_hashes: dict[str, str]
    request: EvaluateRequest
    stress_plan: StressPlan | None = None
    team_settings: TeamSettings | None = None


def exercise_option(value, repository: CaseRepository | None = None):
    envelope = validate_request(ExerciseOptionRequest, value)
    repository = repository or CaseRepository()
    snapshot = repository.load()
    if envelope.source_hashes != snapshot.source_hashes:
        raise ServiceError("incompatible_sources", "Опцион относится к другой версии источников.")
    if len(envelope.request.selection) != 4:
        raise ServiceError("incomplete_portfolio", "Для исполнения опциона нужны четыре лота.")
    settings = envelope.team_settings or load_team_settings(repository.root)
    plan = envelope.stress_plan or settings.stress_plan
    modes = {row.lot_id: row.mode_id for row in envelope.request.selection}
    for action in plan.actions:
        if action.lot_id not in modes:
            raise ServiceError("option_not_applicable", f"Лот {action.lot_id} отсутствует в портфеле.")
        if modes[action.lot_id] != action.from_mode:
            raise ServiceError("option_not_applicable", f"Для {action.lot_id} ожидался режим {action.from_mode}, сейчас {modes[action.lot_id]}.")
        modes[action.lot_id] = action.to
    selection = [{"lot_id": row.lot_id, "mode_id": modes[row.lot_id]} for row in envelope.request.selection]
    applied_request = EvaluateRequest.model_validate({**envelope.request.model_dump(), "selection": selection})
    applied_settings = settings.model_copy(update={"stress_plan": plan})
    before = enhance_result(evaluate_validated(envelope.request, snapshot, applied_settings), snapshot, applied_settings)
    after = enhance_result(evaluate_validated(applied_request, snapshot, applied_settings), snapshot, applied_settings)
    return {"format_version": VERSION, "marker": "TEAM_ACTION", "trigger": plan.trigger,
            "rationale": plan.rationale, "actions": [row.model_dump(by_alias=True) for row in plan.actions],
            "team_settings": settings_payload(applied_settings), "before": before, "after": after,
            "capital_preserved": True,
            "interpretation": "Смена режима является договорным действием; канонические показатели после неё заново рассчитаны тем же адаптером."}
