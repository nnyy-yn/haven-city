import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';

const { chromium } = createRequire(import.meta.url)(process.env.HAVEN_PLAYWRIGHT_PATH || 'playwright');
const out=resolve(import.meta.dirname,'..',process.env.HAVEN_TEST_OUT||'playtest/v03');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.HAVEN_CHROME_PATH?{executablePath:process.env.HAVEN_CHROME_PATH}:{})});
const context=await browser.newContext({viewport:{width:1600,height:1000},deviceScaleFactor:1});
const page=await context.newPage();page.setDefaultTimeout(9000);
const errors=[],failedRequests=[],checks=[];
page.on('pageerror',e=>{errors.push(e.stack||String(e));console.error('BROWSER ERROR',String(e));});
page.on('requestfailed',r=>failedRequests.push(r.url()));
const state=()=>page.evaluate(()=>window.__HAVEN__.getState());
const view=()=>page.evaluate(()=>window.__HAVEN__.getView());
const markers=()=>page.evaluate(()=>window.__HAVEN__.getEventMarkers());
const project=(x,z,h=.3)=>page.evaluate(({x,z,h})=>window.__HAVEN__.getScreenPosition(x,z,h),{x,z,h});
const snap=name=>page.screenshot({path:resolve(out,name+'.png')});
const check=(name,condition,detail)=>{assert.ok(condition,`${name}: ${JSON.stringify(detail)}`);checks.push({name,passed:true,detail});console.log('PASS',name);};
const pause=()=>page.getByRole('button',{name:'暂停',exact:true}).click();
const fast=()=>page.getByRole('button',{name:'三倍速度',exact:true}).click();
const close=()=>page.locator('#drawer [data-ui="close-drawer"]').click();
const choice=(id,name)=>page.locator(`[data-ui="resolve-event"][data-id="${id}"][data-choice="${name}"]`);
async function select(b){
  for(let angle=0;angle<8;angle++){
    for(const [dx,dz,h] of [[0,0,3],[0,0,1],[2.8,2.8,3],[-2.8,-2.8,3],[2.8,-2.8,3],[-2.8,2.8,3]]){
      const p=await project((b.gx-11.5)*10+dx,(b.gz-11.5)*10+dz,h);
      if(p.x<300||p.x>1310||p.y<130||p.y>760)continue;
      await page.mouse.click(p.x,p.y);if((await view()).selected===b.id)return;
    }
    await page.keyboard.down('q');await page.waitForTimeout(700);await page.keyboard.up('q');
  }
  throw new Error('Unable to select '+JSON.stringify(b));
}
async function build(kind,category){
  const s=await state(),cells=[];
  for(let gx=3;gx<21;gx++)for(let gz=4;gz<20;gz++)if(!s.buildings.some(b=>b.gx===gx&&b.gz===gz)&&s.buildings.some(b=>b.kind==='road'&&Math.abs(b.gx-gx)+Math.abs(b.gz-gz)===1))cells.push({gx,gz});
  cells.sort((a,b)=>Math.hypot((a.gx-11.5)*10-s.player.x,(a.gz-11.5)*10-s.player.z)-Math.hypot((b.gx-11.5)*10-s.player.x,(b.gz-11.5)*10-s.player.z));
  const c=cells[0],p=await project((c.gx-11.5)*10,(c.gz-11.5)*10,0);
  await page.locator(`[data-ui="category"][data-category="${category}"]`).click();
  await page.locator(`[data-tool="${kind}"]`).click();await page.mouse.click(p.x,p.y);await page.keyboard.press('Escape');
  const b=(await state()).buildings.find(b=>b.kind===kind&&b.gx===c.gx&&b.gz===c.gz);
  check('construct '+kind,!!b,c);return b;
}
async function advanceTo(elapsed){
  await fast();
  await page.waitForFunction(t=>window.__HAVEN__.getState().elapsed>=t,elapsed,{timeout:100000});
  await pause();
}
try{
  await page.goto(process.env.HAVEN_TEST_URL||'http://localhost:5175/',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>!!window.__HAVEN__);await pause();
  const seed=await state(),festival=seed.civic.events.find(e=>e.kind==='festival');
  check('current schema preserves career skills and civic state',seed.version>=3&&seed.progression.career==='business'&&seed.progression.skills.logic===0&&festival.status==='pending');
  check('pending event has a scene marker',(await markers()).some(m=>m.id===festival.id));
  await page.keyboard.press('j');
  check('J opens the event journal',await page.locator('#journal-active').isVisible());
  const frozen=(await state()).elapsed;await page.waitForTimeout(400);
  check('reading journal pauses simulation',(await state()).elapsed===frozen);
  await snap('01-neighborhood-festival');
  await choice(festival.id,'sponsor').click();
  const celebrated=await state();
  check('sponsoring spends the city wallet once',celebrated.money===seed.money-1500&&celebrated.player.money===seed.player.money&&celebrated.civic.resolved===1);
  check('festival grants a real happiness effect',celebrated.civic.effects.some(e=>e.kind==='celebration')&&celebrated.stats.happiness>seed.stats.happiness);
  check('resolved choices are removed',await choice(festival.id,'sponsor').count()===0);
  check('resolved scene marker disappears',!(await markers()).some(m=>m.id===festival.id));await close();

  // One sparse drag must lay every tile between the two pointer events.
  const roadSeed=await state();let strip=null;
  for(let gz=5;gz<19&&!strip;gz++)for(let gx=4;gx<17&&!strip;gx++){
    const cells=Array.from({length:4},(_,i)=>({gx:gx+i,gz}));
    if(cells.every(c=>!roadSeed.buildings.some(b=>b.gx===c.gx&&b.gz===c.gz))){
      const a=await project((gx-11.5)*10,(gz-11.5)*10,0),b=await project((gx+3-11.5)*10,(gz-11.5)*10,0);
      if([a,b].every(p=>p.x>440&&p.x<1150&&p.y>170&&p.y<690))strip={cells,a,b};
    }
  }
  assert.ok(strip,'find a visible free road strip');await page.keyboard.press('b');
  await page.mouse.move(strip.a.x,strip.a.y);await page.mouse.down();await page.mouse.move(strip.b.x,strip.b.y,{steps:1});await page.mouse.up();await page.keyboard.press('Escape');
  const roads=await state();
  check('sparse road drag fills all four consecutive cells',strip.cells.every(c=>roads.buildings.some(b=>b.kind==='road'&&b.gx===c.gx&&b.gz===c.gz)),strip.cells);
  check('road painting charges every new cell once',roads.money===roadSeed.money-4*80);

  const school=await build('school','公共'),firestation=await build('firestation','管理');
  check('new services improve education and fire coverage',(await state()).stats.education>seed.stats.education&&(await state()).stats.fireCoverage>=35);
  await select(school);const beforeUpgrade=await state();await page.locator('#inspector [data-ui="upgrade"]').click();
  check('school upgrades expand service jobs while education remains bounded',(await state()).buildings.find(b=>b.id===school.id).level===2&&(await state()).stats.jobs>beforeUpgrade.stats.jobs&&(await state()).stats.education>=beforeUpgrade.stats.education);await page.keyboard.press('Escape');
  await snap('02-new-public-services');
  await page.locator('[aria-label="城市管理"]').click();const baseStats=(await state()).stats;
  for(const policy of ['green','education','community'])await page.locator(`[data-ui="policy"][data-policy="${policy}"]`).click();
  const governed=await state();
  check('three policies add their real daily costs',governed.stats.expenses===baseStats.expenses+550);
  check('green policy reduces utilities and community improves safety',governed.stats.powerNeed<baseStats.powerNeed&&governed.stats.waterNeed<baseStats.waterNeed&&governed.stats.safety>=baseStats.safety);
  check('policy switches expose their actual state',await page.locator('[data-ui="policy"][aria-pressed="true"]').count()===3);
  await snap('03-city-policy');await close();

  await page.keyboard.press('2');
  for(let i=0;i<3;i++){
    if(i){await fast();await page.waitForFunction(t=>window.__HAVEN__.getState().elapsed>=t,(await state()).elapsed+6.1,{timeout:15000});await pause();}
    const before=await state();await page.locator('#life-dock [data-action="work"]').click();const after=await state();
    const level=x=>1+[40,110,220,380].filter(t=>x>=t).length;
    const wage=160+35*(level(before.progression.careers.business.xp)-1)+5*(level(before.progression.skills.logic)-1);
    check(`career shift ${i+1} pays displayed wage`,after.player.money===before.player.money+wage,{wage});
  }
  const promoted=await state();check('two shifts promote career and third earns more',promoted.progression.careers.business.xp===60&&promoted.progression.careers.business.shifts===3&&promoted.progression.totalEarned>480&&promoted.player.job==='项目专员');
  await page.locator('[data-drawer="career"]').click();
  const careerTime=(await state()).elapsed;await page.waitForTimeout(350);
  check('career screen shows salary progression and freezes time',await page.locator('#career-summary').innerText().then(t=>t.includes('项目专员')&&t.includes('累计赚取'))&&(await state()).elapsed===careerTime);
  check('career reading surface has legible text and no minimap obstruction',!await page.locator('.minimap-wrap').isVisible()&&await page.locator('.career-intro').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=12));
  await page.locator('[data-ui="career"][data-career="culinary"]').click();
  check('career selection changes the current route',(await state()).progression.career==='culinary');
  await page.locator('[data-ui="career"][data-career="business"]').click();
  check('switching careers preserves earned experience',(await state()).progression.careers.business.xp===60);
  await snap('04-career-and-skills');await close();

  // Study uses the same near-building rule in both city and street modes.
  await page.keyboard.press('1');await select(school);let s=await state();
  let distance=Math.hypot((school.gx-11.5)*10-s.player.x,(school.gz-11.5)*10-s.player.z);
  if(distance>=18){
    await page.keyboard.press('2');
    const sx=(school.gx-11.5)*10,sz=(school.gz-11.5)*10;
    for(let i=0;i<14&&distance>=17.5;i++){
      const v=await view(),p=(await state()).player,dx=sx-p.x,dz=sz-p.z;
      const f=dx*Math.sin(v.lifeYaw)+dz*Math.cos(v.lifeYaw),r=-dx*Math.cos(v.lifeYaw)+dz*Math.sin(v.lifeYaw);
      const key=Math.abs(f)>Math.abs(r)?(f>0?'w':'s'):(r>0?'d':'a');
      await page.keyboard.down(key);await page.waitForTimeout(300);await page.keyboard.up(key);
      s=await state();distance=Math.hypot(sx-s.player.x,sz-s.player.z);
    }
    await page.keyboard.press('1');await select(school);
  }
  const beforeStudy=await state();await page.locator('#inspector [data-action="study"]').click();const studied=await state();
  check('school study spends personal money',studied.player.money===beforeStudy.player.money-60&&studied.money===beforeStudy.money);
  check('school and policy raise actual logic learning',studied.progression.skills.logic>beforeStudy.progression.skills.logic+45);
  await page.keyboard.press('Escape');

  await advanceTo(61);const outage=(await state()).civic.events.find(e=>e.kind==='outage'&&e.status==='pending');
  check('city generates a timed grid-maintenance event',!!outage);
  await page.keyboard.press('b');await page.keyboard.press('j');await page.locator(`[data-ui="focus-event"][data-id="${outage.id}"]`).click();
  check('event location focuses the affected building and clears construction tools',(await view()).selected===outage.buildingId&&(await view()).tool==='select'&&await page.locator('#journal-active').isVisible());
  const beforeRation=await state();await choice(outage.id,'ration').click();const rationed=await state();
  const missionReward=rationed.missions.filter(m=>m.completed&&!beforeRation.missions.find(b=>b.id===m.id)?.completed).reduce((sum,m)=>sum+m.reward,0);
  check('rationing is free and restores grid supply',rationed.money===beforeRation.money+missionReward&&rationed.stats.power>beforeRation.stats.power);
  check('rationing creates its explicit temporary tradeoff',rationed.civic.effects.some(e=>e.kind==='rationing')&&rationed.civic.resolved===2);
  await snap('05-event-history');await close();

  await advanceTo(151);const fire=(await state()).civic.events.find(e=>e.kind==='fire'&&e.status==='pending');
  check('city generates a fire event on an existing building',!!fire&&!!(await state()).buildings.find(b=>b.id===fire.buildingId));
  await page.keyboard.press('j');await page.locator(`[data-ui="focus-event"][data-id="${fire.id}"]`).click();await close();
  await page.waitForTimeout(300);const fireMarker=(await markers()).find(m=>m.id===fire.id);assert.ok(fireMarker);
  const markerPoint=await project(fireMarker.x,fireMarker.z,fireMarker.y);await page.mouse.click(markerPoint.x,markerPoint.y);
  check('clicking a 3D fire marker opens its event journal',await page.locator('#journal-active').isVisible()&&await choice(fire.id,'dispatch').isEnabled());
  await snap('06-fire-response');const beforeDispatch=await state();await choice(fire.id,'dispatch').click();const dispatched=await state();
  check('connected fire station handles fire for 600',dispatched.money===beforeDispatch.money-600&&dispatched.civic.events.find(e=>e.id===fire.id).choice==='dispatch');
  check('resolved fire removes its scene effect',!(await markers()).some(m=>m.id===fire.id));await close();
  await page.keyboard.press('2');await page.locator('[data-drawer="career"]').click();
  await snap('07-grown-career');await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);await snap('08-career-mobile');
  check('career screen fits mobile width',!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth));await close();
  await page.keyboard.press('j');await snap('09-journal-mobile');
  check('event journal fits mobile width',!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth));await close();
  await page.setViewportSize({width:1600,height:1000});await page.keyboard.press('1');
  await page.locator('[aria-label="游戏菜单"]').click();await page.locator('[data-ui="save"]').click();const saved=await state();
  await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>!!window.__HAVEN__);const restored=await state();
  check('career policies and event outcomes survive reload',isDeepStrictEqual(restored.progression,saved.progression)&&isDeepStrictEqual(restored.civic,saved.civic),{saved:{progression:saved.progression,civic:saved.civic},restored:{progression:restored.progression,civic:restored.civic}});
  // Move into the evening with normal simulation controls, then inspect actual nighttime rendering.
  await advanceTo(365);await page.keyboard.press('j');const latest=await state();
  for(const event of latest.civic.events.filter(e=>e.status==='pending')){const action=event.kind==='training'?'fund':event.kind==='festival'?'sponsor':event.kind==='fire'?'dispatch':'repair';await choice(event.id,action).click();}
  await close();await page.keyboard.press('1');await snap('10-night-city');
  check('day cycle reaches a visible evening state',(await state()).hour>=21||(await state()).hour<6);
  check('no runtime errors',errors.length===0,errors);check('all resources load locally',failedRequests.length===0,failedRequests);
  const report={passed:checks.length,checks,errors,failedRequests,performance:await view()};await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report.performance));
}catch(error){await snap('failure');await writeFile(resolve(out,'failure.json'),JSON.stringify({error:String(error),checks,errors,failedRequests,state:await state().catch(()=>null)},null,2));throw error;}finally{await browser.close();}
