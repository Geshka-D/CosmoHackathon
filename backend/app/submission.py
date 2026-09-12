"""One deterministic M5 bundle and short, atomic local publication.

Only declared files enter a generation. No traversal of private history, reports,
ZIPs, or original archives. Readers capture and verify one generation's bytes.
"""
from __future__ import annotations

import base64
import csv
import hashlib
import importlib.metadata
import io
import json
import os
from pathlib import Path
import re
import shutil
import sys
from uuid import uuid4

from .case_loader import PROJECT_ROOT
from .contracts import canonical_json
from .management import build_management, finance_csv
from .submission_content import documents
from .submission_pdf import render_pdf

VERSION = 'kosmos-submission/1'
RENDERER = 'pdf-layout/1'
POINTER = 'results/m5_current.json'
STORE = 'results/m5'
INPUTS = ('config/m3_decision.json','config/management.json','config/assumptions.json','config/source_manifest.json')
FONTS = ('assets/fonts/DejaVuSans.ttf','assets/fonts/LICENSE-DejaVu.txt','assets/fonts/README.md')
PDFS = {'note.pdf':('note','Управленческая записка',False),
        'stress.pdf':('stress','Стресс-резюме',False),'slides.pdf':('slides','Презентация',True)}
DOWNLOADS = {'note.pdf':('Управленческая записка PDF','application/pdf'),
             'stress.pdf':('Стресс-резюме PDF','application/pdf'),
             'slides.pdf':('Презентация PDF','application/pdf'),
             'bundle.json':('Полный выпуск JSON','application/json'),
             'finance.csv':('Финансы выпуска CSV','text/csv'),
             'sensitivity.csv':('Чувствительность CSV','text/csv'),
             'content.json':('Редактируемые страницы JSON','application/json'),
             'content.md':('Редактируемый сценарий Markdown','text/markdown'),
             'protocols.md':('Полные протоколы реализации Markdown','text/markdown')}


def sha(data): return hashlib.sha256(data).hexdigest()


def _csv(rows):
    out=io.StringIO(newline='');writer=csv.writer(out,lineterminator='\n');writer.writerows(rows)
    return out.getvalue().encode('utf-8')


def sensitivity_csv(management,sid):
    keys=sorted(management['weights']['applied'])
    rows=[['submission_id','criterion','multiplier','leader','leader_score','original_choice_rank','original_choice_score',*keys]]
    for r in management['sensitivity']['runs']:
        rows.append([sid,r['criterion'],r['multiplier'],r['leader']['portfolio_id'],r['leader']['score'],r['original_choice_rank'],r['original_choice_score'],*[r['applied_weights'][k] for k in keys]])
    return _csv(rows)


def content_markdown(content, identity):
    parts=['# Материалы выпуска '+identity['submission_id'],
           'Редактируемое содержание; исходный генератор backend/app/submission_content.py. Числа пересчитываются при новой сборке.']
    for name in ('note','stress','slides'):
        pages=content[name]
        parts.append('# '+name)
        for index,page in enumerate(pages,1):
            parts.append('## '+str(index)+'. '+page['title'])
            for block in page['blocks']:
                if block['kind'] in ('p','h'):parts.append(('### ' if block['kind']=='h' else '')+block['text'])
                elif block['kind']=='table':
                    parts += ['| '+' | '.join(map(str,block['headers']))+' |','| '+' | '.join('---' for _ in block['headers'])+' |']
                    parts += ['| '+' | '.join(str(c).replace('|','/').replace('\n',' ') for c in row)+' |' for row in block['rows']]
                elif block['kind']=='bars':
                    parts += [block['caption'],*[str(label)+': '+str(v) for label,v in zip(block['labels'],block['values'])]]
                elif block['kind']=='link':parts.append('['+block['text']+']('+block['uri']+')')
    return ('\n\n'.join(parts)+'\n').encode('utf-8')


