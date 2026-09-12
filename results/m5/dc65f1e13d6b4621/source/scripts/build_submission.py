"""Recompute saved decision/management/assumptions and atomically publish 3 PDFs."""
import argparse
from pathlib import Path
import sys

sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from backend.app.contracts import ServiceError,canonical_json
from backend.app.submission import publish,read_current


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir',type=Path,help='Independent destination (default project root); LIVE is not overwritten when set')
    parser.add_argument('--current',action='store_true',help='Verify one active generation and print its paths, without writing')
    args=parser.parse_args();destination=(args.output_dir or ROOT).resolve()
    try:
        manifest=read_current(destination)[0] if args.current else publish(destination)
        print('submission_id='+manifest['submission_id'])
        print('publication_id='+manifest['publication_id'])
        for name in ('note.pdf','stress.pdf','slides.pdf','bundle.json','finance.csv','content.md'):
            print(destination/manifest['directory']/name)
        return 0
    except ServiceError as exc:
        sys.stderr.buffer.write(canonical_json(exc.payload()));return 3 if exc.status_code>=500 else 2
    except (OSError,ValueError,KeyError,TypeError) as exc:
        print('Submission not published/verified: '+str(exc),file=sys.stderr);return 1


if __name__=='__main__':raise SystemExit(main())
