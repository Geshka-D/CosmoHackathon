"""Independent regressions for the team indicators added after M3."""
from __future__ import annotations

import math
import random
import statistics

import pytest

from backend.app.advanced_analysis import build_advanced_bundle
from backend.app.canonical_adapter import evaluate_validated
from backend.app.case_loader import CaseRepository
from backend.app.coalition import analyse_result, shapley_values
from backend.app.contracts import SCHEMA_VERSION
from backend.app.reliability import herfindahl, reliability
from backend.app.repair import nearest_feasible
from backend.app.schemas import EvaluateRequest
from backend.app.search import get_population
from backend.app.stress_response import classify_population, population_row


@pytest.fixture(scope="module")
def snapshot():
    return CaseRepository().load()


@pytest.fixture(scope="module")
def population(snapshot):
    return get_population(snapshot)


def _valid_metrics(**updates):
    value = {"selected_lots": 4, "territorial_archetypes": 4, "capability_groups": 2,
             "public_core_lots": 2, "c0_mrub": 1200.0, "opex_mrub_per_year": 300.0,
             "vpub_mrub_per_year": 1200.0, "kcash": 0.8, "t_rep": 0.7}
    value.update(updates)
    return value


@pytest.mark.parametrize("scenario,field,boundary,outside,rule", [
    ("BASE", "c0_mrub", 1300.00, 1300.01, "c0_limit"),
    ("STRESS", "c0_mrub", 1180.00, 1180.01, "c0_limit"),
    ("BASE", "opex_mrub_per_year", 360.00, 360.01, "opex_limit"),
    ("BASE", "vpub_mrub_per_year", 1000.00, 999.99, "vpub_floor"),
    ("BASE", "kcash", 0.600, 0.599, "kcash_floor"),
    ("BASE", "t_rep", 0.630, 0.629, "t_rep_floor"),
])
def test_numeric_boundaries_use_canonical_checker(snapshot, scenario, field, boundary, outside, rule):
    """Synthetic metrics isolate comparisons that no exact portfolio hits."""
    at = snapshot.core.check_constraints(_valid_metrics(**{field: boundary}), snapshot.config, scenario)
    beyond = snapshot.core.check_constraints(_valid_metrics(**{field: outside}), snapshot.config, scenario)
    assert bool(at.set_index("constraint").loc[rule, "ok"])
    assert not bool(beyond.set_index("constraint").loc[rule, "ok"])


def test_reliability_closed_form_and_direct_simulation():
    costs = [336.0, 273.0, 262.5, 294.0]
    sigma, rho, limit = 0.05, 0.0, 1180.0
    value = reliability(costs, limit, sigma, rho, 0.90)
    assert value["herfindahl"] == pytest.approx(sum((x / sum(costs)) ** 2 for x in costs))
    assert value["effective_lots"] == pytest.approx(1 / value["herfindahl"])
    rng = random.Random(20260912)
    samples = [sum(c * (1 + rng.gauss(0, sigma)) for c in costs) for _ in range(60_000)]
    observed_sd = statistics.stdev(samples)
    assert abs(observed_sd / value["standard_deviation_mrub"] - 1) <= 0.01


def test_risk_premium_controls():
    costs = [336.0, 273.0, 262.5, 294.0]
    premiums = [reliability(costs, 1180.0, 0.05, rho, 0.90)["risk_premium_mrub"] for rho in (0.0, 0.65, 1.0)]
    assert premiums == pytest.approx([36.9, 61.6, 71.1], abs=0.2)


def test_shapley_axioms():
    symmetric = shapley_values(["a", "b"], lambda s: float(len(s) > 0) * 10.0)
    assert symmetric["a"] == pytest.approx(symmetric["b"])
    dummy = shapley_values(["a", "b", "dummy"], lambda s: 7.0 * len(set(s) & {"a", "b"}))
    assert dummy["dummy"] == pytest.approx(0.0)
    assert sum(dummy.values()) == pytest.approx(14.0)


def test_coalition_control_and_core(snapshot):
    request = EvaluateRequest.model_validate({"schema_version": SCHEMA_VERSION, "case_id": "SEP-KOSMOS-INFRA-2026",
        "case_version": "1.1", "selection": [{"lot_id": x, "mode_id": "A"} for x in ("FIRE", "AGRI", "TRANS", "ENV")]})
    result = evaluate_validated(request, snapshot)
    value = analyse_result(result, snapshot, 0.45, [0.25, 0.65])
    assert value["grand_cost_mrub"] == pytest.approx(853.7, abs=0.1)
    assert value["cooperation_savings_mrub"] == pytest.approx(311.8, abs=0.1)
    assert value["efficiency_error_mrub"] == pytest.approx(0.0, abs=1e-9)
    assert value["core"] == value["core"] | {"ok": True}
    assert value["core"]["checked"] == 14


def test_population_classifier_shadow_and_ladder(snapshot, population):
    advanced = build_advanced_bundle(snapshot)
    assert classify_population(population, snapshot, 0.30)["counts"] == {"0": 143, "1": 86, "2": 0, "3": 802}
    stress = {row["id"]: row for row in advanced["shadow_prices"]["STRESS"]["experiments"]}
    assert stress["c0_plus_10"]["delta_vpub_mrub_per_year"] == pytest.approx(39.6)
    assert stress["capabilities_to_3"]["delta_vpub_mrub_per_year"] == pytest.approx(-220.4)
    ladder = {row["uplift"]: row for row in advanced["optimism_ladder"]}
    assert [(ladder[x]["BASE"]["feasible"], ladder[x]["STRESS"]["feasible"]) for x in (0, .05, .10, .15, .20)] == [(1031,143),(648,1),(151,0),(14,0),(0,0)]


def test_nearest_repair_control(population):
    current = population_row([{"lot_id": "FIRE", "mode_id": "A"}, {"lot_id": "FLOOD", "mode_id": "A"},
                              {"lot_id": "INFRA", "mode_id": "B"}, {"lot_id": "ENV", "mode_id": "A"}], population)
    assert current is not None
    repaired = nearest_feasible(current, population, "STRESS")
    assert repaired["minimum_distance"] == 2
    assert repaired["one_change_available"] is False
    assert repaired["best"]["vpub_loss_mrub_per_year"] == pytest.approx(395.6)
