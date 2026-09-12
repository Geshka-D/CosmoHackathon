"""Load configurable team assumptions without mixing them into case_source."""
from __future__ import annotations

from pathlib import Path

from .contracts import ServiceError, parse_json
from .schemas import TeamSettings

SETTING_TOPICS = ("optimism_uplift", "sigma", "rho", "confidence", "alpha", "phi", "stress_plan")


def assumption_values(root: Path) -> dict:
    path = Path(root).resolve() / "config" / "assumptions.json"
    try:
        data = parse_json(path.read_bytes(), max_bytes=262_144)
        entries = data["assumptions"]
        values = {row["topic"]: row.get("value") for row in entries}
        if len(values) != len(entries):
            raise ValueError("Duplicate assumption topic")
        return values
    except (OSError, KeyError, TypeError, ValueError, ServiceError) as exc:
        raise ServiceError("assumptions_unavailable", "Допущения команды не прочитаны из config/assumptions.json.", 503) from exc


def load_team_settings(root: Path) -> TeamSettings:
    values = assumption_values(root)
    try:
        return TeamSettings.model_validate({key: values[key] for key in SETTING_TOPICS})
    except (KeyError, ValueError) as exc:
        raise ServiceError("assumptions_unavailable", "Параметры команды A16-A22 неполны или некорректны.", 503) from exc


def load_analysis_presets(root: Path) -> dict:
    values = assumption_values(root)
    try:
        reliability_sigma = float(values["reliability_evidence_sigma"])
        optimism_ladder = [float(value) for value in values["optimism_ladder"]]
        phi_sensitivity = [float(value) for value in values["phi_sensitivity"]]
    except (KeyError, TypeError, ValueError) as exc:
        raise ServiceError("assumptions_unavailable", "Сценарные сетки A24-A26 неполны или некорректны.", 503) from exc
    if not 0 <= reliability_sigma <= 1:
        raise ServiceError("assumptions_unavailable", "A24 должен быть в диапазоне 0..1.", 503)
    if not optimism_ladder or any(not 0 <= value <= 2 for value in optimism_ladder):
        raise ServiceError("assumptions_unavailable", "A25 должен содержать надбавки в диапазоне 0..2.", 503)
    if not phi_sensitivity or any(not 0 <= value <= 1 for value in phi_sensitivity):
        raise ServiceError("assumptions_unavailable", "A26 должен содержать доли в диапазоне 0..1.", 503)
    return {"reliability_sigma": reliability_sigma, "optimism_ladder": optimism_ladder,
            "phi_sensitivity": phi_sensitivity}


def settings_payload(settings: TeamSettings) -> dict:
    return settings.model_dump(by_alias=True)


def setting_provenance(settings: TeamSettings) -> dict:
    ids = {"optimism_uplift": "A16", "sigma": "A17", "rho": "A18", "confidence": "A19",
           "alpha": "A20", "phi": "A21", "stress_plan": "A22"}
    values = settings_payload(settings)
    return {key: {"value": values[key], "source": f"config/assumptions.json#{aid}",
                  "status": "TEAM_ASSUMPTION"} for key, aid in ids.items()}
