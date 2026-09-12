"""Classify contractual and capital responses to the canonical STRESS limit."""
from __future__ import annotations

from collections import Counter, OrderedDict
from copy import deepcopy
from threading import RLock

from .contracts import EPS
from .repair import portfolio_distance
from .search import portfolio_id

LABELS = {
    0: "уже допустим",
    1: "договорный опцион",
    2: "капитальная пересборка",
    3: "непересобираем",
}
_CACHE: OrderedDict[str, dict] = OrderedDict()
_LOCK = RLock()


def _same_lots(left, right) -> bool:
    return {row["lot_id"] for row in left} == {row["lot_id"] for row in right}


def _pair_costs(snapshot) -> dict[tuple[str, str], float]:
    lots = snapshot.lots.set_index("lot_id", drop=False)
    modes = snapshot.modes.set_index("mode_id", drop=False)
    return {(lot, mode): snapshot.core.apply_mode(lots.loc[lot], modes.loc[mode])["c0_mrub"]
            for lot in lots.index for mode in modes.index}


def _sunk_cost(current: dict, candidate: dict, snapshot, alpha: float,
               pair_costs: dict[tuple[str, str], float] | None = None) -> tuple[float, list[str]]:
    candidate_ids = {row["lot_id"] for row in candidate["selection"]}
    removed = [row for row in current["selection"] if row["lot_id"] not in candidate_ids]
    pair_costs = pair_costs or _pair_costs(snapshot)
    sunk = sum(pair_costs[(row["lot_id"], row["mode_id"])] for row in removed) * alpha
    return sunk, [row["lot_id"] for row in removed]


def classify_portfolio(current: dict, population: dict, snapshot, alpha: float,
                       pair_costs: dict[tuple[str, str], float] | None = None) -> dict:
    common = {"marker": "TEAM_INDICATOR", "alpha": alpha,
              "alpha_source": "config/assumptions.json#A20",
              "formula": "sunk = alpha * sum(c0 of replaced lots in their current modes)"}
    if current["scenarios"]["STRESS"]["ok"]:
        return {**common, "type": 0, "label": LABELS[0], "changes": 0,
                "candidate": current, "sunk_cost_mrub": 0.0}
    same = [row for row in population["rows"]
            if row["scenarios"]["STRESS"]["ok"] and _same_lots(current["selection"], row["selection"])]
    if same:
        same.sort(key=lambda row: (-row["metrics"]["vpub_mrub_per_year"],
                                   portfolio_distance(current["selection"], row["selection"]),
                                   row["metrics"]["c0_mrub"], row["portfolio_id"]))
        best = same[0]
        return {**common, "type": 1, "label": LABELS[1],
                "changes": portfolio_distance(current["selection"], best["selection"]),
                "candidate": best, "sunk_cost_mrub": 0.0}
    limit = snapshot.config["scenarios"]["STRESS"]["c0_max_mrub"]
    rebuilds = []
    for candidate in population["rows"]:
        if not candidate["scenarios"]["STRESS"]["ok"] or _same_lots(current["selection"], candidate["selection"]):
            continue
        sunk, removed = _sunk_cost(current, candidate, snapshot, alpha, pair_costs)
        total = candidate["metrics"]["c0_mrub"] + sunk
        if total <= limit + EPS:
            rebuilds.append((candidate, sunk, removed, total))
    if rebuilds:
        rebuilds.sort(key=lambda item: (-item[0]["metrics"]["vpub_mrub_per_year"], item[3], item[0]["portfolio_id"]))
        candidate, sunk, removed, total = rebuilds[0]
        return {**common, "type": 2, "label": LABELS[2],
                "changes": portfolio_distance(current["selection"], candidate["selection"]),
                "candidate": candidate, "sunk_cost_mrub": sunk, "removed_lots": removed,
                "candidate_plus_sunk_mrub": total}
    return {**common, "type": 3, "label": LABELS[3], "changes": None,
            "candidate": None, "sunk_cost_mrub": None}


def classify_population(population: dict, snapshot, alpha: float) -> dict:
    key = f"{population['reference']['population_id']}:{alpha:.12g}"
    with _LOCK:
        if key in _CACHE:
            _CACHE.move_to_end(key)
            return deepcopy(_CACHE[key])
    rows = [row for row in population["rows"] if row["scenarios"]["BASE"]["ok"]]
    stress_rows = [row for row in population["rows"] if row["scenarios"]["STRESS"]["ok"]]
    stress_lot_sets = {frozenset(item["lot_id"] for item in row["selection"]) for row in stress_rows}
    pair_costs = _pair_costs(snapshot)
    counts = Counter()
    for row in rows:
        if row["scenarios"]["STRESS"]["ok"]:
            counts[0] += 1
            continue
        lot_set = frozenset(item["lot_id"] for item in row["selection"])
        if lot_set in stress_lot_sets:
            counts[1] += 1
            continue
        rebuildable = False
        for candidate in stress_rows:
            sunk, _ = _sunk_cost(row, candidate, snapshot, alpha, pair_costs)
            if candidate["metrics"]["c0_mrub"] + sunk <= snapshot.config["scenarios"]["STRESS"]["c0_max_mrub"] + EPS:
                rebuildable = True
                break
        counts[2 if rebuildable else 3] += 1
    result = {"marker": "TEAM_INDICATOR", "base_feasible": len(rows), "alpha": alpha,
              "counts": {str(kind): counts[kind] for kind in range(4)},
              "labels": {str(kind): LABELS[kind] for kind in range(4)},
              "shares": {str(kind): counts[kind] / len(rows) for kind in range(4)},
              "survives_without_capital_loss": counts[0] + counts[1],
              "nonrebuildable": counts[3],
              "classification_formula": "type 0: STRESS pass; type 1: same lots, changed modes; type 2: replacement plus sunk cost; type 3: none"}
    with _LOCK:
        _CACHE[key] = deepcopy(result)
        while len(_CACHE) > 4:
            _CACHE.popitem(last=False)
    return result


def population_row(selection, population: dict) -> dict | None:
    pid = portfolio_id(sorted(selection, key=lambda row: row["lot_id"]))
    return next((row for row in population["rows"] if row["portfolio_id"] == pid), None)
