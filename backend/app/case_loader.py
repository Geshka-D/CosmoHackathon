"""Read and validate one immutable source snapshot per service operation."""
from __future__ import annotations

import csv
import hashlib
import io
import math
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Literal

import pandas as pd
from pydantic import Field

from .contracts import CASE_ID, CASE_VERSION, LOT_IDS, MODE_IDS, ServiceError, parse_json
from .schemas import StrictModel

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MANIFEST_PATH = "config/source_manifest.json"
# Release trust anchor: hash of the accepted M0 manifest, not calculation answers.
MANIFEST_SHA256 = "3c3a8d744e0f2a5b6041a5474f174c687c7c32efe4806cdf5c931a337520006e"
SOURCE_PATHS = (
    "case_source/task.pdf", "case_source/criteria.pdf", "case_source/README.md",
    "case_source/case_core.py", "case_source/data/lots.csv",
    "case_source/data/access_modes.csv", "case_source/config/case_config.json",
    "case_source/Космос_как_инфраструктура.ipynb",
)
LOT_NUMBERS = ("c0_mrub", "opex_mrub_per_year", "anchor_cash_mrub_per_year",
               "commercial_cash_mrub_per_year", "vpub_mrub_per_year", "t_rep",
               "readiness_1_5", "resilience_1_5", "scale_1_5")
LOT_TEXT = ("lot_id", "territorial_archetype", "service", "capability_groups")
MODE_NUMBERS = ("k_c0", "k_opex", "k_vpub", "k_anchor", "k_commercial")


class CommonConstraints(StrictModel):
    selected_lots_exactly: int = Field(gt=0)
    min_territorial_archetypes: int = Field(ge=0)
    min_capability_groups: int = Field(ge=0)
    min_public_core_lots: int = Field(ge=0)
    opex_max_mrub_per_year: float = Field(gt=0)
    vpub_min_mrub_per_year: float = Field(ge=0)
    kcash_min: float = Field(ge=0)
    t_rep_min: float = Field(ge=0)


class Scenario(StrictModel):
    c0_max_mrub: float = Field(gt=0)


class Scenarios(StrictModel):
    BASE: Scenario
    STRESS: Scenario


class CaseConfig(StrictModel):
    case_id: Literal[CASE_ID]
    case_version: Literal[CASE_VERSION]
    constraints_common: CommonConstraints
    scenarios: Scenarios


def csv_boolean(value: str) -> bool:
    if value == "true":
        return True
    if value == "false":
        return False
    raise ValueError("CSV boolean must be exactly true or false")


def parse_table(data: bytes, *, text_fields, number_fields, boolean_field, id_field, ids):
    reader = csv.DictReader(io.StringIO(data.decode("utf-8"), newline=""))
    expected = set(text_fields) | set(number_fields) | {boolean_field}
    if reader.fieldnames is None or len(reader.fieldnames) != len(expected) or set(reader.fieldnames) != expected:
        raise ValueError("Unexpected CSV columns")
    rows = []
    for source_row in reader:
        if set(source_row) != expected or any(v is None for v in source_row.values()):
            raise ValueError("Invalid CSV row width")
        row = {}
        for field in text_fields:
            value = source_row[field]
            if not value or value != value.strip() or len(value) > 256:
                raise ValueError("Invalid CSV text")
            row[field] = value
        for field in number_fields:
            value = float(source_row[field])
            if not math.isfinite(value) or value < 0:
                raise ValueError("Invalid CSV numeric value")
            row[field] = value
        row[boolean_field] = csv_boolean(source_row[boolean_field])
        rows.append(row)
    if len(rows) != len(ids) or {r[id_field] for r in rows} != set(ids):
        raise ValueError("Unexpected or duplicate source IDs")
    return pd.DataFrame(rows)


@dataclass(frozen=True)
class CaseSnapshot:
    lots: pd.DataFrame
    modes: pd.DataFrame
    config: dict
    core: ModuleType
    source_hashes: dict[str, str]
    sources: list[dict]


class CaseRepository:
    def __init__(self, root: Path = PROJECT_ROOT):
        self.root = Path(root).resolve()

    def _bytes(self, relative: str, size: int) -> bytes:
        path = self.root / relative
        if not path.resolve().is_relative_to(self.root):
            raise ValueError("Source path outside case root")
        with path.open("rb") as stream:
            data = stream.read(size + 1)
        if len(data) != size:
            raise ValueError("Source size mismatch")
        return data

    def load(self) -> CaseSnapshot:
        current = MANIFEST_PATH
        try:
            # Bound manifest reads too; its hash is pinned for the accepted case release.
            with (self.root / MANIFEST_PATH).open("rb") as stream:
                manifest_bytes = stream.read(65_537)
            if hashlib.sha256(manifest_bytes).hexdigest() != MANIFEST_SHA256:
                raise ValueError("Manifest integrity mismatch")
            manifest = parse_json(manifest_bytes)
            if manifest["case_id"] != CASE_ID or manifest["case_version"] != CASE_VERSION:
                raise ValueError("Case identity mismatch")
            entries = manifest["files"]
            if len(entries) != len(SOURCE_PATHS) or {e["path"] for e in entries} != set(SOURCE_PATHS):
                raise ValueError("Manifest allowlist mismatch")
            blobs, hashes, sources = {}, {MANIFEST_PATH: MANIFEST_SHA256}, []
            for entry in entries:
                current = entry["path"]
                data = self._bytes(current, entry["size_bytes"])
                actual = hashlib.sha256(data).hexdigest()
                if actual != entry["sha256"] or entry["case_version"] != CASE_VERSION:
                    raise ValueError("Source integrity mismatch")
                blobs[current], hashes[current] = data, actual
                sources.append({k: entry[k] for k in ("source_id", "path", "size_bytes", "case_version", "sha256")})
            current = "case_source/data/lots.csv"
            lots = parse_table(blobs[current], text_fields=LOT_TEXT, number_fields=LOT_NUMBERS,
                               boolean_field="federal", id_field="lot_id", ids=LOT_IDS)
            if (lots.opex_mrub_per_year <= 0).any():
                raise ValueError("OPEX must be positive for finite coverage")
            current = "case_source/data/access_modes.csv"
            modes = parse_table(blobs[current], text_fields=("mode_id",), number_fields=MODE_NUMBERS,
                                boolean_field="public_core", id_field="mode_id", ids=MODE_IDS)
            if (modes.k_opex <= 0).any():
                raise ValueError("OPEX coefficient must be positive")
            current = "case_source/config/case_config.json"
            config = CaseConfig.model_validate(parse_json(blobs[current])).model_dump()
            if config["constraints_common"]["selected_lots_exactly"] != 4:
                raise ValueError("Unsupported lot count")
            current = "case_source/case_core.py"
            core = ModuleType("preserved_case_core")
            # Compile the verified bytes directly: no import loader and no source-tree pycache.
            exec(compile(blobs[current], current, "exec"), core.__dict__)
            return CaseSnapshot(lots, modes, config, core, hashes, sources)
        except (OSError, ValueError, KeyError, TypeError, ServiceError) as exc:
            raise ServiceError("source_unavailable", "Источники кейса отсутствуют или не прошли проверку; расчёт недоступен.", 503,
                               [{"location": ["sources", current], "type": "source_integrity", "message": "Проверьте файл по принятому manifest."}]) from exc
