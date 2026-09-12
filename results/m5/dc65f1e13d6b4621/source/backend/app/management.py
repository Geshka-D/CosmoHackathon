"""Deterministic, release-bound management proposals over the canonical M3 result.

No stored calculation is trusted, no amount expression is executed, and additional
support is deliberately kept outside the canonical CASH/KCASH/OPEX metrics.
"""
from __future__ import annotations

import csv
import hashlib
import io
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, JsonValue, StringConstraints, ValidationError, model_validator

from .canonical_adapter import evaluate_validated
from .case_loader import CaseRepository, PROJECT_ROOT
from .contracts import EPS, ServiceError, canonical_json, parse_json
from .decision import recompute_decision
from .schemas import EvaluateRequest, SelectionRow, StrictModel
from .team_assumptions import load_analysis_presets, load_team_settings

VERSION = "kosmos-management/1"
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
Texts = Annotated[list[Text], Field(min_length=1)]
MoneyShare = Annotated[float, Field(gt=0, le=1, allow_inf_nan=False)]


class Roles(StrictModel):
    buyer: Text
    c0_payer: Text
    anchor_payer: Text
    commercial_payer: Text
    gap_payer: Text
    operator: Text
    supplier: Text
    acceptor: Text
    user: Text
    decision_owner: Text
    public_beneficiary: Text


class Allocation(StrictModel):
    payer: Text
    share: MoneyShare


class KPI(StrictModel):
    id: Text
    name: Text
    unit: Text
    period: Text
    objects: Text
    numerator: Text
    denominator: Text
    missing: Text
    source: Text
    owner: Text
    acceptance: Text
    baseline: None
    target: None
    status: Literal["PROPOSED_MEASUREMENT; BASELINE_AND_TARGET_UNKNOWN"]
    approve_phase: Text


class Risk(StrictModel):
    id: Text
    risk: Text
    owner: Text
    trigger: Text
    consequence: Text
    action: Text
    residual: Text


class Replication(StrictModel):
    core: Text
    adaptation: Text
    first_pilot: Text
    next_site: Text
    experience: Text
    gate: Text


class Service(StrictModel):
    lot_id: Text
    mode_id: Literal["A", "B", "C"]
    territory: Text
    need: Text
    action: Text
    expected_effect: Text
    roles: Roles
    c0_allocations: Annotated[list[Allocation], Field(min_length=1)]
    agreement_condition: Text
    liquidity_owner: Text
    liquidity_gate: Text
    contract_subject: Text
    acceptance: Text
    payment_condition: Text
    access_rationale: Text
    public_layer: Text
    restricted_data: Text
    failure_response: Text
    rights: Text
    kpis: Annotated[list[KPI], Field(min_length=1)]
    risks: Annotated[list[Risk], Field(min_length=1)]
    export_format: Text
    control_set: Text
    migration_owner: Text
    replication: Replication
    source_refs: Texts
    assumption_refs: Texts


class Phase(StrictModel):
    id: Text
    start_month: Annotated[int, Field(ge=1)]
    end_month: Annotated[int, Field(ge=1)]
    unit: Literal["месяц от условного решения о запуске"]
    status: Literal["TEAM_PROPOSAL"]
    result: Text
    owner: Text
    resources: Text
    resource_confirmer: Text
    availability: Text
    dependency: Text
    acceptance: Text
    defer_if: Text


class Source(StrictModel):
    title: Text
    uri: Text
    claim: Text
    limitation: Text
    checked: Text


class Access(StrictModel):
    label: Text
    public_core: bool
    terms: Text


class Switch(StrictModel):
    triggers: Texts
    sequence: Texts
    payload: Texts
    interface: Text
    competition: Text
    costs_and_time: Text
    continuity: Text
    residual: Text


class Dependency(StrictModel):
    id: Text
    services: Texts
    dependency: Text
    owner: Text
    actual_provider: None
    gate: Text
    residual: Text


