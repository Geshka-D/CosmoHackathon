"""Recalculate a versioned JSON request from any cwd; never trust saved results."""
from __future__ import annotations

import argparse
from pathlib import Path
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.app.canonical_adapter import evaluate
from backend.app.comparison import compare
from backend.app.contracts import MAX_BODY_BYTES, ServiceError, canonical_json, parse_json
from backend.app.search import search
from backend.app.sensitivity import sensitivity
from backend.app.decision import recompute_decision
from backend.app.advanced_analysis import build_advanced_bundle
from backend.app.case_loader import CaseRepository


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", help="Versioned request JSON path, or - for stdin")
    kind = parser.add_mutually_exclusive_group()
    kind.add_argument("--compare", action="store_true", help="Read a CompareRequest instead of EvaluateRequest")
    kind.add_argument("--search", action="store_true", help="Read a kosmos-search/1 request")
    kind.add_argument("--sensitivity", action="store_true", help="Rerank four weight perturbations and equal weights")
    kind.add_argument("--decision", action="store_true", help="Recompute a kosmos-decision/1 configuration")
    kind.add_argument("--advanced", action="store_true", help="Recompute all configured team indicators over the canonical population")
    parser.add_argument("--output", type=Path, help="Create a NEW result JSON file; existing files are never overwritten")
    args = parser.parse_args()
    try:
        if args.input == "-":
            data = sys.stdin.buffer.read(MAX_BODY_BYTES + 1)
        else:
            with Path(args.input).open("rb") as stream:
                data = stream.read(MAX_BODY_BYTES + 1)
        value = parse_json(data)
        handler = recompute_decision if args.decision else sensitivity if args.sensitivity else search if args.search else compare if args.compare else evaluate
        result = build_advanced_bundle(CaseRepository().load()) if args.advanced else handler(value)
        output = canonical_json(result)
        if args.output:
            with args.output.open("xb") as stream:
                stream.write(output)
        else:
            sys.stdout.buffer.write(output)
        return 0
    except ServiceError as exc:
        sys.stderr.buffer.write(canonical_json(exc.payload()))
        return 3 if exc.status_code >= 500 else 2
    except OSError:
        sys.stderr.buffer.write(canonical_json(ServiceError("file_error", "Не удалось прочитать вход или создать новый выходной файл.").payload()))
        return 3
    except Exception:
        sys.stderr.buffer.write(canonical_json(ServiceError("internal_error", "Внутренняя ошибка расчёта; результат не сформирован.").payload()))
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
