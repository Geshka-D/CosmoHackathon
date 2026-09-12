"""Create a new explicit-allowlist GitVerse directory and deterministic ZIP.

Never pass the development workspace as a Docker build context.
No source archive, organizer literature, orchestration history or environment
is enumerated. Original source hashes and active release hashes are verified.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import zipfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.app.case_loader import CaseRepository
from backend.app.management_release import read_current_release
from backend.app.submission import read_current

def sha(data): return hashlib.sha256(data).hexdigest()

def build(destination: Path):
    destination = destination.resolve()
    if destination.exists() or destination == ROOT:
        raise ValueError('Choose a NEW directory; existing files are never overwritten')
    if destination.with_suffix('.zip').exists():
        raise ValueError('Archive already exists; choose another destination')
    CaseRepository(ROOT).load()
    read_current_release(ROOT)
    _, artifacts = read_current(ROOT)
    identity = json.loads(artifacts['identity.json'])
    analytical = json.loads((ROOT/'results/m4_current.json').read_text(encoding='utf-8'))
    if identity['analytical_release_id'] != analytical['release_id']:
        raise ValueError('M4/M5 release mismatch; rebuild the submission before packaging')
    for group in ('input_hashes', 'authoring_hashes', 'source_hashes'):
        for rel, expected in identity[group].items():
            source = ROOT/rel
            if not source.resolve().is_relative_to(ROOT) or sha(source.read_bytes()) != expected:
                raise ValueError('Stale submission input: '+rel+'; rebuild before packaging')
    names = {'requirements.txt','pytest.ini','CONTROL_RESULTS.json','README_RUN.md',
             'scripts/reproduce.py','scripts/build_management.py','scripts/build_submission.py',
             'scripts/build_delivery.py','scripts/verify_delivery.py',
             'tests/m3_independent.py','tests/m3_browser_run.py','tests/m6_browser.mjs',
             'tests/test_advanced_math.py',
             'results/m3_decision.json'}
    for tree in ['backend','config','case_source','assets/fonts','frontend/src','frontend/dist','docs','packaging']:
        for folder, dirs, files in os.walk(ROOT/tree):
            dirs[:] = [d for d in dirs if d not in {'__pycache__','node_modules','.git'}]
            for name in files:
                p = Path(folder)/name
                if p.suffix not in {'.pyc','.pyo'}:
                    names.add(p.relative_to(ROOT).as_posix())
    for p in (ROOT/'frontend').iterdir():
        if p.is_file() and p.name not in {'.npmrc'}:
            names.add(p.relative_to(ROOT).as_posix())
    for stage in ['m4','m5']:
        pointer = 'results/'+stage+'_current.json'
        names.add(pointer)
        manifest = json.loads((ROOT/pointer).read_text(encoding='utf-8'))
        for rel, meta in manifest['files'].items():
            p = ROOT/manifest['directory']/rel
            data = p.read_bytes()
            if len(data) != meta['size'] or sha(data) != meta['sha256']:
                raise ValueError('Current release integrity failure: '+str(p))
            names.add(p.relative_to(ROOT).as_posix())
    payloads = {}
    for rel in sorted(names):
        src = ROOT/rel
        if not src.resolve().is_relative_to(ROOT) or src.is_symlink():
            raise ValueError('Unsafe input: '+rel)
        parts = src.relative_to(ROOT).parts
        if any(x in {'.git','.venv','node_modules','literature','snapshots'} for x in parts) or src.suffix.lower()=='.zip' or '_jury' in src.name.lower() or src.name.startswith('.env'):
            raise ValueError('Forbidden delivery member: '+rel)
        payloads[rel] = src.read_bytes()
    payloads['README.md'] = payloads['README_RUN.md']
    payloads['Dockerfile'] = payloads['packaging/Dockerfile']
    payloads['.dockerignore'] = payloads['packaging/dockerignore']
    payloads['.gitignore'] = b'.venv/\n.venv312/\nnode_modules/\n__pycache__/\n*.pyc\nout/\n.npm-cache/\n.env\n.env.*\n'
    # Source and release identities depend on exact bytes, including CRLF.
    # Preserve them even when an expert clones with core.autocrlf=true.
    payloads['.gitattributes'] = b'* -text\n'
    manifest = {'schema_version':'kosmos-delivery/1','source_policy':'Exact case_source bytes; no jury/archive/literature full texts. Archive path in accepted source_manifest is historical metadata only, never opened by runtime.',
                'files':{name:{'size':len(data),'sha256':sha(data)} for name,data in sorted(payloads.items())}}
    payloads['KIT_MANIFEST.json'] = (json.dumps(manifest,ensure_ascii=False,sort_keys=True,indent=2)+'\n').encode('utf-8')
    destination.mkdir(parents=True)
    for name,data in payloads.items():
        target=destination/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
    archive=destination.with_suffix('.zip')
    with zipfile.ZipFile(archive,'x',compression=zipfile.ZIP_DEFLATED) as z:
        for name,data in sorted(payloads.items()):
            entry=zipfile.ZipInfo(name,date_time=(2026,1,1,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED;entry.external_attr=0o100644<<16
            z.writestr(entry,data)
    result={'directory':str(destination),'archive':str(archive),'archive_sha256':sha(archive.read_bytes()),'files':len(payloads),'payload_bytes':sum(map(len,payloads.values()))}
    print(json.dumps(result,ensure_ascii=False,indent=2))
    return result

if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args()
    try: build(a.output)
    except (ValueError,OSError) as exc: print(str(exc),file=sys.stderr);raise SystemExit(1)
