"""HTTP-independent calculation, source provenance and reproducible result bundles."""
from __future__ import annotations

import hashlib

import pandas as pd

from .case_loader import CaseRepository, CaseSnapshot
from .constraints import UNITS, scenario_diagnostics
from .contracts import ADAPTER_VERSION, CASE_ID, CASE_VERSION, SCHEMA_VERSION, canonical_json
from .reliability import reliability
from .schemas import EvaluateRequest, TeamSettings, validate_request
from .team_assumptions import load_analysis_presets, load_team_settings, setting_provenance, settings_payload

ADJUSTED = {"c0_mrub": "k_c0", "opex_mrub_per_year": "k_opex", "vpub_mrub_per_year": "k_vpub",
            "anchor_cash_mrub_per_year": "k_anchor", "commercial_cash_mrub_per_year": "k_commercial"}
INDICES = ("t_rep", "readiness_1_5", "resilience_1_5", "scale_1_5")
PERIOD = "C0 при запуске + один год эксплуатации при исходных параметрах; календарная дата и многолетний горизонт не заданы."
CORE_ASSUMPTIONS = [{"file": "config/assumptions.json", "id": value} for value in (
    "A02", "A04", "A05", "A06", "A15")]
TEAM_ASSUMPTIONS = [{"file": "config/assumptions.json", "id": value} for value in (
    "A16", "A17", "A18", "A19", "A20", "A21", "A22")]


def _source_value(file, row, field, value):
    return {"file": file, "row_key": row, "field": field, "value": value}


def _detail_provenance(detail, snapshot):
    lots = snapshot.lots.set_index("lot_id")
    modes = snapshot.modes.set_index("mode_id")
    for row in detail:
        lot_id, mode_id = row["lot_id"], row["mode_id"]
        lot, mode = lots.loc[lot_id], modes.loc[mode_id]
        provenance = {}
        for field, coefficient in ADJUSTED.items():
            if field in ("anchor_cash_mrub_per_year", "commercial_cash_mrub_per_year"):
                row[field] = float(lot[field]) * float(mode[coefficient])
            provenance[field] = {
                "source": _source_value("case_source/data/lots.csv", {"lot_id": lot_id}, field, float(lot[field])),
                "coefficient": _source_value("case_source/data/access_modes.csv", {"mode_id": mode_id}, coefficient, float(mode[coefficient])),
                "formula": f"lots.{field} * modes.{coefficient}", "unit": UNITS[field],
                "formula_source": "case_source/case_core.py#apply_mode", "value": row[field],
            }
        provenance["cash_mrub_per_year"] = {
            "formula": "anchor_cash_mrub_per_year + commercial_cash_mrub_per_year",
            "contributors": ["anchor_cash_mrub_per_year", "commercial_cash_mrub_per_year"],
            "unit": UNITS["cash_mrub_per_year"], "value": row["cash_mrub_per_year"],
            "formula_source": "case_source/case_core.py#apply_mode",
        }
        for field in INDICES:
            provenance[field] = {"source": _source_value("case_source/data/lots.csv", {"lot_id": lot_id}, field, float(lot[field])),
                                 "formula": "identity; mode does not change the source index", "unit": UNITS[field], "value": row[field]}
        for field in ("territorial_archetype", "capability_groups", "federal"):
            value = bool(lot[field]) if field == "federal" else lot[field]
            provenance[field] = {"source": _source_value("case_source/data/lots.csv", {"lot_id": lot_id}, field, value), "formula": "identity", "value": value}
        provenance["public_core"] = {"source": _source_value("case_source/data/access_modes.csv", {"mode_id": mode_id}, "public_core", bool(mode.public_core)), "formula": "identity", "value": row["public_core"]}
        row["provenance"] = provenance
    return detail


def _aggregate_provenance(detail, metrics):
    result = {}
    for field in (*ADJUSTED, "cash_mrub_per_year", *INDICES):
        result[field] = {"formula": f"{'mean' if field in INDICES else 'sum'}(detail.{field})",
                         "contributors": [{"lot_id": r["lot_id"], "mode_id": r["mode_id"], "value": r[field]} for r in detail],
                         "unit": UNITS[field], "value": metrics[field],
                         "formula_source": "case_source/case_core.py#evaluate_portfolio" if field not in ("anchor_cash_mrub_per_year", "commercial_cash_mrub_per_year") else "backend/app/canonical_adapter.py#evaluate_validated"}
    formulas = {
        "kcash": "metrics.cash_mrub_per_year / metrics.opex_mrub_per_year",
        "selected_lots": "count(distinct detail.lot_id)",
        "territorial_archetypes": "count(distinct detail.territorial_archetype where federal == false)",
        "capability_groups": "len(metrics.capability_set)",
        "capability_set": "sorted(union(normalize_capability(token) for each semicolon-separated detail.capability_groups token))",
        "public_core_lots": "count(detail.public_core == true)",
    }
    for field, formula in formulas.items():
        result[field] = {"formula": formula, "unit": UNITS[field], "value": metrics[field],
                         "contributors": [r["lot_id"] for r in detail],
                         "formula_source": "case_source/case_core.py#evaluate_portfolio"}
    return result


