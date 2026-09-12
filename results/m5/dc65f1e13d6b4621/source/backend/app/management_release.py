"""Five-file local releases with one atomic activation pointer.

Readers resolve the pointer once, then verify/read that immutable generation.
Completed generations are retained so a concurrent reader never loses its files.
No database, per-file replacement of active artifacts, or historical fallback.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sys
from pathlib import Path
from uuid import uuid4

from .contracts import canonical_json
from .management import finance_csv
from .management_materials import render_documents

ARTIFACTS = ("results/m4_management.json", "results/m4_finance.csv",
             "docs/management-note-draft.md", "docs/stress-summary-draft.md",
             "docs/presentation-draft.md")
POINTER = "results/m4_current.json"
STORE = "results/m4_releases"
VERSION = "kosmos-management-release/1"


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def artifact_bytes(bundle):
    artifacts = {ARTIFACTS[0]: canonical_json(bundle), ARTIFACTS[1]: finance_csv(bundle).encode("utf-8")}
    artifacts.update({"docs/" + name: text.encode("utf-8") for name, text in bundle["materials"].items()})
    validate_artifacts(artifacts, bundle["release_id"])
    return artifacts


def validate_artifacts(artifacts, release_id):
    """Validate the saved JSON and all four peers, including deterministic re-render."""
    if set(artifacts) != set(ARTIFACTS):
        raise ValueError("A release must contain exactly the five declared artifacts")
    bundle = json.loads(artifacts[ARTIFACTS[0]])
    if bundle["release_id"] != release_id or _sha(canonical_json(bundle["identity"])) != release_id:
        raise ValueError("Release identity mismatch")
    if canonical_json(bundle) != artifacts[ARTIFACTS[0]]:
        raise ValueError("Noncanonical saved release JSON")
    csv = finance_csv(bundle)
    if bundle["finance_csv"] != csv or artifacts[ARTIFACTS[1]] != csv.encode("utf-8"):
        raise ValueError("CSV differs from saved release")
    materials = render_documents(bundle)
    if bundle["materials"] != materials:
        raise ValueError("Materials differ from saved release")
    for name, text in materials.items():
        if artifacts["docs/" + name] != text.encode("utf-8") or release_id not in text:
            raise ValueError("External material differs from saved release")
    return bundle


def _contained(root, relative):
    path = root / relative
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError("Release path outside destination")
    return path


def read_current_release(destination):
    """Return (manifest, artifacts) from exactly one verified active generation.

    Missing/invalid pointers or files raise; there is no fallback to old flat paths.
    Call once per consuming operation, and use these returned bytes for all peers.
    """
    root = Path(destination).resolve()
    manifest = json.loads(_contained(root, POINTER).read_bytes())
    return manifest, _read_generation(root, manifest)


def _read_generation(root, manifest):
    """Shared final-path verification for the reader and pre-activation writer."""
    if set(manifest) != {"schema_version", "release_id", "directory", "files"} or manifest["schema_version"] != VERSION:
        raise ValueError("Invalid release manifest")
    rid = manifest["release_id"]
    if not isinstance(rid, str) or not re.fullmatch(r"[0-9a-f]{64}", rid):
        raise ValueError("Invalid release id")
    if not isinstance(manifest["directory"], str) or not re.fullmatch(STORE + "/" + rid + r"-[0-9a-f]{32}", manifest["directory"]):
        raise ValueError("Invalid release directory")
    if set(manifest["files"]) != set(ARTIFACTS):
        raise ValueError("Incomplete release manifest")
    artifacts = {}
    for name in ARTIFACTS:
        data = _contained(root, manifest["directory"] + "/" + name).read_bytes()
        if manifest["files"][name] != {"size": len(data), "sha256": _sha(data)}:
            raise ValueError("Release artifact size/hash mismatch: " + name)
        artifacts[name] = data
    validate_artifacts(artifacts, rid)
    return artifacts


def publish_release(bundle, destination):
    """Stage and verify everything; only os.replace(pointer) activates the set.

    Ordinary write/finalization/activation errors leave the old pointer and all
    previously completed files intact. No successful return before activation.
    An interrupted complete but inactive generation can remain for inspection.
    """
    artifacts = artifact_bytes(bundle)
    root = Path(destination).resolve()
    store = _contained(root, STORE)
    store.mkdir(parents=True, exist_ok=True)
    generation = bundle["release_id"] + "-" + uuid4().hex
    final = store / generation
    stage = store / (".staging-" + uuid4().hex)
    stage_owned = False
    pointer = _contained(root, POINTER)
    pointer_temp = pointer.with_name(".m4-current-" + uuid4().hex + ".tmp")
    manifest = {"schema_version": VERSION, "release_id": bundle["release_id"],
                "directory": STORE + "/" + generation,
                "files": {name: {"size": len(data), "sha256": _sha(data)} for name, data in artifacts.items()}}
    try:
        # Product directories inherit the store's normal access. On Windows a
        # TemporaryDirectory uses private 0o700 access that survives its rename.
        stage.mkdir(exist_ok=False)
        stage_owned = True
        for name, data in artifacts.items():
            path = stage / name
            path.parent.mkdir(parents=True, exist_ok=True)
            if path.write_bytes(data) != len(data):
                raise OSError("Incomplete artifact write: " + name)
        saved = {name: (stage / name).read_bytes() for name in ARTIFACTS}
        if saved != artifacts:
            raise OSError("Written artifacts differ from prepared release")
        validate_artifacts(saved, bundle["release_id"])
        # Same-store rename still leaves this generation inactive. Verify the
        # actual final paths with the reader's validator before publishing them.
        os.rename(stage, final)
        stage_owned = False
        _read_generation(root, manifest)
        payload = canonical_json(manifest)
        if pointer_temp.write_bytes(payload) != len(payload) or pointer_temp.read_bytes() != payload:
            raise OSError("Incomplete release pointer write")
        os.replace(pointer_temp, pointer)  # sole activation / commit point
    finally:
        # Clean up only this call's temporary objects. Never change permissions
        # or hide the primary publication error if cleanup itself is denied.
        primary_error = sys.exception()
        try:
            pointer_temp.unlink(missing_ok=True)
        except OSError as cleanup_error:
            if primary_error is None:
                raise
            primary_error.add_note(f"Temporary pointer cleanup failed: {cleanup_error}")
        finally:
            if stage_owned:
                try:
                    shutil.rmtree(stage)
                except OSError as cleanup_error:
                    if primary_error is None:
                        raise
                    primary_error.add_note(f"Staging cleanup failed: {cleanup_error}")
    return manifest