def protocols_markdown(management,sid):
    """Lossless editable operational appendix, separate from 12-page main text."""
    parts=['# Полные протоколы реализации / M5 '+sid,
           'Приложение к основной записке. Все организации, обязательства, сроки и KPI являются предложениями или неизвестными условиями.']
    def walk(value,depth=2):
        if isinstance(value,dict):
            for key,item in sorted(value.items()):
                parts.append('#'*min(depth,6)+' '+key);walk(item,depth+1)
        elif isinstance(value,list):
            for i,item in enumerate(value,1):
                if isinstance(item,(dict,list)):parts.append('#'*min(depth,6)+' '+str(i));walk(item,depth+1)
                else:parts.append('- '+str(item))
        else:parts.append('неизвестно' if value is None else str(value))
    walk({k:management[k] for k in ('services','configuration','assumptions')})
    return ('\n\n'.join(parts)+'\n').encode('utf-8')


def build_artifacts(root=PROJECT_ROOT):
    root=Path(root).resolve()
    # Use the existing canonical/M3/M4 pipeline, not a cached result as input.
    from .case_loader import CaseRepository
    management=build_management(CaseRepository(root),config_root=root)
    input_bytes={name:(root/name).read_bytes() for name in INPUTS}
    code_paths=sorted(['backend/__init__.py',*[p.relative_to(root).as_posix() for p in (root/'backend/app').glob('*.py')],
                       'scripts/build_submission.py','requirements.txt'])
    authored={name:(root/name).read_bytes() for name in [*code_paths,*FONTS]}
    identity={'schema_version':VERSION,'renderer_version':RENDERER,'analytical_release_id':management['release_id'],
              'input_fingerprint':management['identity']['result_fingerprint'],
              'decision_input_fingerprint':management['identity']['decision_input_fingerprint'],
              'source_hashes':management['identity']['source_hashes'],
              'source_set_sha256':sha(canonical_json(management['identity']['source_hashes'])),
              'input_hashes':{name:sha(data) for name,data in input_bytes.items()},
              'authoring_hashes':{name:sha(data) for name,data in authored.items()},
              'dependencies':{name:importlib.metadata.version(name) for name in ('reportlab','pypdf','pillow','charset-normalizer')}}
    sid=sha(canonical_json(identity));identity={'submission_id':sid,**identity}
    content=documents(management)
    # Legacy M4 layout is omitted; the accepted operational fields remain complete.
    analytic={k:v for k,v in management.items() if k not in ('materials','finance_csv')}
    bundle={'schema_version':VERSION,'submission_id':sid,'identity':identity,'management':analytic,'content':content}
    artifacts={'bundle.json':canonical_json(bundle),'identity.json':canonical_json(identity),
               'content.json':canonical_json(content),'content.md':content_markdown(content,identity),
               'protocols.md':protocols_markdown(analytic,sid)}
    finance_rows=list(csv.reader(io.StringIO(finance_csv(management))))
    artifacts['finance.csv']=_csv([['submission_id',*finance_rows[0]],*[[sid,*row] for row in finance_rows[1:]]])
    artifacts['sensitivity.csv']=sensitivity_csv(management,sid)
    layouts={}
    for filename,(kind,title,landscape) in PDFS.items():
        artifacts[filename],layouts[filename]=render_pdf(content[kind],identity,root/FONTS[0],title,landscape)
    artifacts['layout.json']=canonical_json(layouts)
    # Saved authored inputs and renderer sources make the document edits reviewable.
    for name,data in input_bytes.items():artifacts['inputs/'+Path(name).name]=data
    for name,data in authored.items():artifacts['source/'+name]=data
    artifacts['README.md']=(
        '# Выпуск M5\n\nТри PDF: note.pdf (12 страниц), stress.pdf (1), slides.pdf (12).\n\n'
        'bundle.json содержит заново вычисленные management/result/финансы/альтернативы/сценарии/чувствительность, условия и контент. '
        'content.json и content.md - редактируемые страницы; исходники генератора и шрифт с лицензией в source/. '
        'Inputs включают исходные decision/management/assumptions и manifest. Неизменные разрешённые S1-S6 остаются в case_source/ полного репозитория.\n\n'
        'Из корня полного репозитория: python -B scripts/build_submission.py --output-dir out/m5. '
        'Новая генерация пересчитывает результат; PDF не меняют смысл при ручном редактировании портфеля в UI. '
        'Самостоятельный output-dir не перезаписывает активный LIVE. Содержимое выпуска не заменяет полный программный комплект M7.\n\n'
        'Числа округлены только на страницах. Public value отдельно от CASH; дополнительные lot gaps не меняют canonical CASH. '
        'Это предложения, без заключённых договоров или достигнутых KPI. Публикации в сеть не было.\n').encode('utf-8')
    validate_artifacts(artifacts,sid)
    return identity,artifacts