class ManagementConfig(StrictModel):
    schema_version: Literal[VERSION]
    stage: Literal["M4"]
    status: Literal["TEAM_PROPOSAL; NOT_CONTRACTED; NO_ACHIEVED_KPI"]
    decision_config: Literal["config/m3_decision.json"]
    accepted_decision_sha256: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
    selected_lots: list[dict[str, str]]
    assumptions_ref: Literal["config/assumptions.json"]
    interlot_transfers_enabled: Literal[False]
    support_in_canonical_cash: Literal[False]
    financing_notes: Texts
    payment_timing: dict[str, Text]
    access_proposals: dict[str, Access]
    kpi_protocol: Texts
    services: Annotated[list[Service], Field(min_length=4, max_length=4)]
    portfolio_risks: Annotated[list[Risk], Field(min_length=1)]
    shared_dependencies: Annotated[list[Dependency], Field(min_length=1)]
    supplier_switch: Switch
    roadmap: Annotated[list[Phase], Field(min_length=1)]
    pilot_order: Text
    stress_decision: Literal["RETAIN"]
    stress_owner: Text
    stress_conditions: Texts
    stress_timing: Text
    choice_rationale: Texts
    alternative_rationale: dict[str, Text]
    sources: dict[str, Source]


class Assumption(StrictModel):
    """Explicit authored schema; optional explanatory fields may be omitted, not null."""
    id: Annotated[str, Field(pattern=r"^A[0-9]{2}$")]
    topic: Text
    value: JsonValue
    status: Text
    reason: Text | None = None
    resolve_by: Text | None = None
    source: Text | None = None
    limitation: Text | None = None
    unit: Text | None = None
    label: Text | None = None
    fields: Texts | None = None
    proposal_ref: Text | None = None

    @model_validator(mode="before")
    @classmethod
    def nonnull_explanations(cls, value):
        if isinstance(value, dict):
            for key in ("reason", "resolve_by", "source", "limitation", "unit", "label", "fields", "proposal_ref"):
                if key in value and value[key] is None:
                    raise ValueError(f"{key} must be omitted or have its declared non-null type")
        return value


class AssumptionsConfig(StrictModel):
    schema_version: Literal["kosmos-assumptions/1"]
    stage: Literal["M4"]
    status: Literal["TEAM_PROPOSALS_AND_UNRESOLVED_IMPLEMENTATION_CONDITIONS"]
    team_name: Text | None
    selected_portfolio: Annotated[list[SelectionRow], Field(min_length=4, max_length=4)]
    assumptions: Annotated[list[Assumption], Field(min_length=26)]


def _read(root: Path, relative: str):
    path = root / relative
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError("Config path outside project")
    with path.open("rb") as stream:
        data = stream.read(262_145)
    # This larger bound is only for local authored configuration; HTTP input
    # retains the original MAX_BODY_BYTES contract.
    return parse_json(data, max_bytes=262_144), hashlib.sha256(data).hexdigest()


