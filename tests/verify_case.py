"""New independent M0 verification artifact authored by Tester on 2026-09-11.

The original organiser verify_case.py was absent. This file is not that original,
not production search/ranking, and not stage acceptance. It uses the unchanged
core for every combination, an independently authored Decimal/CSV oracle, the
received CONTROL_RESULTS reference, and explicit manual/boundary checks.
No jury member is opened and no notebook code is executed. Paths are relative
to this file's project root, never incidentally to the process working directory.
"""
from __future__ import annotations

import argparse
import copy
import csv
from decimal import Decimal as D
import hashlib
import importlib.metadata
import importlib.util
import itertools
import json
from pathlib import Path
import sys
import time
import zipfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
TOL = 1e-9
ALLOWED = {
    "task.pdf": "Космос как инфраструктура — Постановка задачи.pdf",
    "criteria.pdf": "Космос как инфраструктура — Критерии оценки.pdf",
    "README.md": "test-main/README.md",
    "case_core.py": "test-main/case_core.py",
    "data/lots.csv": "test-main/data/lots.csv",
    "data/access_modes.csv": "test-main/data/access_modes.csv",
    "config/case_config.json": "test-main/config/case_config.json",
    "Космос_как_инфраструктура.ipynb": "test-main/Космос_как_инфраструктура.ipynb",
}
NUMERIC = ("c0_mrub", "opex_mrub_per_year", "vpub_mrub_per_year", "cash_mrub_per_year",
           "kcash", "t_rep", "readiness_1_5", "resilience_1_5", "scale_1_5")


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def read_json(path):
    def reject(value):
        raise ValueError(f"Non-finite JSON: {value}")
    return json.loads(path.read_text(encoding="utf-8-sig"), parse_constant=reject)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def equal(actual, expected, location):
    if isinstance(expected, (float, D)):
        require(abs(float(actual) - float(expected)) <= TOL, f"{location}: {actual} != {expected}")
    elif isinstance(expected, dict):
        require(set(actual) == set(expected), f"{location}: keys differ")
        for key in expected:
            equal(actual[key], expected[key], f"{location}/{key}")
    else:
        require(actual == expected, f"{location}: {actual} != {expected}")


def csv_rows(path, key):
    with path.open(encoding="utf-8-sig", newline="") as stream:
        rows = list(csv.DictReader(stream))
    require(len({r[key] for r in rows}) == len(rows), f"Duplicate {key}")
    return {r[key]: r for r in rows}


def oracle(selection, lots, modes):
    """Source equations expressed with decimal arithmetic, no call into core."""
    detail = []
    territories, capabilities = set(), set()
    for lot_id, mode_id in selection:
        lot, mode = lots[lot_id], modes[mode_id]
        row = {"c0_mrub": D(lot["c0_mrub"]) * D(mode["k_c0"]),
               "opex_mrub_per_year": D(lot["opex_mrub_per_year"]) * D(mode["k_opex"]),
               "vpub_mrub_per_year": D(lot["vpub_mrub_per_year"]) * D(mode["k_vpub"]),
               "cash_mrub_per_year": D(lot["anchor_cash_mrub_per_year"]) * D(mode["k_anchor"])
                    + D(lot["commercial_cash_mrub_per_year"]) * D(mode["k_commercial"])}
        row.update({key: D(lot[key]) for key in NUMERIC[5:]})
        detail.append(row)
        if lot["federal"] == "false":
            territories.add(lot["territorial_archetype"])
        for token in lot["capability_groups"].split(";"):
            token = token.strip()
            if token:
                capabilities.add("PNT/InSAR" if token in ("PNT", "InSAR", "PNT/InSAR") else token)
    totals = {key: sum(row[key] for row in detail) for key in NUMERIC[:4]}
    totals["kcash"] = totals["cash_mrub_per_year"] / totals["opex_mrub_per_year"]
    totals.update({key: sum(row[key] for row in detail) / len(detail) for key in NUMERIC[5:]})
    totals.update(selected_lots=len(set(x[0] for x in selection)),
                  territorial_archetypes=len(territories), capability_groups=len(capabilities),
                  capability_set=sorted(capabilities),
                  public_core_lots=sum(modes[m]["public_core"] == "true" for _, m in selection))
    return totals


