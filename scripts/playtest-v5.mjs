import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)(process.env.HAVEN_PLAYWRIGHT_PATH||'playwright');
const out=resolve(import.meta.dirname,'..',process.env.HAVEN_TEST_OUT||'playtest/v05');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.HAVEN_CHROME_PATH?{executablePath:process.env.HAVEN_CHROME_PATH}:{})});
const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1});page.setDefaultTimeout(12000);
const errors=[],failedRequests=[],checks=[];page.on('pageerror',error=>errors.push(String(error)));page.on('requestfailed',request=>failedRequests.push(request.url()));
const state=()=>page.evaluate(()=>window.__HAVEN__.getState());
const ops=()=>page.evaluate(()=>window.__HAVEN__.getPrisonOperations());
const view=()=>page.evaluate(()=>window.__HAVEN__.getView());
const render=()=>page.evaluate(()=>window.__HAVEN__.getRenderDiagnostics());
const snap=name=>page.screenshot({path:resolve(out,`${name}.png`)});
const check=(name,value,detail)=>{assert.ok(value,`${name}: ${JSON.stringify(detail)}`);checks.push({name,passed:true,detail});console.log('PASS',name);};
const pause=()=>page.getByRole('button',{name:'暂停',exact:true}).click();
const close=()=>page.locator('#drawer [data-ui="close-drawer"]').click();
const section=async name=>{const el=page.locator(`[data-prison-section="${name}"]`);if(!await el.evaluate(el=>el.open))await el.locator('summary').click();};
const project=(gx,gz)=>page.evaluate(({gx,gz})=>window.__HAVEN__.getScreenPosition((gx-11.5)*10,(gz-11.5)*10,0),{gx,gz});
async function buildPrison(gx,gz){
  await page.locator('[data-category="管理"]').click();await page.locator('[data-tool="prison"]').click();
  const p=await project(gx,gz);await page.mouse.click(p.x,p.y);await page.keyboard.press('Escape');
  const prison=(await state()).buildings.find(b=>b.kind==='prison'&&b.gx===gx&&b.gz===gz);
  check('build a real correction center using the toolbar',!!prison,{gx,gz,p});return prison;
}
async function open(id){await page.keyboard.press('c');if(id)await page.locator('[data-ui="prison-site"]').selectOption(String(id));}
async function importBackup(value){
  if(await page.locator('#drawer [data-ui="close-drawer"]').isVisible())await close();
  await page.locator('[aria-label="游戏菜单"]').click();page.once('dialog',dialog=>dialog.accept());
  await page.locator('#import-save-input').setInputFiles({name:'correction-city.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});
  await page.waitForTimeout(250);
}
async function exportBackup(){
  if(await page.locator('#drawer [data-ui="close-drawer"]').isVisible())await close();
  await page.locator('[aria-label="游戏菜单"]').click();const downloadPromise=page.waitForEvent('download');
  await page.locator('[data-ui="export-save"]').click();return JSON.parse(await readFile(await (await downloadPromise).path(),'utf8'));
}
try{
  await page.goto(process.env.HAVEN_TEST_URL||'http://localhost:5175/',{waitUntil:'networkidle'});await page.waitForFunction(()=>!!window.__HAVEN__);await pause();
  const seed=await state();check('schema five preserves the starter city and its transit system',seed.version===5&&seed.buildings.length===143&&seed.corrections.sites.length===0&&seed.transit.enabled);
  await open();check('C opens a useful empty correction-center panel',await page.locator('#drawer').isVisible()&&/矫正中心/.test(await page.locator('#drawer').innerText()));
  const elapsed=(await state()).elapsed;await page.waitForTimeout(200);check('correction planning pauses city time',(await state()).elapsed===elapsed);await close();
  const beforeBuild=await state(),first=await buildPrison(12,14);let s=await state();
  check('construction creates one per-building management record',s.corrections.sites.length===1&&s.corrections.sites[0].buildingId===first.id&&beforeBuild.money-s.money===3200);
  await open(first.id);check('detailed operations start collapsed',await page.locator('[data-prison-section][open]').count()===0);
  await snap('01-center-overview');await section('facilities');
  const beforeFacilities=await state();
  for(const kind of ['classroom','workshop','infirmary'])await page.locator(`[data-ui="prison-facility"][data-kind="${kind}"]`).click();
  s=await state();check('three purchased facilities charge the city exactly once',beforeFacilities.money-s.money===3300&&Object.values(s.corrections.sites[0].facilities).every(level=>level===1));
  check('facility purchases keep the current section open',await page.locator('[data-prison-section="facilities"]').evaluate(el=>el.open));
  const expensesBefore=(await ops()).totalExpenses;await section('staff');
  await page.locator('[data-ui="prison-staff"][data-role="counselors"][data-delta="1"]').click();
  check('hiring a counselor raises actual daily payroll by 18',(await state()).corrections.sites[0].staff.counselors===1&&(await ops()).totalExpenses-expensesBefore===18);
  await page.locator('[data-ui="prison-staff"][data-role="guards"][data-delta="-1"]').click();await page.locator('[data-ui="prison-staff"][data-role="guards"][data-delta="-1"]').click();
  check('removing all guards stops intake and workshop operation',!(await ops()).sites[0].operational&&(await ops()).intakeCapacity===0&&(await ops()).workIncome===0);
  await page.locator('[data-ui="prison-staff"][data-role="guards"][data-delta="1"]').click();await page.locator('[data-ui="prison-staff"][data-role="guards"][data-delta="1"]').click();
  check('restoring guards resumes the staffed center',(await ops()).sites[0].operational&&(await ops()).intakeCapacity===16);
  await section('schedule');await page.locator('[data-ui="prison-schedule"][data-slot="morning"]').selectOption('recreation');
  await page.locator('[data-ui="prison-schedule"][data-slot="afternoon"]').selectOption('work');
  check('editing a daily slot changes the real current activity',(await state()).corrections.sites[0].schedule.morning==='recreation'&&(await ops()).sites[0].activity==='recreation');
  await page.locator('[data-ui="prison-schedule"][data-slot="afternoon"]').selectOption('education');await snap('02-facilities-staff-schedule');await close();
  const second=await buildPrison(12,10);await open(second.id);await section('facilities');
  check('each building has independent facility and staffing configuration',Object.values((await state()).corrections.sites.find(site=>site.buildingId===second.id).facilities).every(level=>level===0));
  await page.locator('[data-ui="prison-site"]').selectOption(String(first.id));
  check('switching centers preserves the configured first site',(await state()).corrections.sites.find(site=>site.buildingId===first.id).facilities.classroom===1);
  const configured=await exportBackup();check('backup includes both independent center configurations',configured.version===5&&configured.corrections.sites.length===2);
  const legacy=structuredClone(configured);legacy.version=4;delete legacy.corrections;legacy.stats.prisoners=6;legacy.player.money=777;
  await importBackup(legacy);s=await state();check('v0.4 city imports preserve inmates and migrate center defaults',s.version===5&&s.stats.prisoners===6&&s.player.money===777&&s.corrections.sites.length===2&&s.corrections.sites.every(site=>site.staff.guards===2&&site.facilities.classroom===0));
  const populated=structuredClone(configured);populated.stats.prisoners=6;populated.hour=13;populated.prison.unrest=72;
  await importBackup(populated);await open(first.id);let operations=await ops();
  check('center allocations do not duplicate prisoners',operations.sites.reduce((sum,site)=>sum+site.prisoners,0)===6&&operations.sites[0].phase==='课程');
  await section('services');check('city view cannot claim a personal service wage',await page.locator('[data-ui="prison-service"][data-kind="counsel"]').isDisabled());
  await page.locator('[data-ui="focus-prison"]').click();await page.waitForTimeout(250);await snap('03-correction-yard');
  await page.keyboard.press('2');await page.keyboard.down('s');await page.waitForTimeout(1100);await page.keyboard.up('s');
  const position=(await state()).player;check('the resident can walk to the actual center entrance',Math.hypot(position.x-(first.gx-11.5)*10,position.z-(first.gz-11.5)*10)<20,position);
  await open(first.id);await section('services');check('nearby resident can participate in correction services',await page.locator('[data-ui="prison-service"][data-kind="counsel"]').isEnabled());
  const beforeService=await state();await page.locator('[data-ui="prison-service"][data-kind="counsel"]').click();await pause();s=await state();
  const missionAwards=s.missions.filter(mission=>mission.completed&&!beforeService.missions.find(previous=>previous.id===mission.id)?.completed).reduce((sum,mission)=>sum+mission.reward,0);
  const accruedBalance=(s.elapsed-beforeService.elapsed)*(s.stats.income-s.stats.expenses)/240;
  check('service pays personal wages from the city budget',s.player.money-beforeService.player.money===85&&Math.abs(beforeService.money+missionAwards+accruedBalance-s.money-85)<.1,{city:beforeService.money-s.money,missionAwards,accruedBalance,personal:s.player.money-beforeService.player.money});
  check('service improves rehabilitation and career progress',s.prison.rehabilitation>=beforeService.prison.rehabilitation+2&&s.prison.unrest<beforeService.prison.unrest-3&&s.progression.careers.community.xp===beforeService.progression.careers.community.xp+20);
  check('service persists its visit and cooldown',s.corrections.sites.find(site=>site.buildingId===first.id).serviceVisits===1&&s.corrections.sites.find(site=>site.buildingId===first.id).nextServiceAt>s.elapsed);
  await open(first.id);await section('services');check('the shared site cooldown prevents repeated wages',await page.locator('[data-ui="prison-service"][data-kind="counsel"]').isDisabled()&&await page.locator('[data-ui="prison-service"][data-kind="teach"]').isDisabled());
  const saved=await exportBackup();await page.locator('[data-ui="save"]').click();await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>!!window.__HAVEN__);await pause();s=await state();
  check('reload preserves facilities, payroll, schedule and service cooldown',JSON.stringify(s.corrections)===JSON.stringify(saved.corrections)&&s.player.money===saved.player.money);
  await open(first.id);const frozen=JSON.stringify((await render()).prison);await page.waitForTimeout(250);check('paused yard actors do not advance',JSON.stringify((await render()).prison)===frozen);
  await page.setViewportSize({width:390,height:844});await section('facilities');await snap('04-mobile-correction-center');
  const mobile=await page.locator('#drawer').evaluate(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,scroll:el.scrollHeight,client:el.clientHeight,overflow:el.scrollWidth>el.clientWidth+1}));
  check('mobile correction controls fit and remain scrollable',mobile.left>=0&&mobile.right<=391&&mobile.scroll>=mobile.client&&!mobile.overflow,mobile);
  await page.setViewportSize({width:1600,height:1000});await close();await page.keyboard.press('3');await page.keyboard.press('c');
  check('first-person correction planning releases pointer input',await page.evaluate(()=>document.pointerLockElement===null)&&(await view()).mode==='first');await snap('05-first-person-services');
  const corrupt=structuredClone(saved);corrupt.corrections.sites.push(structuredClone(corrupt.corrections.sites[0]));
  const beforeInvalid=await state();await importBackup(corrupt);check('invalid duplicate center backup preserves the live city',JSON.stringify((await state()).corrections)===JSON.stringify(beforeInvalid.corrections)&&(await state()).player.money===beforeInvalid.player.money);
  await close();await open(first.id);await page.locator('[data-ui="focus-prison"]').click();await page.locator('[data-tool="bulldoze"]').click();const p=await project(first.gx,first.gz);await page.mouse.click(p.x,p.y);await page.keyboard.press('Escape');
  s=await state();check('demolition removes only the matching management record',!s.buildings.some(b=>b.id===first.id)&&s.corrections.sites.length===1&&s.corrections.sites[0].buildingId===second.id);
  check('no runtime errors or resource failures',errors.length===0&&failedRequests.length===0,{errors,failedRequests});
  await writeFile(resolve(out,'report.json'),JSON.stringify({passed:checks.length,checks,errors,failedRequests,render:await render()},null,2));
}catch(error){await snap('failure').catch(()=>{});await writeFile(resolve(out,'failure.json'),JSON.stringify({error:String(error),checks,errors,state:await state().catch(()=>null)},null,2));throw error;}finally{await browser.close();}
