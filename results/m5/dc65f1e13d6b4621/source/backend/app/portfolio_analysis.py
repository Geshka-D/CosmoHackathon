"""Attach portfolio-specific team indicators to a canonical result bundle."""
from __future__ import annotations

from .repair import nearest_feasible
from .schemas import TeamSettings
from .search import get_population
from .stress_response import classify_portfolio, population_row


def _diagnostic(result, scenario, rule_id):
    return next(item for item in result["scenarios"][scenario]["diagnostics"] if item["id"] == rule_id)


def risk_tornado(result: dict) -> list[dict]:
    definitions = [
        ("c0_base", "Удорожание стартовых работ, BASE", "BASE", "c0_limit"),
        ("c0_stress", "Удорожание стартовых работ, STRESS", "STRESS", "c0_limit"),
        ("opex", "Рост эксплуатационных расходов", "BASE", "opex_limit"),
        ("cash", "Падение денежных поступлений", "BASE", "kcash_floor"),
        ("vpub", "Переоценка общественной ценности вниз", "BASE", "vpub_floor"),
        ("t_rep", "Пересмотр t_rep вниз", "BASE", "t_rep_floor"),
    ]
    rows = []
    for risk_id, label, scenario, rule_id in definitions:
        item = _diagnostic(result, scenario, rule_id)
        rows.append({"id": risk_id, "risk": label, "scenario": scenario, "rule_id": rule_id,
                     "critical_change_fraction": item["critical_change_fraction"], "fact": item["fact"],
                     "limit": item["limit"], "status": item["status"], "marker": "TEAM_INDICATOR",
                     "formula": "critical shift = limit / applied fact - 1"})
    return sorted(rows, key=lambda row: abs(row["critical_change_fraction"]))


def enhance_result(result: dict, snapshot, settings: TeamSettings | None = None, population: dict | None = None) -> dict:
    settings = settings or TeamSettings.model_validate(result["team_analysis"]["settings"])
    if result["completeness"]["status"] != "COMPLETE":
        result["team_analysis"]["risk_tornado"] = []
        return result
    population = population or get_population(snapshot)
    current = population_row(result["selection"], population)
    result["team_analysis"]["risk_tornado"] = risk_tornado(result) if current else []
    if current:
        result["team_analysis"]["stress_response"] = classify_portfolio(current, population, snapshot, settings.alpha)
        result["team_analysis"]["nearest_repairs"] = {
            scenario: nearest_feasible(current, population, scenario) if result["scenarios"][scenario]["status"] == "FAIL"
            else {"available": False, "reason": "Текущий вариант уже допустим", "scenario": scenario,
                  "marker": "TEAM_INDICATOR"}
            for scenario in ("BASE", "STRESS")
        }
    return result
