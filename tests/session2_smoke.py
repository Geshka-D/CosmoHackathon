"""Session-author integration smoke against the running production build.

Inputs: saved configuration. Oracles: live canonical evaluation, official saved
result bytes, protected source hashes. This is not organizer/independent acceptance.
"""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--url", default="http://127.0.0.1:8011")
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
checks = []


def check(name, condition):
    assert condition, name
    checks.append(name)


def call(path, value=None):
    data = None if value is None else json.dumps(value, ensure_ascii=False).encode("utf-8")
    with urlopen(Request(args.url + path, data=data, headers={"Content-Type": "application/json"}), timeout=60) as response:
        raw = response.read()
        check(path + " HTTP 200", response.status == 200)
        return json.loads(raw), raw


config = json.loads((ROOT / "config/m3_decision.json").read_bytes())
call("/api/health")
catalog, _ = call("/api/case")
decision, official_before = call("/api/decision/recompute", config)
check("official saved result bytes", official_before == (ROOT / "results/m3_decision.json").read_bytes())
selection = decision["recommendation"]["base"]["selection"]
current = {key: catalog[key] for key in ("schema_version", "case_id", "case_version")}
current["selection"] = selection
canonical, _ = call("/api/evaluate", current)
research = {"format_version": "kosmos-intelligence/1", "search": config["request"],
            "current": current, "context": "RESEARCH", "budget_cap": 0, "locks": []}
for scenario in ("BASE", "STRESS"):
    value, _ = call("/api/intelligence", {**research, "search": {**config["request"], "scenario": scenario},
                                         "context": "OFFICIAL", "budget_cap": None})
    check(scenario + " full feasible set", value["feasible_count"] == decision["search"]["population"]["scenarios"][scenario]["feasible"])
    check(scenario + " current evaluation", value["current"]["feasible"] == canonical["scenarios"][scenario]["ok"])
    check(scenario + " explanation", value["explanation"]["official_stress"]["status"] == value["recommendation"]["candidate"]["scenarios"]["STRESS"]["status"])
cost = canonical["metrics"]["c0_mrub"]
value, _ = call("/api/intelligence", {**research, "budget_cap": cost})
check("exact breakpoint pass", value["current"]["feasible"])
below, _ = call("/api/intelligence", {**research, "budget_cap": cost - 1})
check("below breakpoint fail, feasible recovery", not below["current"]["feasible"] and bool(below["recovery"]))
for proposal in below["recovery"]:
    verified, _ = call("/api/evaluate", proposal["request"])
    check("recovery canonical metrics", all(abs(v - verified["metrics"][k]) < 1e-8 for k, v in proposal["candidate"]["metrics"].items() if isinstance(v, (int, float))))
    check("recovery canonical deltas", all(abs(v - (verified["metrics"][k] - canonical["metrics"][k])) < 1e-8 for k, v in proposal["delta"].items()))
    check("recovery satisfies research budget", verified["metrics"]["c0_mrub"] <= cost - 1 + 1e-9)
removed = next(p for p in below["recovery"] if p["changes"]["removed"])
required = removed["changes"]["removed"][0]
locked, _ = call("/api/intelligence", {**research, "budget_cap": cost - 1, "locks": [{"lot_id": required}]})
check("lock removes earlier proposal", all(p["candidate"]["portfolio_id"] != removed["candidate"]["portfolio_id"] for p in locked["recovery"]))
check("lock honored", all(any(r["lot_id"] == required for r in p["candidate"]["selection"]) for p in locked["recovery"]))
empty, _ = call("/api/intelligence", research)
check("no-solution region", empty["status"] == "NO_SOLUTION" and empty["budget"]["budget_only_blocker"])
impossible, _ = call("/api/intelligence", {**research, "budget_cap": 1000000, "locks": [{"lot_id": r["lot_id"], "mode_id": "C"} for r in selection]})
check("mode locks no solution even without cap", impossible["budget"]["minimum_feasible_budget"] is None and not impossible["recovery"])
passport, _ = call("/api/passport", current)
for key in ("c0_mrub", "opex_mrub_per_year", "vpub_mrub_per_year", "cash_mrub_per_year"):
    check("passport " + key, abs(passport["finance"]["totals"][key] - canonical["metrics"][key]) < 1e-9)
check("unconfirmed contracts marked UNKNOWN", all(s["confirmed_contracts"]["provenance"] == "UNKNOWN" for s in passport["services"]))
workspace = {"format_version": "kosmos-workspace/1", "source_hashes": catalog["source_hashes"], "workspace": {
    "current": {"name": "Reference", "request": current}, "scenario": "BASE",
    "alternatives": [{"name": "Reference", "alternative_id": "smoke-reference", "request": current},
                     {"name": "Recovery", "alternative_id": "smoke-recovery", "request": below["recovery"][0]["request"]}]}}
comparison, _ = call("/api/workspace/recompute", workspace)
check("compare result including reference delta", len(comparison["computed"]["alternatives"]) == 2 and len(comparison["computed"]["deltas"]) == 2)
check("reference delta zero", all(number == 0 for number in comparison["computed"]["deltas"][0]["metrics"].values()))
check("compare delta matches recovery", all(abs(comparison["computed"]["deltas"][1]["metrics"][key] - number) < 1e-8 for key, number in below["recovery"][0]["delta"].items()))
_, official_after = call("/api/decision/recompute", config)
check("official unchanged by research/locks/compare", official_before == official_after)
protected = json.loads((ROOT / "docs/decision-intelligence-protected.json").read_bytes())
check("all protected hashes unchanged", all(hashlib.sha256((ROOT / path).read_bytes()).hexdigest() == digest for path, digest in protected.items()))
report = {"status": "PASS", "checks": checks, "official_sha256": hashlib.sha256(official_after).hexdigest(),
          "protected_files": len(protected), "selection": selection, "research_cap": cost - 1,
          "recovery": [p["candidate"]["portfolio_id"] for p in below["recovery"]],
          "locked_service": required, "locked_recovery": [p["candidate"]["portfolio_id"] for p in locked["recovery"]],
          "minimum_feasible_budget": empty["budget"]["minimum_feasible_budget"]}
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"status": "PASS", "checks": len(checks), "protected_files": len(protected)}))