def expected_constraints(m, scenario):
    """Independent fixed v1.1 thresholds transcribed from S4/S5/README."""
    eps = D("0.000000001")
    return {
        "exact_lot_count": m["selected_lots"] == 4,
        "territorial_archetypes": m["territorial_archetypes"] >= 3,
        "capability_groups": m["capability_groups"] >= 2,
        "public_core_lots": m["public_core_lots"] >= 2,
        "c0_limit": m["c0_mrub"] <= D(1300 if scenario == "BASE" else 1180) + eps,
        "opex_limit": m["opex_mrub_per_year"] <= D(360) + eps,
        "vpub_floor": m["vpub_mrub_per_year"] >= D(1000) - eps,
        "kcash_floor": m["kcash"] >= D("0.6") - eps,
        "t_rep_floor": m["t_rep"] >= D("0.63") - eps,
    }


def core_checks(core, metrics, config, scenario):
    frame = core.check_constraints(metrics, config, scenario)
    require(len(frame) == 9 and frame.constraint.nunique() == 9, "Nine unique checks required")
    return {row.constraint: bool(row.ok) for row in frame.itertuples()}


def run(output):
    started = time.perf_counter()
    baseline = read_json(ROOT / "reports/M0_BASELINE_MANIFEST.json")
    manifest = read_json(ROOT / "config/source_manifest.json")
    control = read_json(ROOT / "CONTROL_RESULTS.json")
    recorded = read_json(ROOT / "reports/M0_CODER_FILES.json")["files"]
    protected = baseline + manifest["files"] + recorded
    for item in protected:
        path = ROOT / item["path"]
        require(path.stat().st_size == item["size_bytes"] and sha(path) == item["sha256"], f"Hash/size mismatch: {path}")
    before = {item["path"]: sha(ROOT / item["path"]) for item in protected}
    source = ROOT / "case_source"
    require({p.relative_to(source).as_posix() for p in source.rglob("*") if p.is_file()} == set(ALLOWED), "Not exactly eight allowlisted source copies")
    require({i["path"]: i["archive_member"] for i in manifest["files"]} == {"case_source/"+k:v for k,v in ALLOWED.items()}, "Manifest allowlist differs")
    require(manifest["originals"] == baseline, "Manifest baseline differs")
    for path, expected in control["source_sha256"].items():
        require(sha(source/path) == expected, f"CONTROL hash mismatch: {path}")
    archive_path = Path(manifest["archive_path"])
    require(sha(archive_path) == manifest["archive_sha256"] == "767f3906b531d0adf5fbf6efd6bbc90a6bba92246617d9fecab75052072c763e", "Archive mismatch")
    with zipfile.ZipFile(archive_path) as archive:
        names = archive.namelist()  # metadata only; never open a jury member
        require(not any(Path(n).name == "verify_case.py" for n in names), "Unexpected original verifier found")
        for relative, member in ALLOWED.items():
            require("jury" not in member.lower() and names.count(member) == 1, "Unsafe/ambiguous member")
            require(archive.read(member) == (source/relative).read_bytes(), f"ZIP copy mismatch: {relative}")
    spec = importlib.util.spec_from_file_location("tester_unchanged_core", source/"case_core.py")
    core = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(core)
    lots, modes, config = core.load_case(source)
    raw_lots = csv_rows(source/"data/lots.csv", "lot_id")
    raw_modes = csv_rows(source/"data/access_modes.csv", "mode_id")
    require(len(lots) == len(raw_lots) == 8 and len(modes) == len(raw_modes) == 3, "8 lots / 3 modes")
    require(set(raw_lots) == {"FIRE","FLOOD","AGRI","INFRA","ARCTIC","TRANS","ENV","SSA"}, "Lot ids")
    require(set(raw_modes) == {"A","B","C"}, "Mode ids")
    require(config["case_version"] == "1.1" and config["case_id"] == "SEP-KOSMOS-INFRA-2026", "Case identity")
    require(config["constraints_common"] == {"selected_lots_exactly":4,"min_territorial_archetypes":3,"min_capability_groups":2,"min_public_core_lots":2,"opex_max_mrub_per_year":360,"vpub_min_mrub_per_year":1000,"kcash_min":0.6,"t_rep_min":0.63}, "Common thresholds")
    require(config["scenarios"] == {"BASE":{"c0_max_mrub":1300},"STRESS":{"c0_max_mrub":1180}}, "Scenario thresholds")
    require(str(lots.federal.dtype) == str(modes.public_core.dtype) == "bool", "Pandas bool dtype")
    require(lots.set_index("lot_id").federal.to_dict() == {k:k=="SSA" for k in raw_lots}, "Federal values")
    require(modes.set_index("mode_id").public_core.to_dict() == {k:k=="A" for k in raw_modes}, "Public-core values")
    require(all(v["federal"] == str(k=="SSA").lower() for k,v in raw_lots.items()), "Raw federal literals")
    require(all(v["public_core"] == str(k=="A").lower() for k,v in raw_modes.items()), "Raw public literals")
    for lot_id, mode_id in itertools.product(raw_lots, raw_modes):
        _, metrics = core.evaluate_portfolio([(lot_id,mode_id)],lots,modes,config)
        equal(metrics, oracle([(lot_id,mode_id)],raw_lots,raw_modes), f"single/{lot_id}/{mode_id}")
    _, fire = core.evaluate_portfolio([("FIRE","A")],lots,modes,config)
    for field, expected in zip(NUMERIC[:4], (336.0,89.25,560.0,83.75)):
        equal(fire[field],expected,f"manual FIRE A/{field}")
    require(not core_checks(core,fire,config,"BASE")["exact_lot_count"],"Single FIRE incorrectly complete")
    records, max_delta = [], 0.0
    for chosen in itertools.combinations(raw_lots,4):
        for chosen_modes in itertools.product(raw_modes,repeat=4):
            selection = list(zip(chosen,chosen_modes))
            _, actual = core.evaluate_portfolio(selection,lots,modes,config)
            expected = oracle(selection,raw_lots,raw_modes)
            equal(actual,expected,str(selection))
            max_delta = max(max_delta,*(abs(actual[k]-float(expected[k])) for k in NUMERIC))
            record = {"selection":[list(p) for p in selection],**actual}
            for scenario in ("BASE","STRESS"):
                checks = core_checks(core,actual,config,scenario)
                equal(checks,expected_constraints(expected,scenario),f"{selection}/{scenario}")
                record[scenario.lower()+"_ok"] = all(checks.values())
                record[scenario.lower()+"_failed"] = [key for key,value in checks.items() if not value]
            require(not record["stress_ok"] or record["base_ok"], "STRESS not subset BASE")
            records.append(record)
    require(len({tuple(map(tuple,r["selection"])) for r in records}) == 5670,"Canonical uniqueness")
    counts = {"total":len(records),"base_feasible":sum(r["base_ok"] for r in records),"stress_feasible":sum(r["stress_ok"] for r in records),"base_only":sum(r["base_ok"] and not r["stress_ok"] for r in records)}
    equal(counts,{k:control[k] for k in counts},"CONTROL counts")
    equal(counts,{"total":5670,"base_feasible":1031,"stress_feasible":143,"base_only":888},"Fixed received counts")
    extremes = {}
    for scenario in ("base","stress"):
        feasible = [r for r in records if r[scenario+"_ok"]]
        for metric in ("vpub_mrub_per_year","c0_mrub","kcash"):
            value = (min if metric == "c0_mrub" else max)(r[metric] for r in feasible)
            winners = [r for r in feasible if abs(r[metric]-value) <= TOL]
            key = scenario+"_"+metric
            require(len(winners) == control["extremes"][key]["ties"], f"Extreme ties: {key}")
            require(control["extremes"][key]["record"]["selection"] in [r["selection"] for r in winners],f"Extreme selection: {key}")
            matching = next(r for r in winners if r["selection"] == control["extremes"][key]["record"]["selection"])
            equal(matching,control["extremes"][key]["record"],f"CONTROL full extreme/{key}")
            extremes[key] = {"value":value,"ties":len(winners),"record":matching}
    example = extremes["base_vpub_mrub_per_year"]["record"]
    base_config, stress_config = copy.deepcopy(config), copy.deepcopy(config)
    base_config["scenarios"] = {"BASE":{"c0_max_mrub":1300}}
    stress_config["scenarios"] = {"STRESS":{"c0_max_mrub":1180}}
    detail_b, mb = core.evaluate_portfolio(example["selection"],lots,modes,base_config)
    detail_s, ms = core.evaluate_portfolio(example["selection"],lots,modes,stress_config)
    equal(mb,ms,"Distinct BASE/STRESS config economic invariance")
    require(detail_b.equals(detail_s),"Scenario changed lot detail")
    cb, cs = core_checks(core,mb,base_config,"BASE"), core_checks(core,ms,stress_config,"STRESS")
    require([k for k in cb if cb[k] != cs[k]] == ["c0_limit"],"Expected only C0 check difference")
    equal(1300-mb["c0_mrub"],3.0,"BASE headroom")
    equal(1180-ms["c0_mrub"],-117.0,"STRESS headroom")
    boundary_count = 0
    boundary_fields = [("selected_lots","exact_lot_count",4,1), ("territorial_archetypes","territorial_archetypes",3,-1), ("capability_groups","capability_groups",2,-1), ("public_core_lots","public_core_lots",2,-1), ("c0_mrub","c0_limit",1300,1e-7), ("opex_mrub_per_year","opex_limit",360,1e-7), ("vpub_mrub_per_year","vpub_floor",1000,-1e-7), ("kcash","kcash_floor",0.6,-1e-7), ("t_rep","t_rep_floor",0.63,-1e-7)]
    for field, check, limit, delta in boundary_fields:
        for offset, ok in [(0,True),(delta,False)]+([(delta/1000,True)] if isinstance(delta,float) else []):
            fixture = dict(mb); fixture[field] = limit+offset
            require(core_checks(core,fixture,config,"BASE")[check] == ok,f"Boundary {check}/{offset}")
            boundary_count += 1
    for token in ("PNT","InSAR","PNT/InSAR"):
        require(core.normalize_capability(token) == {"PNT/InSAR"},"Capability normalization")
    _, empty = core.evaluate_portfolio([],lots,modes,config)
    require(not any(core_checks(core,empty,config,"BASE").values()),"Empty selection")
    for invalid in [[("NOT_A_LOT","A")],[("FIRE","NOT_A_MODE")]]:
        try:
            core.evaluate_portfolio(invalid,lots,modes,config)
        except ValueError:
            pass
        else:
            raise AssertionError("Unknown ID not rejected")
    duplicated = example["selection"]+[example["selection"][0]]
    duplicate_detail, duplicate_metrics = core.evaluate_portfolio(duplicated,lots,modes,config)
    duplicate_check = core_checks(core,duplicate_metrics,config,"BASE")["exact_lot_count"]
    require(len(duplicate_detail)==5 and duplicate_metrics["selected_lots"]==4 and duplicate_check,"Known unchanged-core duplicate behavior differs")
    require(not any(r["stress_ok"] and any(p[0]=="ARCTIC" for p in r["selection"]) for r in records),"Unexpected ARCTIC STRESS feasibility")
    for relative, expected in before.items():
        require(sha(ROOT/relative)==expected,f"Unexpected source write: {relative}")
    result = {"status":"PASS","scope":"M0 independent source/calculation checks only; no stage acceptance","provenance":"New independently authored Tester artifact; original verifier absent from root and archive", "runtime":{"python":sys.version,"executable":sys.executable,"cwd":str(Path.cwd()),"root":str(ROOT),"pandas":importlib.metadata.version("pandas"),"numpy":importlib.metadata.version("numpy"),"dont_write_bytecode":sys.dont_write_bytecode},"originals_verified":len(baseline),"allowed_copies_verified":len(ALLOWED),"coder_inventory_verified":len(recorded),"protected_distinct_files_unchanged":len(before),"archive_members_opened":list(ALLOWED.values()),"original_verifier_in_archive":False,"counts":counts,"extremes":extremes,"independent_decimal_oracle_combinations":len(records),"independent_decimal_max_absolute_metric_delta":max_delta,"single_lot_mode_checks":24,"constraint_boundary_checks":boundary_count,"manual_FIRE_A":{k:fire[k] for k in NUMERIC[:4]},"scenario_check":{"distinct_configs":True,"economic_and_detail_unchanged":True,"changed_checks":["c0_limit"],"headroom_BASE":3,"headroom_STRESS":-117},"known_source_limitations":{"duplicates":{"rows":len(duplicate_detail),"unique_lots":duplicate_metrics["selected_lots"],"exact_lot_count_passes":duplicate_check,"classification":"KNOWN_SOURCE_LIMITATION; M1 wrapper required; no source repair"}},"arctic_stress_feasible":0,"elapsed_seconds":time.perf_counter()-started}
    output.mkdir(parents=True,exist_ok=True)
    (output/"all_5670.json").write_text(json.dumps(records,ensure_ascii=False,allow_nan=False),encoding="utf-8")
    (output/"summary.json").write_text(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False),encoding="utf-8")
    print(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir",type=Path,default=ROOT/"reports/evidence/m0_tester/canonical")
    args = parser.parse_args()
    destination = args.output_dir if args.output_dir.is_absolute() else ROOT/args.output_dir
    require(destination.resolve().is_relative_to((ROOT/"reports/evidence").resolve()),"Evidence output must stay in project reports/evidence")
    run(destination)