def _check_config(config, assumptions, decision):
    AssumptionsConfig.model_validate(assumptions)
    selection = decision["recommendation"]["base"]["selection"]
    if config.selected_lots != selection or assumptions.get("selected_portfolio") != selection:
        raise ValueError("Selected portfolio is incompatible with management/assumptions")
    if [{"lot_id": s.lot_id, "mode_id": s.mode_id} for s in config.services] != selection:
        raise ValueError("Exactly one ordered card for each selected lot/mode is required")
    if decision["recommendation"]["action"] != config.stress_decision:
        raise ValueError("Management stress decision is incompatible")
    entries = assumptions["assumptions"]
    ids = {a["id"] for a in entries}
    if len(ids) != len(entries) or not {f"A{i:02d}" for i in range(1, 27)} <= ids:
        raise ValueError("Missing or duplicate assumptions")
    horizon = next(a for a in entries if a["id"] == "A03")
    if type(horizon["value"]) is not int or horizon["value"] != 12 or horizon.get("unit") != "месяц" or horizon["status"] != "TEAM_PROPOSAL":
        raise ValueError("M4 requires the declared proposed 12-month horizon")
    phases = {p.id for p in config.roadmap}
    if len(phases) != len(config.roadmap):
        raise ValueError("Duplicate phase")
    covered = []
    for phase in config.roadmap:
        if phase.start_month > phase.end_month or phase.end_month > horizon["value"]:
            raise ValueError("Invalid phase dates")
        covered.extend(range(phase.start_month, phase.end_month + 1))
    if sorted(covered) != list(range(1, horizon["value"] + 1)):
        raise ValueError("Roadmap must cover the full horizon without overlaps/gaps")
    if set(config.access_proposals) != {"A", "B", "C"}:
        raise ValueError("All canonical access interpretations are required")
    if {k: v.public_core for k, v in config.access_proposals.items()} != {"A": True, "B": False, "C": False}:
        raise ValueError("Access public core differs from source")
    if set(config.payment_timing) != {"c0", "anchor", "commercial", "opex", "additional_support"}:
        raise ValueError("Payment timing is incomplete")
    if set(config.alternative_rationale) != {a["strategy_id"] for a in decision["alternatives"]}:
        raise ValueError("Alternative explanations are incomplete")
    for source in config.sources.values():
        if not (source.uri.startswith("https://") or source.uri.startswith("case_source/")):
            raise ValueError("Unsafe source link")
    for service in config.services:
        if abs(sum(a.share for a in service.c0_allocations) - 1) > EPS:
            raise ValueError(f"Full C0 funding shares required: {service.lot_id}")
        if not set(service.source_refs) <= set(config.sources) or not set(service.assumption_refs) <= ids:
            raise ValueError("Unknown source/assumption reference")
        if any(k.approve_phase not in phases for k in service.kpis) or len({k.id for k in service.kpis}) != len(service.kpis):
            raise ValueError("Invalid KPI phase/identity")
        expected = next(r for r in decision["recommendation"]["results"]["BASE"]["detail"] if r["lot_id"] == service.lot_id)
        if service.territory != expected["territorial_archetype"]:
            raise ValueError("Service territory differs from canonical source")
    for item in config.shared_dependencies:
        if not set(item.services) <= {s.lot_id for s in config.services}:
            raise ValueError("Unknown dependency service")


FINANCE_FIELDS = ("c0_mrub", "opex_mrub_per_year", "anchor_cash_mrub_per_year", "commercial_cash_mrub_per_year", "cash_mrub_per_year", "vpub_mrub_per_year")


def finance_table(result):
    rows = []
    for detail in result["detail"]:
        balance = detail["cash_mrub_per_year"] - detail["opex_mrub_per_year"]
        coverage = detail["cash_mrub_per_year"] / detail["opex_mrub_per_year"]
        rows.append({"lot_id": detail["lot_id"], "mode_id": detail["mode_id"],
                     **{field: detail[field] for field in FINANCE_FIELDS},
                     "lot_coverage_ratio": coverage,
                     "net_operating_balance": balance, "lot_funding_gap": max(-balance, 0.0),
                     "provenance": detail["provenance"]})
    totals = {field: result["metrics"][field] for field in FINANCE_FIELDS}
    balance = totals["cash_mrub_per_year"] - totals["opex_mrub_per_year"]
    totals.update(net_operating_balance=balance, portfolio_funding_gap=max(-balance, 0.0),
                  sum_lot_funding_gaps=sum(r["lot_funding_gap"] for r in rows),
                  lot_coverage_ratio=result["metrics"]["kcash"],
                  vpub_mrub_per_year=result["metrics"]["vpub_mrub_per_year"], kcash=result["metrics"]["kcash"])
    return {"rows": rows, "totals": totals, "unit": "C0: млн руб. при запуске; остальные денежные поля: млн руб./год",
            "formulas": {"net_operating_balance": "CASH - OPEX", "portfolio_funding_gap": "max(sum(OPEX) - sum(CASH), 0)",
                         "lot_coverage_ratio": "CASH_i / OPEX_i",
                         "lot_funding_gap": "max(OPEX_i - CASH_i, 0)", "sum_lot_funding_gaps": "sum(lot_funding_gap_i)"},
            "marker": "TEAM_INDICATORS"}


