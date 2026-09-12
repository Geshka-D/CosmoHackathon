// Generated independent M3 tester. Uses existing installed real Chrome/Playwright.
// node tests/m3_browser.mjs <url> <independent-python-output> <NEW-output-directory>
import { chromium, expect } from '../frontend/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
const [URL, ORACLE_DIR, OUT_ARG] = process.argv.slice(2);
const OUT=path.resolve(OUT_ARG); await fs.mkdir(OUT,{recursive:false});
const rows=JSON.parse(await fs.readFile(path.join(ORACLE_DIR,'all-5670-original.json'),'utf8'));
const canonical=JSON.parse(await fs.readFile(path.join(ORACLE_DIR,'canonical.json'),'utf8'));
const fields={vpub:'vpub_mrub_per_year',c0:'c0_mrub',opex:'opex_mrub_per_year',kcash:'kcash',t_rep:'t_rep',readiness:'readiness_1_5',resilience:'resilience_1_5',scale:'scale_1_5'};
const M0={vpub:.3,c0:.15,opex:.1,kcash:.1,t_rep:.05,readiness:.1,resilience:.15,scale:.05};
function oracle(w,scenario='BASE') {
  const total=Object.values(w).reduce((a,b)=>a+b,0);
  return rows.filter(r=>r.scenarios[scenario].ok).map(r=>({...r,score:Object.entries(fields).reduce((s,[key,field])=>{const b=canonical.bounds[key];return s+w[key]/total*(b.max===b.min?0:(['c0','opex'].includes(key)?b.max-r.metrics[field]:r.metrics[field]-b.min)/(b.max-b.min));},0)})).sort((a,b)=>b.score-a.score||a.metrics.c0_mrub-b.metrics.c0_mrub||(a.portfolio_id<b.portfolio_id?-1:a.portfolio_id>b.portfolio_id?1:0));
}
const result={url:URL,groups:[],network:[],console:[],pageerrors:[],failedRequests:[],races:[],processes:[],screenshots:[],pid:process.pid};
const pending=[]; let active='startup';
const save=(n,v)=>fs.writeFile(path.join(OUT,n),JSON.stringify(v,null,2),'utf8');
const check=(v,m)=>{if(!v)throw Error(m)};
const near=(a,b,m)=>check(Math.abs(Number(a)-Number(b))<1e-9,`${m}: ${a} != ${b}`);
const browserServer=await chromium.launchServer({channel:'chrome',headless:true});
const bp=browserServer.process(); result.processes.push({pid:bp.pid,kind:'chrome-server'});
const browser=await chromium.connect(browserServer.wsEndpoint()); result.browser=browser.version(); result.node=process.version;
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage(); page.setDefaultTimeout(25000);
page.on('console',m=>result.console.push({group:active,type:m.type(),text:m.text()}));
page.on('pageerror',e=>result.pageerrors.push({group:active,error:String(e)}));
page.on('requestfailed',r=>result.failedRequests.push({group:active,url:r.url(),error:r.failure()}));
page.on('response',r=>{const row={group:active,url:r.url(),status:r.status(),request:r.request().postData(),time:Date.now()};result.network.push(row);if(r.url().includes('/api/'))pending.push((async()=>{try{row.body=await r.json()}catch(e){row.readError=String(e)}})());});
const panel=()=>page.getByRole('region',{name:'Поиск и выбор',exact:true});
const ranking=()=>page.getByRole('region',{name:'Лидеры поиска',exact:true}).locator('tbody tr');
const metric=(k='c0_mrub')=>page.getByTestId('metric-'+k).locator('strong');
async function shot(name){const p=path.join(OUT,name+'.png');await page.screenshot({path:p,fullPage:true});await fs.writeFile(path.join(OUT,name+'.txt'),await page.locator('body').innerText());result.screenshots.push(p)}
async function group(name,fn){active=name;const start=Date.now();try{await fn();result.groups.push({name,status:'PASS',ms:Date.now()-start});console.log('PASS',name)}catch(e){result.groups.push({name,status:'FAIL',error:String(e),stack:e.stack});console.log('FAIL',name,e.stack);await shot('failure-'+result.groups.length).catch(()=>{})}await save('browser.json',result)}
async function ready(w=M0,scenario='BASE') {
  const expected=oracle(w,scenario);await expect(ranking().first()).toHaveAttribute('data-portfolio-id',expected[0].portfolio_id,{timeout:90000});
  await expect(panel().getByRole('heading',{name:'Лидеры '+scenario,exact:true})).toBeVisible();
  const actual=await ranking().evaluateAll(es=>es.map(e=>({id:e.dataset.portfolioId,score:e.dataset.score,text:e.innerText})));
  for(let i=0;i<actual.length;i++){check(actual[i].id===expected[i].portfolio_id,'independent top10 '+i);near(actual[i].score,expected[i].score,'independent score '+i)}
  return expected;
}
async function m0(){await panel().getByRole('button',{name:'Веса M0',exact:true}).click();await panel().getByLabel('Сценарий поиска',{exact:true}).selectOption('BASE');await ready()}
async function setWeights(w){for(const [key,value] of Object.entries(w))await page.getByLabel('Вес '+key,{exact:true}).fill(String(value));await ready(w)}
async function manualMetric(n){await expect(metric()).toHaveAttribute('title',String(n))}
async function importDecision(value){await page.getByLabel('Файл JSON выбора',{exact:true}).setInputFiles({name:'tester.json',mimeType:'application/json',buffer:Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value))})}
async function sensitivityVisible(w=M0,sc='BASE'){
  const base=oracle(w,sc)[0]; const total=Object.values(w).reduce((a,b)=>a+b,0);
  for(const key of ['vpub','c0']) for(const factor of [.8,1.2]){
    const modified={...w,[key]:w[key]*factor};const expected=oracle(modified,sc);const row=page.locator(`[data-sensitivity="${key}-${factor}"]`);
    await expect(row).toContainText(expected[0].selection.map(x=>x.lot_id+' '+x.mode_id).join(' · '));
    const rank=expected.findIndex(r=>r.portfolio_id===base.portfolio_id)+1;
    await expect(row.locator('td').nth(1)).toContainText(String(rank));
    if(w[key]===0)await expect(row).toContainText('Нулевой вес остаётся нулевым');
  }
}
let savedConfig;
try {
await group('cold-catalog-M0-all-eight-metrics-and-four-real-sensitivity',async()=>{
  await page.goto(URL);await expect(page.locator('#catalog tbody').first().locator('tr')).toHaveCount(8);await expect(page.locator('.slot')).toHaveCount(4);
  await expect(metric()).toHaveText('—');await expect(page.locator('.check-label.not_evaluated')).toHaveCount(9);
  const exp=await ready();await expect(page.getByTestId('search-summary')).toContainText('5670');await expect(page.getByTestId('search-summary')).toContainText('1031');await expect(page.getByTestId('search-summary')).toContainText('143');
  await sensitivityVisible();
  const latest=result.network.filter(r=>r.url.endsWith('/api/decision/recompute')&&r.body).at(-1);check(latest,'real decision response');
  for(const [k,f] of Object.entries(fields))near(latest.body.search.ranking[0].metrics[f],exp[0].metrics[f],'eight raw metric '+k);
  await shot('01-cold-M0');
});
await group('weight-scenario-edit-normalization-fixed-scale-independent-leader',async()=>{
  const w={...M0,vpub:.9};await page.getByLabel('Вес vpub',{exact:true}).fill('.9');await ready(w);
  await panel().getByText('Веса, фиксированная шкала и происхождение',{exact:true}).click();
  near(await page.getByTestId('applied-vpub').getAttribute('data-value'),.9/1.6,'raw normalized');
  await expect(panel()).toContainText(canonical.population_id);
  await page.getByLabel('Сценарий поиска',{exact:true}).selectOption('STRESS');await ready(w,'STRESS');await expect(panel()).toContainText(canonical.population_id);
  await panel().getByRole('button',{name:'Равные веса',exact:true}).click();const equal=Object.fromEntries(Object.keys(M0).map(k=>[k,.125]));await ready(equal,'STRESS');await sensitivityVisible(equal,'STRESS');
  await shot('02-stress-equal-fixed-scale');
});
await group('decision-download-reload-import-atomic-invalid-and-zero-weight',async()=>{
  await m0();const promise=page.waitForEvent('download');await panel().getByRole('button',{name:'Скачать JSON выбора',exact:true}).click();const d=await promise;await d.saveAs(path.join(OUT,'download-decision.json'));savedConfig=JSON.parse(await fs.readFile(path.join(OUT,'download-decision.json'),'utf8'));
  check(Object.keys(savedConfig).sort().join(',')==='expected_population_id,format_version,request','configuration only');check(savedConfig.expected_population_id===canonical.population_id,'export R');
  const n=result.network.length;await page.reload();await ready();check(result.network.slice(n).some(r=>r.url.endsWith('/api/decision/recompute')),'reload actual recompute');
  await page.getByLabel('Вес vpub',{exact:true}).fill('.9');await ready({...M0,vpub:.9});await importDecision(savedConfig);await ready();await expect(page.getByLabel('Вес vpub',{exact:true})).toHaveValue('0.3');
  for(const invalid of [Buffer.from('{'),{...savedConfig,request:{...savedConfig.request,method_version:'bad'}},{...savedConfig,expected_population_id:'0'.repeat(64)},{...savedConfig,computed:{PASS:true}}]){
    const before=await page.evaluate(()=>localStorage.getItem('kosmos.decision.v1'));
    await importDecision(invalid);await expect(panel().getByRole('alert')).toContainText('настройки не изменены');await expect(ranking()).toHaveCount(0);
    check(await page.evaluate(()=>localStorage.getItem('kosmos.decision.v1'))===before,'invalid import atomic storage');await expect(page.getByLabel('Вес vpub',{exact:true})).toHaveValue('0.3');await panel().getByRole('button',{name:'Повторить поиск',exact:true}).click();await ready();
  }
  const w={...M0,vpub:0,c0:0};await setWeights(w);await sensitivityVisible(w);
  for(const key of Object.keys(w))await page.getByLabel('Вес '+key,{exact:true}).fill('0');await expect(panel().getByRole('alert')).toContainText('больше нуля');await expect(ranking()).toHaveCount(0);await m0();await shot('03-restored-import');
});
await group('real-strategy-selection-M2-manual-comparison-economic-FAIL',async()=>{
  await m0();await page.locator('[data-strategy="max_vpub"]').getByRole('button',{name:'Открыть стратегию'}).click();await manualMetric(1297);
  await expect(page.locator('.check-label.pass')).toHaveCount(9);await page.getByRole('button',{name:/^STRESS/}).click();await manualMetric(1297);await expect(page.getByTestId('check-c0_limit')).toContainText('Нарушение: 117');
  await page.getByLabel('Название текущего варианта').fill('Общественная ценность');await page.getByRole('button',{name:'Добавить в сравнение',exact:true}).click();
  await page.locator('[data-strategy="min_c0"]').getByRole('button',{name:'Открыть стратегию'}).click();await manualMetric(1123.5);await page.getByLabel('Название текущего варианта').fill('Затраты');await page.getByRole('button',{name:'Добавить в сравнение',exact:true}).click();
  await expect(page.locator('.alternative-actions article')).toHaveCount(2);await expect(page.getByRole('region',{name:'Сравнение альтернатив',exact:true})).toContainText('Δ -173,5');
  await page.getByRole('button',{name:'Открыть «Общественная ценность»',exact:true}).click();await manualMetric(1297);
  for(const [i,lot] of (await page.locator('.slot select[aria-label^="Лот"]').evaluateAll(es=>es.map(e=>e.value))).entries()) if(['FIRE','FLOOD','ENV'].includes(lot)) await page.getByLabel('Режим '+(i+1),{exact:true}).selectOption('C');
  await manualMetric(1231.2);await expect(page.getByTestId('check-public_core_lots')).toContainText('Нарушение: 2');await page.getByLabel('Название текущего варианта').fill('Экономически недопустимый');await page.getByRole('button',{name:'Добавить в сравнение',exact:true}).click();await expect(page.locator('.alternative-actions article')).toHaveCount(3);
  const dp=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать JSON',exact:true}).click();await (await dp).saveAs(path.join(OUT,'download-workspace.json'));
  await page.reload();await manualMetric(1231.2);await expect(page.locator('.alternative-actions article')).toHaveCount(3);
  await page.getByRole('button',{name:'Сбросить всё',exact:true}).click();await expect(metric()).toHaveText('—');await page.getByRole('button',{name:'Отменить изменение',exact:true}).click();await manualMetric(1231.2);
  await page.getByLabel('Файл JSON для импорта',{exact:true}).setInputFiles(path.join(OUT,'download-workspace.json'));await manualMetric(1231.2);await expect(page.locator('.alternative-actions article')).toHaveCount(3);
  await shot('04-M2-three-alternatives-economic-fail');
});
await group('explicit-infeasible-baseline-snapshot-and-return-to-leader',async()=>{
  await m0();await panel().getByRole('button',{name:'Использовать ручной состав для sensitivity',exact:true}).click();await ready();await expect(page.getByTestId('sensitivity-baseline')).toContainText('Явно сохранённый ручной состав');
  await expect(page.locator('[data-sensitivity]')).toHaveCount(4);for(const row of await page.locator('[data-sensitivity]').all())await expect(row).toContainText('Не ранжируется');
  const text=await page.getByTestId('sensitivity-baseline').innerText();await ranking().first().getByRole('button',{name:'В конструктор'}).click();await manualMetric(1150.8);check(await page.getByTestId('sensitivity-baseline').innerText()===text,'baseline frozen despite manual edit');
  await shot('05-explicit-infeasible-baseline');await panel().getByRole('button',{name:'Использовать лидера для sensitivity',exact:true}).click();await ready();await sensitivityVisible();
});
await group('late-real-response-weight-scenario-import-baseline-revision',async()=>{
  await m0();let gateResolve,capturedResolve;let armed=true;
  const gate=new Promise(r=>gateResolve=r);const captured=new Promise(r=>capturedResolve=r);
  const handler=async route=>{const req=route.request().postDataJSON();if(armed&&req.request.weights.vpub===.9){armed=false;const response=await route.fetch();const body=await response.json();result.races.push({kind:'weight-scenario-import-baseline',capturedRequest:req,actualResponse:body});capturedResolve();await gate;try{await route.fulfill({response})}catch(e){result.races.at(-1).fulfillError=String(e)}}else await route.continue()};
  await page.route('**/api/decision/recompute',handler);
  try {
    await page.getByLabel('Вес vpub',{exact:true}).fill('.9');await Promise.race([captured,new Promise((_,rej)=>setTimeout(()=>rej(Error('capture timeout')),30000))]);
    await page.getByLabel('Сценарий поиска',{exact:true}).selectOption('STRESS');await ready({...M0,vpub:.9},'STRESS');
    await importDecision(savedConfig);await ready();await panel().getByRole('button',{name:'Использовать ручной состав для sensitivity',exact:true}).click();await ready();
    gateResolve();await page.waitForTimeout(700);await ready();await expect(page.getByLabel('Вес vpub',{exact:true})).toHaveValue('0.3');await expect(page.getByLabel('Сценарий поиска',{exact:true})).toHaveValue('BASE');await expect(page.getByTestId('sensitivity-baseline')).toContainText('Явно сохранённый ручной состав');
    result.races.at(-1).newestRetained=true;
  } finally {gateResolve();await page.unroute('**/api/decision/recompute',handler)}
  await shot('06-revision-late-response');
});
await group('M2-keyboard-partial-network-error-recovery-and-hash-reload',async()=>{
  await page.getByRole('button',{name:'Сбросить всё',exact:true}).click();await expect(metric()).toHaveText('—');await page.getByLabel('Лот 1',{exact:true}).focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await page.keyboard.press('Escape');await page.keyboard.press('Tab');await expect(page.getByLabel('Режим 1',{exact:true})).toBeFocused();
  await expect(page.locator('.check-label.not_evaluated')).toHaveCount(9);check(await page.getByLabel('Лот 2',{exact:true}).locator('option[value="FIRE"]').evaluate(e=>e.disabled),'duplicate disabled');
  await page.getByLabel('Режим 1',{exact:true}).selectOption('B');await manualMetric(320);
  let aborted=false;const h=async route=>{if(!aborted){aborted=true;await route.abort()}else await route.continue()};await page.route('**/api/workspace/recompute',h);
  await page.getByLabel('Режим 1',{exact:true}).selectOption('C');await expect(page.getByRole('alert').filter({hasText:'Расчёт не подтверждён'})).toBeVisible();await expect(page.locator('.result-heading')).toHaveCount(0);await page.unroute('**/api/workspace/recompute',h);
  await page.getByRole('button',{name:'Пересчитать текущие настройки',exact:true}).click();await manualMetric(313.6);
  await page.getByRole('link',{name:'Поиск и выбор',exact:true}).click();check(new globalThis.URL(page.url()).hash==='#decision','decision hash');await page.reload();await ready();check(new globalThis.URL(page.url()).hash==='#decision','hash reload');
  await shot('07-network-recovered');
});
await group('narrow-real-layout-console-network-and-process-inventory',async()=>{
  await page.setViewportSize({width:390,height:844});await page.goto(URL+'/#decision');await ready();check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'narrow document overflow');await shot('08-narrow');
  check(result.pageerrors.length===0,'no unhandled page errors');check(result.network.every(r=>new globalThis.URL(r.url).hostname==='127.0.0.1'),'loopback network only');
  const cdp=await browser.newBrowserCDPSession();const info=await cdp.send('SystemInfo.getProcessInfo');result.processes.push(...info.processInfo.map(p=>({pid:p.id,kind:p.type})));await cdp.detach();
});
} finally {
  await Promise.allSettled(pending);await context.close();await browser.close();await browserServer.close();
  result.shutdown={contextClosed:true,browserClosed:true,browserServerClosed:true,chromeExit:bp.exitCode};
  result.status=result.groups.some(x=>x.status==='FAIL')?'FAIL':'PASS';await save('browser.json',result);console.log(result.status);
}
process.exitCode=result.status==='PASS'?0:1;
