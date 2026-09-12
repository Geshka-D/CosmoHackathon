"""Closed-form capital-cost reliability indicators proposed by the team."""
from __future__ import annotations

from math import erf, isfinite, sqrt
from statistics import NormalDist

from .contracts import EPS

FORMULAS = {
    "herfindahl": "H = sum((c_i / C)^2)",
    "effective_lots": "N_eff = 1 / H",
    "standard_deviation": "sd(C0) = sigma * C * sqrt((1-rho)*H + rho)",
    "probability": "P(C0 <= Lim) = Phi((Lim-C)/sd(C0))",
    "reliable_ceiling": "C * (1 + z_(confidence)*sigma*sqrt((1-rho)*H+rho)) <= Lim",
    "risk_premium": "Lim - Lim / (1 + z_(confidence)*sigma*sqrt((1-rho)*H+rho))",
}
UNITS = {
    "herfindahl": "доля^2, безразмерно", "effective_lots": "эквивалент независимых лотов",
    "standard_deviation": "млн руб.", "probability": "доля 0-1",
    "reliable_ceiling": "млн руб.", "risk_premium": "млн руб.",
}


def _costs(values) -> list[float]:
    result = [float(value) for value in values]
    if not result or any(not isfinite(value) or value < 0 for value in result) or sum(result) <= 0:
        raise ValueError("Capital costs must be finite, non-negative and have a positive sum")
    return result


def herfindahl(values) -> float:
    costs = _costs(values)
    total = sum(costs)
    return sum((value / total) ** 2 for value in costs)


def normal_cdf(value: float) -> float:
    return 0.5 * (1.0 + erf(value / sqrt(2.0)))


def reliability(values, limit: float, sigma: float, rho: float, confidence: float) -> dict:
    costs = _costs(values)
    total = sum(costs)
    h = herfindahl(costs)
    concentration = (1.0 - rho) * h + rho
    standard_deviation = sigma * total * sqrt(concentration)
    if standard_deviation <= EPS:
        probability = 1.0 if total <= limit + EPS else 0.0
    else:
        probability = normal_cdf((limit - total) / standard_deviation)
    z = NormalDist().inv_cdf(confidence)
    factor = 1.0 + z * sigma * sqrt(concentration)
    reliable_ceiling = limit / factor
    risk_premium = limit - reliable_ceiling
    reserve_share = risk_premium / reliable_ceiling if reliable_ceiling else 0.0
    reliable = total <= reliable_ceiling + EPS
    return {
        "marker": "TEAM_INDICATOR", "inputs": {"sigma": sigma, "rho": rho, "confidence": confidence},
        "capital_costs_mrub": costs, "mean_c0_mrub": total, "limit_mrub": float(limit),
        "herfindahl": h, "effective_lots": 1.0 / h, "standard_deviation_mrub": standard_deviation,
        "probability": max(0.0, min(1.0, probability)), "z": z, "reliability_factor": factor,
        "reliable_cost_ceiling_mrub": reliable_ceiling, "risk_premium_mrub": risk_premium,
        "target_reserve_share": reserve_share, "reliable": reliable,
        "status": "RELIABLE" if reliable else "BELOW_TARGET",
        "formulas": FORMULAS, "units": UNITS,
        "assumption_refs": ["config/assumptions.json#A17", "config/assumptions.json#A18", "config/assumptions.json#A19"],
    }
