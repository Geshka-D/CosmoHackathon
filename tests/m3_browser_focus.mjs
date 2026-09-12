// Generated M3 follow-up: fixture source readiness + storage/revision + legible screenshots.
import { chromium, expect } from '../frontend/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs/promises';import path from 'node:path';
const [url,oracleDir,outArg,fixture]=process.argv.slice(2);const out=path.resolve(outArg);await fs.mkdir(out);
const fixturePath=path.resolve(fixture);if(!fixturePath.includes(path.join('reports','evidence','m3_tester')))throw Error('fixture must stay within own evidence');
const config=JSON.parse(await fs.readFile(path.join(oracleDir,'decision-input.json'),'utf8'));
const file=path.join(fixturePath,'case_source/data/lots.csv');const preserved=await fs.readFile(file);
const expected=JSON.parse(await fs.readFile(path.join(oracleDir,'ui-expected.json'),'utf8'));
const result={groups:[],network:[],pageerrors:[],console:[],screenshots:[],races:[],pid:process.pid,processes:[]};let active='start';const pending=[];
const bs=await chromium.launchServer({channel:'chrome',headless:true});const browser=await chromium.connect(bs.wsEndpoint());result.browser=browser.version();result.processes.push({pid:bs.process().pid,kind:'chrome-server'});
const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();page.setDefaultTimeout(30000);
page.on('pageerror',e=>result.pageerrors.push(String(e)));page.on('console',m=>result.console.push({group:active,type:m.type(),text:m.text()}));
page.on('response',r=>{const v={group:active,url:r.url(),status:r.status(),request:r.request().postData()};result.network.push(v);if(r.url().includes('/api/'))pending.push((async()=>{try{v.response=await r.json()}catch(e){v.readError=String(e)}})())});
const save=()=>fs.writeFile(path.join(out,'browser.json'),JSON.stringify(result,null,2));const check=(v,m)=>{if(!v)throw Error(m)};
async function shot(name,locator){const p=path.join(out,name+'.png');if(locator)await locator.screenshot({path:p});else await page.screenshot({path:p,fullPage:false});result.screenshots.push(p)}
const panel=page.getByRole('region',{name:'Поиск и выбор',exact:true});
async function ready(){await expect(page.getByRole('region',{name:'Лидеры поиска'}).locator('tbody tr').first()).toHaveAttribute('data-portfolio-id',expected.M0_BASE.leader.portfolio_id,{timeout:90000})}
async function group(name,fn){active=name;try{await fn();result.groups.push({name,status:'PASS'});console.log('PASS',name)}catch(e){result.groups.push({name,status:'FAIL',error:String(e),stack:e.stack});console.log('FAIL',name,e.stack);await shot('failure-'+result.groups.length).catch(()=>{})}await save()}
try{
await group('large-readable-M3-evidence-and-invalid-stored-input',async()=>{
  await page.goto(url);await ready();
  await page.locator('#decision').scrollIntoViewIfNeeded();await shot('09-weight-controls-viewport');
  await shot('10-leaders-table',page.getByRole('region',{name:'Лидеры поиска'}));
  await shot('11-strategy-M0',page.locator('[data-strategy="weighted_mcda"]'));
  await shot('12-sensitivity-table',page.getByRole('region',{name:'Четыре пересчёта чувствительности'}));
  const corrupt='{"bad":';await page.evaluate(v=>localStorage.setItem('kosmos.decision.v1',v),corrupt);await page.reload();await ready();
  await expect(panel).toContainText('Сохранённый поиск не восстановлен');check(await page.evaluate(()=>localStorage.getItem('kosmos.decision.v1'))===corrupt,'corrupt storage preserved');
  const promise=page.waitForEvent('download');await panel.getByRole('button',{name:'Скачать прежний поиск'}).click();await (await promise).saveAs(path.join(out,'corrupt-backup.json'));check(await fs.readFile(path.join(out,'corrupt-backup.json'),'utf8')===corrupt,'corrupt download raw bytes');
  await panel.getByRole('button',{name:'Веса M0',exact:true}).click();await ready();await expect.poll(()=>page.evaluate(()=>localStorage.getItem('kosmos.decision.v1'))).not.toBe(corrupt);
});
await group('warm-source-corruption-actual-503-hidden-stale-result-and-recovery',async()=>{
  await fs.writeFile(file,Buffer.concat([Buffer.from('X'),preserved.subarray(1)]));
  await page.getByLabel('Вес vpub',{exact:true}).fill('.9');await expect(panel.getByRole('alert')).toContainText('Источники кейса');await expect(page.getByRole('region',{name:'Лидеры поиска'})).toHaveCount(0);await shot('13-source-unavailable-viewport');
  const health=await page.request.get(url+'/api/health');check(health.status()===503,'real health not ready');result.health={status:health.status(),body:await health.json()};
  await fs.writeFile(file,preserved);await panel.getByRole('button',{name:'Веса M0',exact:true}).click();await ready();
  await fs.writeFile(file,Buffer.concat([Buffer.from('X'),preserved.subarray(1)]));await page.reload();await expect(page.getByRole('alert')).toContainText('Источники кейса');await expect(page.getByRole('region',{name:'Лидеры поиска'})).toHaveCount(0);
  await fs.writeFile(file,preserved);await page.getByRole('button',{name:'Повторить загрузку',exact:true}).click();await ready();
  check(result.network.filter(r=>r.status===503).length>=2,'actual source HTTP errors recorded');
});
await group('late-actual-import-newer-import-wins-and-narrow-controls',async()=>{
  let resolveGate,resolveCaptured,armed=true;const gate=new Promise(r=>resolveGate=r);const captured=new Promise(r=>resolveCaptured=r);
  const handler=async route=>{const value=route.request().postDataJSON();if(armed&&value.request.weights.vpub===.9){armed=false;const response=await route.fetch();result.races.push({oldRequest:value,oldActualResponse:await response.json()});resolveCaptured();await gate;try{await route.fulfill({response})}catch(e){result.races.at(-1).delivery=String(e)}}else await route.continue()};
  await page.route('**/api/decision/recompute',handler);
  try{
    const altered=structuredClone(config);altered.request.weights.vpub=.9;
    await page.getByLabel('Файл JSON выбора',{exact:true}).setInputFiles({name:'old.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(altered))});await Promise.race([captured,new Promise((_,r)=>setTimeout(()=>r(Error('capture timeout')),30000))]);
    await page.getByLabel('Файл JSON выбора',{exact:true}).setInputFiles({name:'new.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(config))});await ready();resolveGate();await page.waitForTimeout(700);await ready();await expect(page.getByLabel('Вес vpub',{exact:true})).toHaveValue('0.3');result.races.at(-1).newestRetained=true;
  }finally{resolveGate();await page.unroute('**/api/decision/recompute',handler)}
  await page.setViewportSize({width:390,height:844});await page.locator('#decision').scrollIntoViewIfNeeded();await shot('14-narrow-controls-viewport');check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no narrow document overflow');
  await page.locator('[data-strategy="weighted_mcda"]').scrollIntoViewIfNeeded();await shot('15-narrow-strategy-viewport');
  const cdp=await browser.newBrowserCDPSession();const info=await cdp.send('SystemInfo.getProcessInfo');result.processes.push(...info.processInfo.map(p=>({pid:p.id,kind:p.type})));await cdp.detach();check(result.pageerrors.length===0,'no pageerrors');
});
} finally {
  await fs.writeFile(file,preserved);await Promise.allSettled(pending);await context.close();await browser.close();await bs.close();result.shutdown={contextClosed:true,browserClosed:true,browserServerClosed:true,chromeExit:bs.process().exitCode,fixtureRestored:true};result.status=result.groups.some(g=>g.status==='FAIL')?'FAIL':'PASS';await save();
}
process.exitCode=result.status==='PASS'?0:1;
