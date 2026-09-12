"""Author live API/preservation smoke for the safe port; never builds materials."""
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
URL='http://127.0.0.1:8013'
checks=[]
def check(name,ok):
    assert ok,name
    checks.append(name)
def call(path,value=None):
    request=urllib.request.Request(URL+path,data=None if value is None else json.dumps(value).encode(),headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(request,timeout=90) as response:return response.read()
config=json.loads((ROOT/'config/m3_decision.json').read_bytes())
before=call('/api/decision/recompute',config)
check('official bytes before',before==(ROOT/'docs/research-official-before.json').read_bytes())
current=json.loads(before)['alternatives'][0]['request']
payload={'format_version':'kosmos-research-math/1','u':0,'intelligence':{
    'format_version':'kosmos-intelligence/1','search':config['request'],'current':current,
    'context':'RESEARCH','budget_cap':1180,'locks':[]}}
for u,count in [(0,143),(.05,1),(.1,0)]:
    value=json.loads(call('/api/research-math',{**payload,'u':u}))
    check(f'count u={u}',value['analysis']['feasible_count']==count)
    check(f'recovery u={u}',all(p['research_check']['feasible'] and p['research_check']['u']==u for p in value['analysis']['recovery']))
    if u==0:
        check('F1180',abs(value['budget_effect']['current']['vpub']-1370.4)<1e-9)
        check('next threshold',value['budget_effect']['next']['budget_threshold']==1186.5)
        check('next not feasible at old cap',not value['budget_effect']['next']['at_current_cap']['feasible'])
        check('next feasible at new cap',value['budget_effect']['next']['research_check']['feasible'])
settings={'sigma':.07,'rho':.4,'q':.95}
value=json.loads(call('/api/research-math',{**payload,'u':.03,'cost_risk':settings}))
check('actual risk settings',value['cost_risk']['settings']=={**settings,'u':.03,'cap':1180})
check('official bytes after',call('/api/decision/recompute',config)==before)
manifest=json.loads((ROOT/'docs/research-baseline-files.json').read_bytes())
for name,item in manifest.items():
    if name.startswith(('config/','case_source/','results/')):
        check('protected '+name,hashlib.sha256((ROOT/name).read_bytes()).hexdigest()==item['sha256'])
original=ROOT.parent
if (original/'reports/M0_BASELINE_MANIFEST.json').exists():
    for name,item in manifest.items():
        check('original workspace '+name,hashlib.sha256((original/name).read_bytes()).hexdigest()==item['sha256'])
    for item in json.loads((original/'reports/M0_BASELINE_MANIFEST.json').read_bytes()):
        check('M0 '+item['path'],hashlib.sha256((original/item['path']).read_bytes()).hexdigest()==item['sha256'])
report={'status':'PASS','checks':checks,'official_sha256':hashlib.sha256(before).hexdigest()}
(ROOT/'out/research-final-smoke.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps({'status':'PASS','checks':len(checks),'official_sha256':report['official_sha256']}))
