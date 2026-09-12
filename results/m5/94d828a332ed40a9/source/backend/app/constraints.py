"""Explain the canonical core's nine decisions without replacing its comparisons."""
from __future__ import annotations

from .contracts import EPS

UNITS = {
    "selected_lots": "лоты", "territorial_archetypes": "архетипы",
    "capability_groups": "группы", "public_core_lots": "лоты",
    "c0_mrub": "млн руб.", "opex_mrub_per_year": "млн руб./год",
    "vpub_mrub_per_year": "синтетические млн руб./год общественной ценности",
    "cash_mrub_per_year": "млн руб./год", "anchor_cash_mrub_per_year": "млн руб./год",
    "commercial_cash_mrub_per_year": "млн руб./год", "kcash": "отношение CASH/OPEX",
    "t_rep": "безразмерный заданный индекс кейса",
    "readiness_1_5": "индекс 1–5", "resilience_1_5": "индекс 1–5", "scale_1_5": "индекс 1–5",
    "capability_set": "нормализованные группы",
}

# Stable ID, metric, comparison, configuration field, explanation, corrective guidance.
RULES = (
    ("exact_lot_count", "selected_lots", "==", "selected_lots_exactly", "Ровно четыре уникальных лота",
     "Завершите состав до четырёх различных лотов."),
    ("territorial_archetypes", "territorial_archetypes", ">=", "min_territorial_archetypes", "Минимум три нефедеральных территориальных архетипа",
     "Замените лот на нефедеральный лот другого архетипа; SSA не добавляет территорию."),
    ("capability_groups", "capability_groups", ">=", "min_capability_groups", "Минимум две нормализованные группы возможностей",
     "Добавьте лот с недостающей группой; PNT, InSAR и PNT/InSAR считаются одной группой."),
    ("public_core_lots", "public_core_lots", ">=", "min_public_core_lots", "Минимум два лота общественного ядра",
     "Рассмотрите режим A для нужного числа лотов; затем перепроверьте все условия."),
    ("c0_limit", "c0_mrub", "<=", "c0_max_mrub", "Стартовые затраты в пределах сценарного бюджета",
     "Рассмотрите менее затратный состав или режимы; STRESS не уменьшает стоимость лотов."),
    ("opex_limit", "opex_mrub_per_year", "<=", "opex_max_mrub_per_year", "Годовой OPEX в пределах лимита",
     "Рассмотрите лоты или режимы с меньшим OPEX и перепроверьте остальные условия."),
    ("vpub_floor", "vpub_mrub_per_year", ">=", "vpub_min_mrub_per_year", "Общественная ценность не ниже порога",
     "Рассмотрите лоты с большей VPUB или режимы с большим k_vpub; CASH не заменяет VPUB."),
    ("kcash_floor", "kcash", ">=", "kcash_min", "Денежное покрытие CASH/OPEX не ниже порога",
     "Рассмотрите состав или режимы с большим CASH либо меньшим OPEX; перепроверьте общественное ядро и VPUB."),
    ("t_rep_floor", "t_rep", ">=", "t_rep_min", "Средний заданный индекс t_rep не ниже порога",
     "Измените состав в пользу лотов с большим t_rep; смена режима не меняет этот индекс."),
)


def scenario_diagnostics(metrics: dict, config: dict, core, complete: bool) -> dict:
    result = {}
    for scenario in ("BASE", "STRESS"):
        canonical = {}
        if complete:
            frame = core.check_constraints(metrics, config, scenario)
            canonical = dict(zip(frame.constraint, frame.ok))
        diagnostics = []
        for index, (rule_id, metric, comparator, key, condition, action) in enumerate(RULES):
            scope = f"scenarios/{scenario}" if rule_id == "c0_limit" else "constraints_common"
            limit = config["scenarios"][scenario][key] if rule_id == "c0_limit" else config["constraints_common"][key]
            fact = metrics.get(metric)
            margin = None if fact is None else (limit - fact if comparator == "<=" else fact - limit)
            if comparator == "==" and fact is not None:
                margin = -abs(fact - limit)
            deficit = None if margin is None else max(-margin, 0)
            ok = bool(canonical[rule_id]) if complete else None
            direction = None
            if deficit:
                direction = "above_limit" if fact > limit else "below_limit"
            diagnostics.append({
                "id": rule_id, "condition": condition, "metric": metric,
                "comparator": comparator, "limit": limit, "fact": fact, "unit": UNITS[metric],
                "status": ("PASS" if ok else "FAIL") if complete else "NOT_EVALUATED",
                "ok": ok, "evaluated": complete, "margin": margin, "deficit": deficit,
                "violation_direction": direction, "eps": 0 if index < 4 else EPS,
                "tolerance_accepted": bool(ok and margin is not None and margin < 0),
                "action": action if complete and not ok else (
                    "Сохраните выполнение условия при изменении портфеля." if complete else
                    "Завершите состав до четырёх уникальных лотов; факты пока относятся к неполному набору. " + action),
                "limit_source": {"file": "case_source/config/case_config.json", "pointer": f"/{scope}/{key}"},
                "formula_source": "case_source/case_core.py#check_constraints",
            })
        all_ok = all(d["ok"] for d in diagnostics) if complete else None
        result[scenario] = {"scenario": scenario, "status": ("PASS" if all_ok else "FAIL") if complete else "INCOMPLETE",
                            "ok": all_ok, "diagnostics": diagnostics}
    return result