def validate_artifacts(artifacts,sid):
    bundle=json.loads(artifacts['bundle.json']);identity=json.loads(artifacts['identity.json'])
    unsigned={k:v for k,v in identity.items() if k!='submission_id'}
    if sha(canonical_json(unsigned))!=sid or identity['submission_id']!=sid or bundle['submission_id']!=sid or bundle['identity']!=identity:
        raise ValueError('Submission identity mismatch')
    if artifacts['bundle.json']!=canonical_json(bundle) or artifacts['identity.json']!=canonical_json(identity):
        raise ValueError('Noncanonical submission JSON')
    m=bundle['management']
    if m['release_id']!=identity['analytical_release_id'] or sha(canonical_json(m['identity']))!=m['release_id']:
        raise ValueError('Analytical identity mismatch')
    if m['identity']['source_hashes']!=identity['source_hashes'] or m['identity']['result_fingerprint']!=identity['input_fingerprint']:
        raise ValueError('Submission source/fingerprint mismatch')
    if sha(canonical_json(identity['source_hashes']))!=identity['source_set_sha256']:
        raise ValueError('Source set mismatch')
    # Verify retained bytes against their saved editorial source. Re-rendering
    # with today's template would incorrectly reject a valid previous release
    # when a new template's publication fails. Do not execute stored code.
    expected_content=bundle['content']
    if set(expected_content)!={'note','stress','slides'} or not 8<=len(expected_content['note'])<=12 or len(expected_content['stress'])!=1 or not 1<=len(expected_content['slides'])<=12:
        raise ValueError('Invalid document page specifications')
    if bundle['content']!=expected_content or artifacts['content.json']!=canonical_json(expected_content) or artifacts['content.md']!=content_markdown(expected_content,identity):
        raise ValueError('Content differs from saved analytical bundle')
    if artifacts['protocols.md']!=protocols_markdown(m,sid):raise ValueError('Operational appendix mismatch')
    for name,digest in identity['input_hashes'].items():
        if sha(artifacts['inputs/'+Path(name).name])!=digest:raise ValueError('Input hash mismatch')
    for name,digest in identity['authoring_hashes'].items():
        if sha(artifacts['source/'+name])!=digest:raise ValueError('Authoring hash mismatch')
    rows=list(csv.reader(io.StringIO(artifacts['finance.csv'].decode('utf-8'))))
    expected=list(csv.reader(io.StringIO(finance_csv(m))))
    if rows!=[['submission_id',*expected[0]],*[[sid,*row] for row in expected[1:]]]:raise ValueError('Finance CSV mismatch')
    if artifacts['sensitivity.csv']!=sensitivity_csv(m,sid):raise ValueError('Sensitivity CSV mismatch')
    from pypdf import PdfReader
    for name,(kind,_,_) in PDFS.items():
        reader=PdfReader(io.BytesIO(artifacts[name]))
        if len(reader.pages)!=len(expected_content[kind]):raise ValueError('Wrong PDF count: '+name)
        if reader.attachments['identity.json']!=[canonical_json(identity)]:raise ValueError('PDF identity mismatch')
        if sid not in (reader.pages[0].extract_text() or ''):raise ValueError('PDF visible identity mismatch')
    return bundle


def _path(root,relative):
    path=root/relative
    if not path.resolve().is_relative_to(root.resolve()):raise ValueError('Submission path outside destination')
    return path