def evaluate_validated(request: EvaluateRequest, snapshot: CaseSnapshot, team_settings: TeamSettings | None = None) -> dict:
    team_payload = settings_payload(team_settings) if team_settings is not None else None
    original = request.model_dump()
    applied = {**original, "selection": sorted(original["selection"], key=lambda row: (row["lot_id"], row["mode_id"]))}
    selection = [(row["lot_id"], row["mode_id"]) for row in applied["selection"]]
    frame, canonical_metrics = snapshot.core.evaluate_portfolio(selection, snapshot.lots, snapshot.modes, snapshot.config)
    metrics = {field: None for field in UNITS}
    metrics.update(canonical_metrics)
    detail = _detail_provenance(frame.to_dict(orient="records"), snapshot)
    if detail:
        for field in ("anchor_cash_mrub_per_year", "commercial_cash_mrub_per_year"):
            metrics[field] = float(pd.Series([row[field] for row in detail]).sum())
    complete = len(selection) == snapshot.config["constraints_common"]["selected_lots_exactly"]
    reliability_by_scenario = {} if team_settings is not None else None
    if complete and team_settings is not None:
        costs = [row["c0_mrub"] * (1.0 + team_settings.optimism_uplift) for row in detail]
        for scenario in ("BASE", "STRESS"):
            reliability_by_scenario[scenario] = reliability(
                costs, snapshot.config["scenarios"][scenario]["c0_max_mrub"], team_settings.sigma,
                team_settings.rho, team_settings.confidence)
    diagnostics = scenario_diagnostics(metrics, snapshot.config, snapshot.core, complete,
                                       team_settings.optimism_uplift if team_settings is not None else 0.0,
                                       reliability_by_scenario)
    identity = {"schema_version": SCHEMA_VERSION, "adapter_version": ADAPTER_VERSION,
                "source_hashes": snapshot.source_hashes, "applied_request": applied}
    if team_payload is not None:
        identity["team_settings"] = team_payload
    bundle = {
        "schema_version": SCHEMA_VERSION, "adapter_version": ADAPTER_VERSION,
        "case_id": CASE_ID, "case_version": CASE_VERSION,
        "source_hashes": snapshot.source_hashes, "sources": snapshot.sources,
        "input_fingerprint": hashlib.sha256(canonical_json(identity)).hexdigest(),
        "original_request": original, "applied_request": applied, "selection": applied["selection"],
        "completeness": {"status": "COMPLETE" if complete else "INCOMPLETE", "selected_lots": len(selection), "required_lots": 4},
        "detail": detail, "metrics": metrics,
        "scenarios": diagnostics,
        "units": UNITS, "period": PERIOD,
        "assumption_refs": CORE_ASSUMPTIONS + (TEAM_ASSUMPTIONS if team_settings is not None else []),
        "provenance": {"aggregates": _aggregate_provenance(detail, metrics)},
    }
    if team_settings is not None:
        bundle["team_analysis"] = {
            "marker": "TEAM_INDICATORS", "settings": team_payload,
            "setting_provenance": setting_provenance(team_settings),
            "reliability": reliability_by_scenario,
            "formulas_are_separate_from_canonical": True,
        }
    canonical_json(bundle)  # Fail closed if any accidental non-finite value enters output.
    return bundle


def evaluate(value, repository: CaseRepository | None = None) -> dict:
    request = validate_request(EvaluateRequest, value)
    snapshot = (repository or CaseRepository()).load()
    return evaluate_validated(request, snapshot)


def case_description(snapshot: CaseSnapshot) -> dict:
    settings = load_team_settings(snapshot.root)
    return {"schema_version": SCHEMA_VERSION, "adapter_version": ADAPTER_VERSION,
            "case_id": CASE_ID, "case_version": CASE_VERSION, "source_hashes": snapshot.source_hashes,
            "sources": snapshot.sources, "lots": snapshot.lots.to_dict(orient="records"),
            "modes": snapshot.modes.to_dict(orient="records"), "constraints_common": snapshot.config["constraints_common"],
            "scenarios": snapshot.config["scenarios"], "units": UNITS, "period": PERIOD,
            "assumption_refs": CORE_ASSUMPTIONS + TEAM_ASSUMPTIONS,
            "team_defaults": settings_payload(settings), "team_presets": load_analysis_presets(snapshot.root),
            "team_setting_provenance": setting_provenance(settings),
            "catalog_provenance": {"lots": {"file": "case_source/data/lots.csv", "row_key": "lot_id"},
                                   "modes": {"file": "case_source/data/access_modes.csv", "row_key": "mode_id"},
                                   "constraints": {"file": "case_source/config/case_config.json"}},
            "limits": {"max_body_bytes": 65_536, "max_selection_rows": 4, "min_comparison_alternatives": 2, "max_comparison_alternatives": 10}}
