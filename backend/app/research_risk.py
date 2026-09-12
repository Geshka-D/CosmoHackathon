"""Analytic normal cost model; optional, no simulation/runtime dependencies."""
from math import isfinite, sqrt
from statistics import NormalDist

from .contracts import EPS


def cost_risk(values, cap, u, sigma, rho, q):
    costs = [float(value) for value in values]
    if (not costs or any(not isfinite(c) or c < 0 for c in costs)
            or not all(isfinite(x) for x in (cap, u, sigma, rho, q))
            or cap < 0 or u < 0 or sigma < 0 or not 0 <= rho <= 1 or not 0 < q < 1):
        raise ValueError("Finite nonnegative costs/cap/u/sigma, rho in [0,1], q in (0,1) required.")
    total = sum(costs)
    if not isfinite(total) or total <= 0:
        raise ValueError("Positive finite sum of costs required.")
    mu = total * (1 + u)
    h = sum((c / total) ** 2 for c in costs)
    sd = sigma * mu * sqrt((1 - rho) * h + rho)
    z = NormalDist().inv_cdf(q)
    margin, reserve = cap - mu, z * sd
    target_budget = mu + reserve
    if not all(isfinite(x) for x in (mu, sd, margin, reserve, target_budget)):
        raise ValueError("Settings overflow the finite analytic model.")
    if sigma > 0 and sd == 0:
        raise ValueError("Settings underflow the analytic model precision.")
    probability = float(mu <= cap + EPS) if sigma == 0 else NormalDist().cdf((cap - mu) / sd)
    return {"settings": {"u": u, "sigma": sigma, "rho": rho, "q": q, "cap": cap},
            "mu": mu, "H": h, "sd": sd, "z_q": z, "probability": probability,
            "existing_margin": margin, "required_reserve": reserve,
            "missing_budget": max(target_budget - cap, 0), "target_budget": target_budget,
            "negative_cost_warning": sigma >= .2,
            "negative_individual_cost_probability": 0 if sigma == 0 else NormalDist().cdf(-1 / sigma),
            "disclaimer": "Исследовательская модель. Параметры не оценены по реальным данным. Вероятность условна на выбранных допущениях.",
            "assumptions": ["Нормальные относительные отклонения затрат.",
                            "Одинаковая относительная sigma для всех лотов.",
                            "Равная попарная rho; общий и индивидуальные факторы независимы.",
                            "Нормальная модель допускает отрицательные затраты; при широкой sigma это существенно.",
                            "H описывает доли затрат, а не число независимых поставщиков.",
                            "При q < 0.5 квантильный резерв отрицателен; это не запас для высокой надёжности."]}
