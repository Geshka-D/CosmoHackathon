"""Nearest feasible neighbours over the already enumerated canonical population."""
from __future__ import annotations


def selection_map(selection) -> dict[str, str]:
    return {row["lot_id"]: row["mode_id"] for row in selection}


def portfolio_distance(left, right) -> int:
    """Number of removed lots plus mode changes among common lots."""
    a, b = selection_map(left), selection_map(right)
    return len(set(a) - set(b)) + sum(a[lot] != b[lot] for lot in set(a) & set(b))


def nearest_feasible(current: dict, population: dict, scenario: str, max_distance: int = 2,
                     limit: int = 5) -> dict:
    rows = []
    for candidate in population["rows"]:
        if not candidate["scenarios"][scenario]["ok"]:
            continue
        distance = portfolio_distance(current["selection"], candidate["selection"])
        if distance < 1 or distance > max_distance:
            continue
        loss = current["metrics"]["vpub_mrub_per_year"] - candidate["metrics"]["vpub_mrub_per_year"]
        rows.append({"distance": distance, "vpub_loss_mrub_per_year": loss,
                     "candidate": candidate, "formula": "d(A,B)=removed lots + changed modes among common lots",
                     "marker": "TEAM_INDICATOR"})
    if not rows:
        return {"available": False, "scenario": scenario, "searched_distance": max_distance,
                "candidates": [], "marker": "TEAM_INDICATOR"}
    best_distance = min(row["distance"] for row in rows)
    nearest = [row for row in rows if row["distance"] == best_distance]
    nearest.sort(key=lambda row: (row["vpub_loss_mrub_per_year"], row["candidate"]["metrics"]["c0_mrub"],
                                  row["candidate"]["portfolio_id"]))
    return {"available": True, "scenario": scenario, "minimum_distance": best_distance,
            "one_change_available": any(row["distance"] == 1 for row in rows),
            "best": nearest[0], "candidates": nearest[:limit], "marker": "TEAM_INDICATOR",
            "unit": "синтетические млн руб./год общественной ценности"}