def build_management(repository: CaseRepository | None = None, config_root: Path | None = None):
    repository = repository or CaseRepository()
    root = Path(config_root or repository.root).resolve()
    try:
        management, management_hash = _read(root, "config/management.json")
        assumptions, assumptions_hash = _read(root, "config/assumptions.json")
        decision_input, decision_hash = _read(root, "config/m3_decision.json")
        config = ManagementConfig.model_validate(management)
        AssumptionsConfig.model_validate(assumptions)
        if decision_hash != config.accepted_decision_sha256:
            raise ValueError("Saved M3 input has changed; management review is required")
        decision = recompute_decision(decision_input, repository)
        _check_config(config, assumptions, decision)
        settings = load_team_settings(root)
        load_analysis_presets(root)
    except ServiceError as exc:
        if exc.code in {"source_unavailable", "incompatible_sources", "incompatible_population"}:
            raise
        raise ServiceError("management_unavailable", "Управленческая конфигурация не прочитана; прежние результаты не подставляются.", 503) from exc
    except (OSError, ValueError, ValidationError) as exc:
        raise ServiceError("management_unavailable", "Управленческая конфигурация неполна или не согласована с принятым M3. Проверьте config/management.json и assumptions.json.", 503) from exc
    result = decision["recommendation"]["results"]["BASE"]
    finance = finance_table(result)
    services = []
    for card, row in zip(config.services, finance["rows"]):
        roles = card.roles
        allocations = [{"payer": a.payer, "share": a.share, "amount": row["c0_mrub"] * a.share,
                        "unit": "млн руб. при запуске", "basis": f"detail[{card.lot_id}].c0_mrub * share"} for a in card.c0_allocations]
        flows = []
        for kind, field, payer, payee, purpose in (
            ("anchor", "anchor_cash_mrub_per_year", roles.anchor_payer, roles.operator, "оговорённый якорный объём"),
            ("commercial", "commercial_cash_mrub_per_year", roles.commercial_payer, roles.operator, "объектные отчёты и заказная аналитика"),
            ("opex", "opex_mrub_per_year", roles.operator, roles.supplier, "данные, обработка, доставка, проверка и сопровождение по смете"),
            ("additional_support", "lot_funding_gap", roles.gap_payer, roles.operator, "только непокрытая эксплуатация этого лота; сверх anchor"),
        ):
            flows.append({"kind": kind, "amount": row[field], "unit": "млн руб./год", "payer": payer, "payee": payee,
                          "purpose": purpose, "timing": config.payment_timing[kind], "condition": card.agreement_condition,
                          "basis": f"finance.rows[{card.lot_id}].{field}", "included_in_canonical_cash": kind in ("anchor", "commercial")})
        services.append({**card.model_dump(), "finance": row, "c0_funding": allocations,
                         "c0_timing": config.payment_timing["c0"], "flows": flows,
                         "access": config.access_proposals[card.mode_id].model_dump()})
    # Re-evaluate every distinct alternative via the canonical adapter, including
    # its lot-level gaps. Never substitute net portfolio deficit for contract gaps.
    alternatives, memo = [], {}
    snapshot = repository.load()
    for alt in decision["alternatives"]:
        pid = alt["candidate"]["portfolio_id"]
        if pid not in memo:
            memo[pid] = evaluate_validated(EvaluateRequest.model_validate(alt["request"]), snapshot)
        calculated = memo[pid]
        alternatives.append({"strategy_id": alt["strategy_id"], "title": alt["title"], "selection": calculated["selection"],
                             "same_portfolio_as": alt["same_portfolio_as"], "finance": finance_table(calculated),
                             "metrics": calculated["metrics"], "scenarios": alt["candidate"]["scenarios"],
                             "public_core_ids": alt["candidate"]["public_core_ids"],
                             "rationale": config.alternative_rationale[alt["strategy_id"]],
                             "changes": alt["selection_changes"], "delta": alt["delta_to_current_leader"],
                             "result_fingerprint": calculated["input_fingerprint"]})
    identity = {"management_version": VERSION, "release_contract_version": "kosmos-management-release/4", "management_sha256": management_hash,
                "assumptions_version": assumptions["schema_version"], "assumptions_sha256": assumptions_hash,
                "decision_config_sha256": decision_hash, "decision_input_fingerprint": decision["input_fingerprint"],
                "source_hashes": result["source_hashes"], "result_fingerprint": result["input_fingerprint"]}
    base, stress = decision["recommendation"]["base"], decision["recommendation"]["stress"]
    from .advanced_analysis import build_advanced_bundle
    advanced_result = evaluate_validated(
        EvaluateRequest.model_validate(result["applied_request"]), snapshot, settings
    )
    advanced = build_advanced_bundle(snapshot, settings, result["selection"], advanced_result)
    bundle = {"format_version": VERSION, "release_id": hashlib.sha256(canonical_json(identity)).hexdigest(), "identity": identity,
              "status": config.status, "configuration": management, "assumptions": assumptions,
              "selection": result["selection"], "request": result["applied_request"], "result": result,
              "finance": finance, "services": services, "alternatives": alternatives,
              "distinct_strategy_portfolios": decision["distinct_strategy_portfolios"],
              "method": decision["method"], "weights": decision["search"]["weights"],
              "reference_population": decision["search"]["reference_population"], "population": decision["search"]["population"],
              "sensitivity": decision["sensitivity"], "advanced_analysis": advanced,
              "coalition": advanced["coalition"],
              "stress": {"action": decision["recommendation"]["action"], "owner": config.stress_owner,
                         "conditions": config.stress_conditions, "timing": config.stress_timing,
                         "base": base["scenarios"]["BASE"], "stress": base["scenarios"]["STRESS"],
                         "metrics_delta": decision["recommendation"]["stress_delta_to_base"],
                         "selection_unchanged": base["selection"] == stress["selection"]}}
    from .management_materials import render_documents
    bundle["materials"] = render_documents(bundle)
    bundle["finance_csv"] = finance_csv(bundle)
    canonical_json(bundle)
    return bundle


