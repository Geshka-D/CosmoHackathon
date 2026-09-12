"""Bounded alternatives evaluated against the same verified source snapshot."""
from __future__ import annotations

import hashlib

from .canonical_adapter import evaluate_validated
from .case_loader import CaseRepository
from .constraints import UNITS
from .contracts import ADAPTER_VERSION, CASE_ID, CASE_VERSION, SCHEMA_VERSION, canonical_json
from .schemas import CompareRequest, validate_request


def compare(value, repository: CaseRepository | None = None) -> dict:
    request = validate_request(CompareRequest, value)
    snapshot = (repository or CaseRepository()).load()
    alternatives = [{"alternative_id": item.alternative_id, "result": evaluate_validated(item.request, snapshot)}
                    for item in request.alternatives]
    identity = [{"alternative_id": item["alternative_id"], "input_fingerprint": item["result"]["input_fingerprint"]}
                for item in alternatives]
    return {"schema_version": SCHEMA_VERSION, "adapter_version": ADAPTER_VERSION,
            "case_id": CASE_ID, "case_version": CASE_VERSION, "source_hashes": snapshot.source_hashes,
            "original_request": request.model_dump(),
            "comparison_fingerprint": hashlib.sha256(canonical_json(identity)).hexdigest(),
            "alternatives": alternatives,
            "metric_table": [{"metric": field, "unit": unit,
                              "values": {item["alternative_id"]: item["result"]["metrics"][field] for item in alternatives}}
                             for field, unit in UNITS.items()],
            "scenario_table": {scenario: {item["alternative_id"]: item["result"]["scenarios"][scenario]["status"] for item in alternatives}
                               for scenario in ("BASE", "STRESS")}}
