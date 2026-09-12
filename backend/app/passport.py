"""Selection-specific finance, with proposals bound to verified active M4/M5."""
from __future__ import annotations

import json

from .canonical_adapter import evaluate_validated
from .case_loader import CaseRepository
from .contracts import ServiceError
from .management import finance_table
from .management_release import read_current_release
from .schemas import EvaluateRequest, validate_request
from .submission import read_current


def passport(value, repository: CaseRepository | None = None):
    request = validate_request(EvaluateRequest, value)
    if len(request.selection) != 4:
        raise ServiceError("incomplete_passport", "Для паспорта портфеля нужны четыре уникальных сервиса.")
    repository = repository or CaseRepository()
    snapshot = repository.load()
    calculated = evaluate_validated(request, snapshot)
    finance = finance_table(calculated)
    try:
        m4, artifacts = read_current_release(repository.root)
        active = json.loads(artifacts["results/m4_management.json"])
        m5, submission = read_current(repository.root)
        saved = json.loads(submission["bundle.json"])
        if saved["identity"]["analytical_release_id"] != active["release_id"]:
            raise ValueError("M4/M5 mismatch")
        if active["identity"]["source_hashes"] != snapshot.source_hashes:
            raise ValueError("M4 source mismatch")
        # Never trust cached amounts as computation inputs.
        accepted = evaluate_validated(EvaluateRequest.model_validate(active["request"]), snapshot)
        if finance_table(accepted) != active["finance"]:
            raise ValueError("Active finance mismatch")
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise ServiceError("passport_sources_unavailable", "Активные M4/M5 недоступны или несогласованы; паспорт не подставляется из истории.", 503) from exc
    services = []
    for row in finance["rows"]:
        card = next((s for s in active["services"] if (s["lot_id"], s["mode_id"]) == (row["lot_id"], row["mode_id"])), None)
        source = f"{m4['directory']}/results/m4_management.json#/services/{row['lot_id']}"
        def claim(text, kind):
            return {"text": text, "provenance": kind, "source": source if card else None}
        roles = card["roles"] if card else {}
        chain = [claim(roles.get("buyer", "Заказчик не определён для этого lot/mode"), "TEAM ASSUMPTION" if card else "UNKNOWN"),
                 claim((roles["operator"] + " / " + roles["supplier"]) if card else "Оператор / поставщик не определены", "TEAM ASSUMPTION" if card else "UNKNOWN"),
                 {"text": f"{row['lot_id']} {row['mode_id']}", "provenance": "CASE DATA", "source": "case_source/data/lots.csv; case_source/data/access_modes.csv"},
                 claim(roles.get("user", "Пользователь не определён"), "TEAM ASSUMPTION" if card else "UNKNOWN"),
                 claim(card["expected_effect"] if card else "Общественный результат требует проработки", "TEAM ASSUMPTION" if card else "UNKNOWN")]
        services.append({"lot_id": row["lot_id"], "mode_id": row["mode_id"], "chain": chain,
                         "finance": row, "finance_provenance": "CALCULATED",
                         "conditions": [claim(card[key], "IMPLEMENTATION CONDITION") for key in
                                        ("agreement_condition", "payment_condition", "liquidity_gate")] if card else
                                       [claim("Условия финансирования, покрытия gap и договоров не определены для этого lot/mode.", "UNKNOWN")],
                         "gap_condition": claim(f"Адресное покрытие дефицита {row['lot_funding_gap']} млн руб./год требует подтверждения; автоматического переноса CASH между сервисами нет.", "IMPLEMENTATION CONDITION"),
                         "confirmed_contracts": claim("Подтверждённые договоры и коммерческие условия не представлены.", "UNKNOWN")})
    return {"format_version": "kosmos-passport/1", "selection": calculated["selection"],
            "finance": finance, "finance_provenance": "CALCULATED", "services": services,
            "active_sources": {"m4_release_id": m4["release_id"], "m4_directory": m4["directory"],
                               "m5_submission_id": m5["submission_id"], "m5_directory": m5["directory"]},
            "matches_accepted_selection": calculated["selection"] == accepted["selection"],
            "interpretation": "VPUB — общественная ценность, не CASH. Портфельный gap=0 не закрывает service-level gaps. Роли и условия M4 применяются только к совпавшему lot/mode; это предложения, не договоры."}
