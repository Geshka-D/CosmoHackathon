"""Recompute the accepted M3 release and all editable M4 management materials."""
from pathlib import Path
import argparse
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.app.contracts import ServiceError, canonical_json
from backend.app.management import build_management
from backend.app.management_release import publish_release, read_current_release


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, help='Release destination; default project root')
    parser.add_argument('--current', action='store_true', help='Verify the active five-file release and print its paths without rebuilding')
    args = parser.parse_args()
    destination = (args.output_dir or ROOT).resolve()
    try:
        if args.current:
            manifest, _ = read_current_release(destination)
        else:
            manifest = publish_release(build_management(), destination)
        print(manifest['release_id'])
        for relative, info in manifest['files'].items():
            print(f"{destination / manifest['directory'] / relative}: {info['size']} bytes")
        return 0
    except ServiceError as exc:
        sys.stderr.buffer.write(canonical_json(exc.payload()))
        return 3 if exc.status_code >= 500 else 2
    except (OSError, ValueError) as exc:
        print(f'Release not published/verified: {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
