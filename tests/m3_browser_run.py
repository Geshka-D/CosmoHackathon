"""Generated owned-lifecycle launcher; writes only fresh Tester outputs."""
import argparse,json,pathlib,socket,subprocess,sys,threading,time,os
sys.dont_write_bytecode=True
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
import uvicorn
from backend.app.main import app, create_app
from backend.app.case_loader import CaseRepository
p=argparse.ArgumentParser();p.add_argument('--oracle',required=True);p.add_argument('--output',required=True);p.add_argument('--browser-script',default='tests/m6_browser.mjs');p.add_argument('--fixture');a=p.parse_args()
output=pathlib.Path(a.output).resolve();output.mkdir(parents=True,exist_ok=False)
s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1]
server=uvicorn.Server(uvicorn.Config(create_app(CaseRepository(pathlib.Path(a.fixture))) if a.fixture else app,host='127.0.0.1',port=port,log_level='info'))
t=threading.Thread(target=server.run,kwargs={'sockets':[s]},daemon=False);t.start()
metadata={'pid':os.getpid(),'port':port,'url':f'http://127.0.0.1:{port}'}
try:
    deadline=time.monotonic()+20
    while not server.started and time.monotonic()<deadline:time.sleep(.02)
    if not server.started:raise RuntimeError('server not ready')
    cmd=['node',str(ROOT/a.browser_script),metadata['url'],str(pathlib.Path(a.oracle).resolve()),str(output/'browser')]+([str(pathlib.Path(a.fixture).resolve())] if a.fixture else [])
    with (output/'browser.log').open('wb') as log:
        child=subprocess.Popen(cmd,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT);metadata['node_pid']=child.pid;metadata['command']=cmd
        code=child.wait(timeout=600);metadata['node_exit']=code
finally:
    server.should_exit=True;t.join(30);s.close();metadata['server_thread_stopped']=not t.is_alive()
    (output/'lifecycle.json').write_text(json.dumps(metadata,indent=2),encoding='utf-8')
    if t.is_alive():raise RuntimeError('owned server did not stop')
raise SystemExit(code)