def read_generation(root,manifest):
    root=Path(root).resolve()
    if set(manifest)!={'schema_version','submission_id','publication_id','directory','files'} or manifest['schema_version']!=VERSION:
        raise ValueError('Invalid submission manifest')
    if not re.fullmatch(r'[0-9a-f]{64}',manifest['submission_id']) or not re.fullmatch(r'[0-9a-f]{64}',manifest['publication_id']):raise ValueError('Invalid submission ID')
    if not re.fullmatch(STORE+r'/[0-9a-f]{16}',manifest['directory']):raise ValueError('Invalid generation path')
    required={'bundle.json','identity.json','content.json','content.md','protocols.md','finance.csv','sensitivity.csv','layout.json','README.md',*PDFS}
    required.update('inputs/'+Path(x).name for x in INPUTS)
    names=set(manifest['files'])
    if not required<=names or any(not (name in required or name.startswith('source/backend/') or name in ['source/'+x for x in (*FONTS,'scripts/build_submission.py','requirements.txt')]) for name in names):
        raise ValueError('Unexpected/missing submission files')
    if sha(canonical_json(manifest['files']))!=manifest['publication_id']:raise ValueError('Publication content identity mismatch')
    data={}
    for name,info in manifest['files'].items():
        if '\\' in name or any(part in ('','..','.') for part in name.split('/')) or name.startswith('/'):
            raise ValueError('Invalid artifact path')
        payload=_path(root,manifest['directory']+'/'+name).read_bytes()
        if info!={'sha256':sha(payload),'size':len(payload)}:raise ValueError('Submission file hash/size mismatch: '+name)
        data[name]=payload
    validate_artifacts(data,manifest['submission_id'])
    return data


def read_current(destination=PROJECT_ROOT):
    root=Path(destination).resolve();manifest=json.loads(_path(root,POINTER).read_bytes())
    return manifest,read_generation(root,manifest)


def publish(destination=PROJECT_ROOT):
    identity,artifacts=build_artifacts()
    root=Path(destination).resolve();store=_path(root,STORE);store.mkdir(parents=True,exist_ok=True)
    # Ordinary mkdir inherits public product access. No private TemporaryDirectory.
    stage=store/('.s-'+uuid4().hex[:16]);final=store/uuid4().hex[:16]
    pointer=_path(root,POINTER);temp=pointer.with_name('.m5-'+uuid4().hex[:16]+'.tmp')
    files={name:{'sha256':sha(data),'size':len(data)} for name,data in sorted(artifacts.items())}
    manifest={'schema_version':VERSION,'submission_id':identity['submission_id'],'publication_id':sha(canonical_json(files)),
              'directory':final.relative_to(root).as_posix(),'files':files}
    owned=False
    try:
        stage.mkdir(exist_ok=False);owned=True
        for name,data in artifacts.items():
            path=_path(stage,name);path.parent.mkdir(parents=True,exist_ok=True)
            if path.write_bytes(data)!=len(data):raise OSError('Incomplete submission write: '+name)
        saved={name:(stage/name).read_bytes() for name in artifacts}
        if saved!=artifacts:raise OSError('Submission read-back mismatch')
        validate_artifacts(saved,identity['submission_id'])
        os.rename(stage,final);owned=False
        read_generation(root,manifest)  # actual final paths before activation
        payload=canonical_json(manifest)
        if temp.write_bytes(payload)!=len(payload) or temp.read_bytes()!=payload:raise OSError('Incomplete submission pointer')
        os.replace(temp,pointer)  # sole activation point
    finally:
        primary=sys.exception()
        try:temp.unlink(missing_ok=True)
        except OSError as e:
            if primary is None:raise
            primary.add_note('Temporary pointer cleanup failed: '+str(e))
        if owned:
            try:
                if not stage.resolve().is_relative_to(store.resolve()):raise ValueError('Unsafe cleanup target')
                shutil.rmtree(stage)
            except OSError as e:
                if primary is None:raise
                primary.add_note('Staging cleanup failed: '+str(e))
    return manifest


def downloads_for(management,destination=PROJECT_ROOT):
    """Capture bytes together with the displayed analytical bundle, no second GET."""
    if not (Path(destination)/POINTER).exists():
        return {'available':False,'reason':'PDF-выпуск ещё не собран. Выполните scripts/build_submission.py.'}
    manifest,artifacts=read_current(destination)
    bundle=json.loads(artifacts['bundle.json'])
    if bundle['identity']['analytical_release_id']!=management['release_id']:
        return {'available':False,'reason':'PDF относятся к другой сохранённой конфигурации. Пересоберите выпуск scripts/build_submission.py.'}
    return {'available':True,'submission_id':manifest['submission_id'],'publication_id':manifest['publication_id'],
            'files':{name:{'label':label,'mime':mime,'sha256':sha(artifacts[name]),'base64':base64.b64encode(artifacts[name]).decode('ascii')}
                     for name,(label,mime) in DOWNLOADS.items()}}