def finance_csv(bundle):
    output = io.StringIO(newline="")
    columns = ["release_id", "strategy_id", "lot_id", "mode_id", *FINANCE_FIELDS, "lot_coverage_ratio",
               "net_operating_balance", "lot_funding_gap", "portfolio_funding_gap", "sum_lot_funding_gaps",
               "shapley_mrub", "coalition_grand_cost_mrub", "coalition_core_ok"]
    writer = csv.DictWriter(output, fieldnames=columns, lineterminator="\n", extrasaction="ignore")
    writer.writeheader()
    allocations = {row["lot_id"]: row["shapley_mrub"] for row in bundle["coalition"]["players"]}
    common = {"release_id": bundle["release_id"], "strategy_id": "accepted_management",
              "coalition_grand_cost_mrub": bundle["coalition"]["grand_cost_mrub"],
              "coalition_core_ok": bundle["coalition"]["core"]["ok"]}
    for row in bundle["finance"]["rows"]:
        writer.writerow({**common, **row, "shapley_mrub": allocations[row["lot_id"]]})
    writer.writerow({**common, "lot_id": "TOTAL", **bundle["finance"]["totals"],
                     "shapley_mrub": bundle["coalition"]["grand_cost_mrub"]})
    for alternative in bundle["alternatives"]:
        common = {"release_id": bundle["release_id"], "strategy_id": alternative["strategy_id"]}
        for row in alternative["finance"]["rows"]:
            writer.writerow({**common, **row})
        writer.writerow({**common, "lot_id": "TOTAL", **alternative["finance"]["totals"]})
    return output.getvalue()
