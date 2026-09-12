"""Generated independent M3 Tester harness, not production or organizer verifier.

Portable: python -B tests/m3_independent.py --output <NEW-directory>
Canonical checks read shipped case_source/config, never personal ZIP/mutable docs.
Expected math is independently transcribed from S4/S5; actual calls use production.
"""
from __future__ import annotations
import argparse, csv, hashlib, importlib.metadata, itertools, json, math, os, pathlib
import shutil, socket, subprocess, sys, threading, time, traceback, types
from copy import deepcopy
from dataclasses import replace
from decimal import Decimal as D

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT))
parser = argparse.ArgumentParser()
parser.add_argument('--output', type=pathlib.Path, required=True)
args = parser.parse_args()
OUT = args.output.resolve(); OUT.mkdir(parents=True, exist_ok=False)
RESULT = {'groups': [], 'assertions': 0, 'commands': [], 'http': [], 'owned_pid': os.getpid()}

def save(name, obj):
    (OUT/name).write_text(json.dumps(obj, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
def ck(condition, message):
    RESULT['assertions'] += 1
    if not condition: raise AssertionError(message)
def near(a,b,label): ck(math.isclose(float(a),float(b),rel_tol=0,abs_tol=1e-9),f'{label}: {a} != {b}')
def binary(value): return (json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode()
def digest(value): return hashlib.sha256(binary(value)).hexdigest()
def group(name, fn):
    t=time.monotonic(); start=RESULT['assertions']
    try: fn(); state='PASS'; error=None
    except Exception: state='FAIL'; error=traceback.format_exc(); print(error,flush=True)
    RESULT['groups'].append({'name':name,'status':state,'assertions':RESULT['assertions']-start,'seconds':time.monotonic()-t,'error':error})
    save('results.json',RESULT); print(name,state,flush=True)

from backend.app.case_loader import CaseRepository, SOURCE_PATHS
from backend.app.search import enumerate_population, get_population, search, SearchRequest
import backend.app.search as search_module
from backend.app.decision_model import normalize_weights, normalize_metrics, rank
from backend.app.sensitivity import sensitivity
from backend.app.decision import recompute_decision
from backend.app.contracts import ServiceError
from backend.app.main import create_app
import pandas as pd
import httpx, uvicorn

# Own field mapping, bounds and thresholds; no production helper supplies expected.
FIELDS={'vpub':'vpub_mrub_per_year','c0':'c0_mrub','opex':'opex_mrub_per_year','kcash':'kcash','t_rep':'t_rep','readiness':'readiness_1_5','resilience':'resilience_1_5','scale':'scale_1_5'}
M0={'vpub':.30,'c0':.15,'opex':.10,'kcash':.10,'t_rep':.05,'readiness':.10,'resilience':.15,'scale':.05}
INDICES=['t_rep','readiness_1_5','resilience_1_5','scale_1_5']
snapshot=CaseRepository().load()
CORE=types.ModuleType('tester_direct_original'); exec(compile((ROOT/'case_source/case_core.py').read_bytes(),'case_source/case_core.py','exec'),CORE.__dict__)
LOTS, MODES, CFG=CORE.load_case(ROOT/'case_source')
def csvmap(path,key):
    with (ROOT/path).open(encoding='utf-8',newline='') as f: return {r[key]:r for r in csv.DictReader(f)}
raw_lots=csvmap('case_source/data/lots.csv','lot_id'); raw_modes=csvmap('case_source/data/access_modes.csv','mode_id')
def decimal_pair(lot,mode):
    l=raw_lots[lot]; m=raw_modes[mode]
    r={k:D(l[k])*D(m[c]) for k,c in [('c0_mrub','k_c0'),('opex_mrub_per_year','k_opex'),('vpub_mrub_per_year','k_vpub'),('anchor_cash_mrub_per_year','k_anchor'),('commercial_cash_mrub_per_year','k_commercial')]}
    r['cash_mrub_per_year']=r['anchor_cash_mrub_per_year']+r['commercial_cash_mrub_per_year']
    r.update({k:D(l[k]) for k in INDICES}); return r
def independent_metrics(keys):
    rows=[decimal_pair(*key) for key in keys]
    r={k:sum(row[k] for row in rows) for k in rows[0]}
    for k in INDICES: r[k]/=len(rows)
    r['kcash']=r['cash_mrub_per_year']/r['opex_mrub_per_year']
    caps=set()
    for lot,_ in keys:
        for t in raw_lots[lot]['capability_groups'].split(';'):
            t=t.strip()
            if t: caps.add('PNT/InSAR' if t in {'PNT','InSAR','PNT/InSAR'} else t)
    r.update(selected_lots=len(keys),territorial_archetypes=len({raw_lots[l]['territorial_archetype'] for l,m in keys if raw_lots[l]['federal']=='false'}),capability_groups=len(caps),capability_set=sorted(caps),public_core_lots=sum(raw_modes[m]['public_core']=='true' for l,m in keys))
    return r, rows
def independent_checks(m,scenario):
    eps=D('1e-9')
    return dict(exact_lot_count=m['selected_lots']==4,territorial_archetypes=m['territorial_archetypes']>=3,capability_groups=m['capability_groups']>=2,public_core_lots=m['public_core_lots']>=2,c0_limit=m['c0_mrub']<=D(1300 if scenario=='BASE' else 1180)+eps,opex_limit=m['opex_mrub_per_year']<=D(360)+eps,vpub_floor=m['vpub_mrub_per_year']>=D(1000)-eps,kcash_floor=m['kcash']>=D('.6')-eps,t_rep_floor=m['t_rep']>=D('.63')-eps)
def own_weights(w):
    scale=max(w.values()); values={k:w[k]/scale for k in FIELDS}; total=math.fsum(values.values())
    return {k:v/total for k,v in values.items()}
def own_ranking(rows,w,bounds,scenario):
    applied=own_weights(w); result=[]
    for row in rows:
        if not row['scenarios'][scenario]['ok']: continue
        norms={}
        for key,field in FIELDS.items():
            lo,hi=bounds[key]['min'],bounds[key]['max']; x=row['metrics'][field]
            norms[key]=0 if lo==hi else ((hi-x) if key in {'c0','opex'} else (x-lo))/(hi-lo)
        score=math.fsum(applied[k]*norms[k] for k in FIELDS)
        result.append({**row,'score':score,'normalized':norms,'contributions':{k:applied[k]*norms[k] for k in FIELDS}})
    result.sort(key=lambda x:(-x['score'],x['metrics']['c0_mrub'],x['portfolio_id']))
    return [{**r,'rank':i+1} for i,r in enumerate(result)]
def eval_input(sel): return {'schema_version':'1.0','case_id':'SEP-KOSMOS-INFRA-2026','case_version':'1.1','selection':sel}
def request(w=M0,scenario='BASE',baseline=None,limit=100):
    return {'format_version':'kosmos-search/1','case_id':'SEP-KOSMOS-INFRA-2026','case_version':'1.1','source_hashes':snapshot.source_hashes,'modes':'A/B/C','method_version':'weighted-mcda/base-reference/1','scenario':scenario,'weights':w,'limit':limit,'baseline':baseline}
ORACLE=[]; BOUNDS={}; UI_EXPECTED={}

def canonical():
    manifest=json.loads((ROOT/'config/source_manifest.json').read_text(encoding='utf-8'))
    ck(len(manifest['files'])==8,'8 permitted sources')
    for entry in manifest['files']:
        b=(ROOT/entry['path']).read_bytes(); ck(len(b)==entry['size_bytes'] and hashlib.sha256(b).hexdigest()==entry['sha256'],entry['path'])
    ck(len(raw_lots)==8 and len(raw_modes)==3,'input dimensions')
    ck(LOTS.federal.dtype==bool and MODES.public_core.dtype==bool,'native booleans')
    pairs=[]
    for l,m in itertools.product(sorted(raw_lots),sorted(raw_modes)):
        expected=decimal_pair(l,m); actual=CORE.apply_mode(LOTS.set_index('lot_id',drop=False).loc[l],MODES.set_index('mode_id',drop=False).loc[m])
        for key in ['c0_mrub','opex_mrub_per_year','vpub_mrub_per_year','cash_mrub_per_year',*INDICES]: near(actual[key],expected[key],f'pair {l}/{m}/{key}')
        pairs.append({'lot':l,'mode':m,'expected':{k:str(v) for k,v in expected.items()}})
    manual=decimal_pair('FIRE','A'); ck(manual['c0_mrub']==D('336') and manual['cash_mrub_per_year']==D('83.75'),'manual FIRE A')
    fast=enumerate_population(snapshot,'fast'); ck(len(fast)==5670,'fast count'); maxerr=0
    index=0
    for ids in itertools.combinations(sorted(raw_lots),4):
        for modes in itertools.product(sorted(raw_modes),repeat=4):
            keys=list(zip(ids,modes)); expected,decrows=independent_metrics(keys)
            detail,metrics=CORE.evaluate_portfolio(keys,LOTS,MODES,CFG)
            row=fast[index]; selection=[{'lot_id':l,'mode_id':m} for l,m in keys]
            ck(row['selection']==selection,'enumeration identity/order')
            ck(set(row['metrics'])==set(metrics)|{'anchor_cash_mrub_per_year','commercial_cash_mrub_per_year'},'ALL metric coverage')
            for key,value in metrics.items():
                ck(row['metrics'][key]==value,f'exact fast/original {index}/{key}')
                if isinstance(value,(int,float)):
                    near(value,expected[key],f'Decimal {index}/{key}'); maxerr=max(maxerr,abs(float(value)-float(expected[key])))
                else: ck(value==expected[key],f'categorical {key}')
            for field,coef in [('anchor_cash_mrub_per_year','k_anchor'),('commercial_cash_mrub_per_year','k_commercial')]:
                # Direct core does not expose these components: independent CSV oracle.
                near(row['metrics'][field],expected[field],field)
                metrics[field]=float(pd.Series([float(raw_lots[l][field])*float(raw_modes[m][coef]) for l,m in keys]).sum())
            scenarios={}
            for sc in ['BASE','STRESS']:
                orig={str(t.constraint):bool(t.ok) for t in CORE.check_constraints(metrics,CFG,sc).itertuples(index=False)}
                ck(len(orig)==9,'9 checks'); dec=independent_checks(expected,sc)
                for key in orig: ck(row['scenarios'][sc]['checks'][key]==orig[key]==dec[key],f'18 statuses {index}/{sc}/{key}')
                ok=all(orig.values()); cap=1300 if sc=='BASE' else 1180
                scenarios[sc]={'ok':ok,'status':'PASS' if ok else 'FAIL','checks':orig,'c0_limit':float(cap),'c0_margin':cap-metrics['c0_mrub']}
                ck(row['scenarios'][sc]==scenarios[sc],'scenario record')
            oracle={'portfolio_id':'|'.join(f'{l}:{m}' for l,m in keys),'selection':selection,'metrics':metrics,'scenarios':scenarios,'public_core_ids':[l for l,m in keys if raw_modes[m]['public_core']=='true'],'net_operating_balance':metrics['cash_mrub_per_year']-metrics['opex_mrub_per_year'],'portfolio_funding_gap':max(metrics['opex_mrub_per_year']-metrics['cash_mrub_per_year'],0),'sum_lot_funding_gaps':sum(max(float(x.opex_mrub_per_year)-float(x.cash_mrub_per_year),0) for x in detail.itertuples(index=False))}
            ck(oracle==row,'full row original-based identity')
            near(oracle['sum_lot_funding_gaps'],sum(max(x['opex_mrub_per_year']-x['cash_mrub_per_year'],D(0)) for x in decrows),'independent lot gaps')
            ORACLE.append(oracle); index+=1
    ck(len({r['portfolio_id'] for r in ORACLE})==5670,'unique')
    counts={s:sum(r['scenarios'][s]['ok'] for r in ORACLE) for s in ['BASE','STRESS']}
    ck(counts=={'BASE':1031,'STRESS':143},'1031/143'); ck(counts['BASE']-counts['STRESS']==888,'888')
    ck(all(not r['scenarios']['STRESS']['ok'] or r['scenarios']['BASE']['ok'] for r in ORACLE),'subset')
    base=[r for r in ORACLE if r['scenarios']['BASE']['ok']]
    BOUNDS.update({k:{'min':min(r['metrics'][f] for r in base),'max':max(r['metrics'][f] for r in base)} for k,f in FIELDS.items()})
    pop=get_population(snapshot); ck(pop['reference']['bounds']==BOUNDS,'all bounds independent')
    sourceid=digest({'engine_version':'original-contributions-numpy-aggregate/1','source_hashes':snapshot.source_hashes,'lots':snapshot.lots.to_dict('records'),'modes':snapshot.modes.to_dict('records'),'config':snapshot.config})
    populationid=digest({'identity':sourceid,'members':base})
    ck(pop['reference']['source_identity']==sourceid and pop['reference']['population_id']==populationid,'R exact identity independently rebuilt')
    for sc in ['BASE','STRESS']:
        for reason in pop['summary']['scenarios'][sc]['exclusion_reasons']:
            ck(reason['count']==sum(not r['scenarios'][sc]['checks'][reason['id']] for r in ORACLE),'exclusion count')
    save('all-5670-original.json',ORACLE); save('pairs-24-decimal.json',pairs)
    save('canonical.json',{'counts':counts,'total':len(ORACLE),'base_only':888,'max_decimal_error':maxerr,'bounds':BOUNDS,'population_id':populationid,'summary':pop['summary']})

def compare_ranking(actual,expected,label):
    ck(len(actual)==len(expected),label+' length')
    for a,b in zip(actual,expected):
        ck(a['portfolio_id']==b['portfolio_id'] and a['rank']==b['rank'],label+' rank/identity')
        near(a['score'],b['score'],label+' score')
        for k in FIELDS: near(a['normalized'][k],b['normalized'][k],label+' z'); near(a['contributions'][k],b['contributions'][k],label+' contribution')

def ranking_checks():
    for label,w in [('M0',M0),('equal',{k:1.0 for k in FIELDS}),('vpub_only',{k:float(k=='vpub') for k in FIELDS}),('overflow',{k:1e308 for k in FIELDS})]:
        for sc in ['BASE','STRESS']:
            own=own_ranking(ORACLE,w,BOUNDS,sc)
            compare_ranking(rank(enumerate_cached,w,BOUNDS,sc),own,label+'/'+sc+'/all')
            res=search(request(w,sc)); compare_ranking(res['ranking'],own[:100],label+'/'+sc+'/search')
            ck(res['reference_population']['bounds']==BOUNDS and res['reference_population']['scenario']=='BASE','same BASE scale')
            if label in ['M0','equal','vpub_only']: UI_EXPECTED[label+'_'+sc]={'leader':own[0],'top10':own[:10],'weights':own_weights(w),'request':request(w,sc,limit=10)}
    for key in FIELDS:
        bounds={k:{'min':0.,'max':10.} for k in FIELDS}; m={v:2. for v in FIELDS.values()}
        z=normalize_metrics(m,bounds); near(z[key],.8 if key in {'c0','opex'} else .2,'direction '+key)
        bounds[key]={'min':2.,'max':2.}; ck(normalize_metrics(m,bounds)[key]==0.,'constant criterion '+key)
    bad=[{k:0. for k in FIELDS},*[{**M0,'vpub':x} for x in [-1.,float('nan'),float('inf'),-float('inf'),True,'0.3',None]],{k:v for k,v in M0.items() if k!='c0'},{**M0,'surprise':1.}]
    for w in bad:
        try: normalize_weights(w)
        except Exception: pass
        else: ck(False,'invalid weights accepted '+str(w))
    for w in [{k:1e308 for k in FIELDS},{k:5e-324 for k in FIELDS},{**M0,'vpub':0.}]:
        a=normalize_weights(w); near(sum(a.values()),1,'weight sum'); ck(all(math.isfinite(v) and v>=0 for v in a.values()),'finite applied')
    # Ties independent artificial fixtures: exact score, cost and lex, plus <EPS delta.
    proto=deepcopy(ORACLE[0]); proto['scenarios']['BASE']['ok']=True
    rows=[]
    for name,cost,value in [('Z',3.,.5),('B',2.,.5),('A',2.,.5),('Q',9.,.50000000001)]:
        r=deepcopy(proto); r['portfolio_id']=name; r['metrics']={f:0. for f in FIELDS.values()}; r['metrics'].update(c0_mrub=cost,vpub_mrub_per_year=value); rows.append(r)
    bounds={k:{'min':0.,'max':1.} for k in FIELDS}; w={k:float(k=='vpub') for k in FIELDS}
    ck([r['portfolio_id'] for r in rank(rows,w,bounds,'BASE')]==['Q','A','B','Z'],'strict unrounded ties, cost, lex')
    constant={k:{'min':0.,'max':0.} for k in FIELDS}; ck(all(r['score']==0 for r in rank(rows,M0,constant,'BASE')),'constant no redistribution')
    base=own_ranking(ORACLE,M0,BOUNDS,'BASE')[0]
    near(base['score'],sum(float(D(str(M0[k])))*(base['normalized'][k]) for k in FIELDS),'Decimal declared M0 weights score')
    save('ui-expected.json',UI_EXPECTED)

def sensitivity_checks():
    runs_saved=[]
    feasible=own_ranking(ORACLE,M0,BOUNDS,'BASE')[14]
    infeasible=next(r for r in ORACLE if not r['scenarios']['BASE']['ok'])
    baseonly=next(r for r in ORACLE if r['scenarios']['BASE']['ok'] and not r['scenarios']['STRESS']['ok'])
    for sc,base,w in [('BASE',None,M0),('STRESS',None,M0),('BASE',feasible,M0),('BASE',infeasible,M0),('STRESS',baseonly,M0),('BASE',None,{**M0,'vpub':0.,'c0':0.}),('BASE',None,{k:1e308 for k in FIELDS})]:
        result=sensitivity(request(w,sc,eval_input(base['selection']) if base else None))
        original=base or own_ranking(ORACLE,w,BOUNDS,sc)[0]; ck(result['original_choice']['portfolio_id']==original['portfolio_id'],'explicit baseline identity')
        ck(len(result['runs'])==4,'four real perturbations')
        norm=own_weights(w)
        for run,(key,factor) in zip(result['runs'],itertools.product(['vpub','c0'],[.8,1.2])):
            weights={k:v*factor if k==key else v for k,v in norm.items()}; expected=own_ranking(ORACLE,weights,BOUNDS,sc)
            compare_ranking([run['leader']],[expected[0]],'sensitivity leader')
            # Closed form independent of production's normalization implementation.
            den=1+(factor-1)*norm[key]
            for k in FIELDS: near(run['applied_weights'][k],norm[k]*(factor if k==key else 1)/den,'closed form weight')
            expected_original=next((r for r in expected if r['portfolio_id']==original['portfolio_id']),None)
            ck(run['original_choice_rank']==(expected_original['rank'] if expected_original else None),'actual original rank')
            if expected_original: near(run['original_choice_score'],expected_original['score'],'original score')
            else: ck(run['original_choice_score'] is None and run['original_choice_status']=='INFEASIBLE_NOT_RANKED','infeasible null')
            before={x['lot_id']:x['mode_id'] for x in original['selection']}; after={x['lot_id']:x['mode_id'] for x in expected[0]['selection']}
            changes={'added':sorted(after.keys()-before.keys()),'removed':sorted(before.keys()-after.keys()),'mode_changes':[{'lot_id':k,'from':before[k],'to':after[k]} for k in sorted(before.keys()&after.keys()) if before[k]!=after[k]],'unchanged':before==after}
            ck(run['selection_changes']==changes,'changes oracle'); ck(run['zero_weight_unchanged']==(norm[key]==0),'zero flag')
        eq=own_ranking(ORACLE,{k:1. for k in FIELDS},BOUNDS,sc); compare_ranking([result['equal_weight_profile']['leader']],[eq[0]],'equal rerank')
        runs_saved.append(result)
    save('sensitivity-cases.json',runs_saved)

def cache_checks():
    base=search(request()); same=search(request()); ck(base==same,'repeat deterministic')
    changed=request({k:v*2 for k,v in M0.items()}); doubled=search(changed)
    ck(doubled['weights']['original']==changed['weights'],'raw metadata preserved'); ck(doubled['input_fingerprint']!=base['input_fingerprint'],'raw identity')
    compare_ranking(doubled['ranking'],base['ranking'],'proportional')
    doubled['ranking'][0]['metrics']['c0_mrub']=-999; ck(search(changed)['ranking'][0]['metrics']['c0_mrub']>0,'search deep copy')
    pop=get_population(snapshot); pop['rows'][0]['metrics']['c0_mrub']=-999; ck(get_population(snapshot)['rows'][0]['metrics']['c0_mrub']>0,'population deep copy')
    changes=[]
    for field in ['lots','modes','config','source_hashes']:
        value=deepcopy(getattr(snapshot,field))
        if field=='lots': value.loc[0,'c0_mrub']+=1
        elif field=='modes': value.loc[0,'k_vpub']+=.001
        elif field=='config': value['scenarios']['STRESS']['c0_max_mrub']+=1
        else: value['fixture']='f'*64
        altered=replace(snapshot,**{field:value}); ap=get_population(altered)
        ck(ap['reference']['source_identity']!=base['reference_population']['source_identity'],'cache input '+field)
        ck(ap['reference']['population_id']!=base['reference_population']['population_id'],'cache R '+field)
        changes.append({'field':field,'id':ap['reference']['source_identity']})
    old=search_module.ENGINE_VERSION
    try:
        search_module.ENGINE_VERSION='tester-generated-engine-identity'; ck(search_module.snapshot_identity(snapshot)!=base['reference_population']['source_identity'],'calculator cache identity')
    finally: search_module.ENGINE_VERSION=old
    ids=[]
    for req in [request(),request(scenario='STRESS'),request(limit=1),request(baseline=eval_input(ORACLE[0]['selection'])),request({**M0,'vpub':.9})]: ids.append(search(req)['input_fingerprint'])
    ck(len(set(ids))==5,'scenario/limit/baseline/weights identity')
    # An isolated COPY of permitted sources is the only mutable source fixture.
    fixture=OUT/'source-fixture'
    for path in ['config/source_manifest.json',*SOURCE_PATHS]:
        dst=fixture/path; dst.parent.mkdir(parents=True,exist_ok=True); shutil.copyfile(ROOT/path,dst)
    repo=CaseRepository(fixture); search(request(),repo)
    target=fixture/'case_source/data/lots.csv'; preserved=target.read_bytes()
    for kind in ['corrupt','missing']:
        if kind=='corrupt': target.write_bytes(b'X'+preserved[1:])
        else: target.unlink()
        for func,value in [(search,request()),(sensitivity,request()),(recompute_decision,{'format_version':'kosmos-decision/1','request':request()})]:
            try: func(value,repo)
            except ServiceError as exc: ck(exc.code=='source_unavailable' and exc.status_code==503,'warm cache source readiness')
            else: ck(False,'warm cache bypassed missing source')
        target.write_bytes(preserved)
    ck(search(request(),repo)==base,'recovery identical')
    save('cache.json',{'mutated_snapshot_inputs':changes,'raw_metadata_isolated':True,'source_readiness_checked':'corrupt and missing after warm cache, all three services'})

class Server:
    def __init__(self,repository=None):
        self.sock=socket.socket(); self.sock.bind(('127.0.0.1',0)); self.port=self.sock.getsockname()[1]
        self.server=uvicorn.Server(uvicorn.Config(create_app(repository),host='127.0.0.1',port=self.port,log_level='warning'))
        self.thread=threading.Thread(target=self.server.run,kwargs={'sockets':[self.sock]},daemon=False)
    def __enter__(self):
        self.thread.start(); deadline=time.monotonic()+20
        while not self.server.started and time.monotonic()<deadline: time.sleep(.02)
        ck(self.server.started,'uvicorn started'); return 'http://127.0.0.1:'+str(self.port)
    def __exit__(self,*args):
        self.server.should_exit=True; self.thread.join(20); self.sock.close(); ck(not self.thread.is_alive(),'owned server stopped')
        RESULT.setdefault('servers',[]).append({'port':self.port,'thread_stopped':not self.thread.is_alive(),'should_exit':self.server.should_exit})

def command(label,cmd,cwd=ROOT,stdin=None):
    p=subprocess.Popen(cmd,cwd=cwd,stdin=subprocess.PIPE if stdin is not None else None,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    out,err=p.communicate(stdin,timeout=180)
    (OUT/(label+'.stdout')).write_bytes(out); (OUT/(label+'.stderr')).write_bytes(err)
    RESULT['commands'].append({'label':label,'command':[str(x) for x in cmd],'cwd':str(cwd),'pid':p.pid,'exit':p.returncode})
    return p.returncode,out,err

def api_cli():
    with Server() as url, httpx.Client(base_url=url,timeout=90) as client:
        def post(path,value,status=200,raw=None,headers=None):
            data=raw if raw is not None else binary(value)
            res=client.post(path,content=data,headers=headers or {'Content-Type':'application/json'})
            idx=len(RESULT['http']); (OUT/f'http-{idx:03}-request.bin').write_bytes(data); (OUT/f'http-{idx:03}-response.bin').write_bytes(res.content)
            RESULT['http'].append({'index':idx,'url':str(res.url),'status':res.status_code,'expected_status':status,'headers':dict(res.headers)})
            ck(res.status_code==status,f'{path} HTTP {res.status_code} expected {status}: {res.text[:300]}'); return res
        for sc in ['BASE','STRESS']:
            for w in [M0,{k:1. for k in FIELDS},{k:1e308 for k in FIELDS}]:
                req=request(w,sc); res=post('/api/search',req); ck(res.content==post('/api/search',req).content,'HTTP determinism')
                compare_ranking(res.json()['ranking'],own_ranking(ORACLE,w,BOUNDS,sc)[:100],'real HTTP independent rank')
                sr=post('/api/sensitivity',req); ck(sr.json()==sensitivity(req),'HTTP sensitivity path')
        active=json.loads((ROOT/'config/m3_decision.json').read_text()); dec=post('/api/decision/recompute',active)
        ck(dec.content==(ROOT/'results/m3_decision.json').read_bytes(),'saved result full bytes')
        cfg=post('/api/decision/export',active); ck(set(cfg.json())=={'format_version','request','expected_population_id'},'configuration only')
        ck(post('/api/decision/recompute',cfg.json()).content==dec.content,'import recomputation bytes')
        dr=dec.json(); strategies={a['strategy_id']:a for a in dr['alternatives']}; base=own_ranking(ORACLE,M0,BOUNDS,'BASE'); stress=own_ranking(ORACLE,M0,BOUNDS,'STRESS')
        expected={'weighted_mcda':base[0],'equal_weights':own_ranking(ORACLE,{k:1. for k in FIELDS},BOUNDS,'BASE')[0],'max_vpub':min(base,key=lambda r:(-r['metrics']['vpub_mrub_per_year'],r['metrics']['c0_mrub'],r['portfolio_id'])),'min_c0':min(base,key=lambda r:(r['metrics']['c0_mrub'],r['portfolio_id'])),'stress_action':stress[0]}
        for key,row in expected.items(): ck(strategies[key]['candidate']['portfolio_id']==row['portfolio_id'],'strategy '+key)
        ck(dr['recommendation']['action']=='RETAIN','M0 retain'); ck(dr['distinct_strategy_portfolios']==len({r['portfolio_id'] for r in expected.values()}),'distinct portfolios')
        revised=post('/api/decision/recompute',{'format_version':'kosmos-decision/1','request':request({k:float(k=='vpub') for k in FIELDS})}).json(); ck(revised['recommendation']['action']=='REVISE','max VPUB revise')
        near(revised['recommendation']['base']['metrics']['c0_mrub'],1297,'unchanged BASE cost'); near(revised['recommendation']['base']['scenarios']['STRESS']['c0_margin'],-117,'same cost stress')
        for field,value in [('method_version','bad'),('modes','D'),('scenario','OTHER'),('limit',0),('source_hashes',{})]:
            post('/api/search',{**request(),field:value},422)
        for value in [-1,True,'0.3',None]: post('/api/search',request({**M0,'vpub':value}),422)
        post('/api/search',request({k:0 for k in FIELDS}),422)
        for malformed in [b'{',b'{"a":1,"a":2}',b'{"a":NaN}',b'{"a":Infinity}',b'{"a":1e999}',b'"\\ud800"',b'\xff']:
            post('/api/search',None,400,raw=malformed)
        post('/api/search',None,415,raw=b'{}',headers={'Content-Type':'text/plain'})
        valid=binary(request()); post('/api/search',None,200,raw=valid+b' '*(65536-len(valid))); post('/api/search',None,413,raw=valid+b' '*(65537-len(valid)))
        for bad in [{**active,'expected_population_id':'0'*64},{**active,'results':{'PASS':True}},dr]: post('/api/decision/recompute',bad,413 if len(binary(bad))>65536 else 422)
        # M1 and M2 regression from fresh independent selections, no historical ZIP.
        selection=[{'lot_id':l,'mode_id':m} for l,m in [('FIRE','A'),('FLOOD','A'),('INFRA','B'),('ENV','A')]]
        m1=eval_input(selection); ev=post('/api/evaluate',m1)
        expected_sha='799f33cd453c101aea365dde8c0f8942e7d7f9fe8c9cafe58d00855ef09f5a22'
        ck(hashlib.sha256(ev.content).hexdigest()==expected_sha,'accepted M1 bytes')
        fail=eval_input([{'lot_id':l,'mode_id':m} for l,m in [('FIRE','C'),('FLOOD','C'),('INFRA','B'),('ENV','C')]])
        ws={'format_version':'kosmos-workspace/1','source_hashes':snapshot.source_hashes,'workspace':{'current':{'name':'Tester','request':m1},'alternatives':[{'alternative_id':'a','name':'BASE','request':m1},{'alternative_id':'b','name':'FAIL','request':fail}],'scenario':'STRESS'}}
        post('/api/workspace/recompute',ws); exported=post('/api/export',ws); post('/api/workspace/recompute',exported.json())
        for inp in [{**m1,'selection':selection+[selection[0]]},{**m1,'selection':[selection[0]]*4}]: post('/api/evaluate',inp,422)
        for p in ['/api/unknown','/reports/M3_CODER.md','/case_source/case_core.py','/config/m3_decision.json']:
            ck(client.get(p).status_code==404,'private path '+p)
        for label,flag,input_value,expected_bytes in [('decision','--decision',active,dec.content),('search','--search',request(),post('/api/search',request()).content),('sensitivity','--sensitivity',request(),post('/api/sensitivity',request()).content),('m1','',m1,ev.content)]:
            inp=OUT/(label+'-input.json'); inp.write_bytes(binary(input_value))
            cmd=[sys.executable,'-X','utf8','-B',str(ROOT/'scripts/reproduce.py'),str(inp)]+([flag] if flag else [])
            for n in [1,2]:
                code,out,err=command('cli-'+label+str(n),cmd,cwd=OUT); ck(code==0 and not err,'CLI exit '+label); ck(out==expected_bytes,'CLI/API byte identity '+label)
        code,_,_=command('cli-new-output',[sys.executable,'-X','utf8','-B',str(ROOT/'scripts/reproduce.py'),str(OUT/'decision-input.json'),'--decision','--output',str(OUT/'new-output.json')],cwd=OUT); ck(code==0,'CLI new output')
        code,_,_=command('cli-existing-output',[sys.executable,'-X','utf8','-B',str(ROOT/'scripts/reproduce.py'),str(OUT/'decision-input.json'),'--decision','--output',str(OUT/'new-output.json')],cwd=OUT); ck(code==3,'CLI refuses existing')

group('canonical-full-5670-direct-original-and-Decimal',canonical)
enumerate_cached=enumerate_population(snapshot)
group('MCDA-all-ranks-directions-weights-constant-strict-ties',ranking_checks)
group('real-sensitivity-four-reranks-explicit-infeasible-zero',sensitivity_checks)
group('cache-invalidation-raw-isolation-warm-source-readiness',cache_checks)
group('real-HTTP-API-CLI-reproduction-and-M1-M2-regression',api_cli)
RESULT['runtime']={'python':sys.version,'packages':{k:importlib.metadata.version(k) for k in ['pandas','numpy','fastapi','uvicorn','pydantic','httpx']}}
RESULT['status']='FAIL' if any(g['status']=='FAIL' for g in RESULT['groups']) else 'PASS'
save('results.json',RESULT)
print(json.dumps({'status':RESULT['status'],'assertions':RESULT['assertions'],'groups':[(g['name'],g['status']) for g in RESULT['groups']]}),flush=True)
raise SystemExit(0 if RESULT['status']=='PASS' else 1)
