"""Verify shipped file hashes and preserved source bytes without an author's ZIP."""
import hashlib
import json
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from backend.app.case_loader import CaseRepository
from backend.app.submission import read_current
from backend.app.management_release import read_current_release

def main():
    manifest=json.loads((ROOT/'KIT_MANIFEST.json').read_text(encoding='utf-8'))
    for name,meta in manifest['files'].items():
        p=ROOT/name
        if not p.resolve().is_relative_to(ROOT):raise ValueError('Path outside kit')
        data=p.read_bytes()
        if len(data)!=meta['size'] or hashlib.sha256(data).hexdigest()!=meta['sha256']:raise ValueError('Changed/missing shipped file: '+name)
    CaseRepository(ROOT).load();read_current_release(ROOT);m,_=read_current(ROOT)
    print(json.dumps({'status':'PASS','shipped_files':len(manifest['files']),'submission_id':m['submission_id'],'scope':'file integrity/source/release checks; independent math: tests/m3_independent.py'},ensure_ascii=False))
if __name__=='__main__':main()
