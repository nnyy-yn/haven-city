import {createRequire} from 'node:module';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)(process.env.HAVEN_PLAYWRIGHT_PATH||'playwright');
const out=resolve(import.meta.dirname,'..',process.env.HAVEN_TEST_OUT||'playtest/v04');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.HAVEN_CHROME_PATH?{executablePath:process.env.HAVEN_CHROME_PATH}:{})});
const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1});page.setDefaultTimeout(12000);
const errors=[],checks=[];page.on('pageerror',error=>errors.push(String(error)));
const state=()=>page.evaluate(()=>window.__HAVEN__.getState());
const view=()=>page.evaluate(()=>window.__HAVEN__.getView());
const snap=name=>page.screenshot({path:resolve(out,`${name}.png`)});
const check=(name,value,detail)=>{assert.ok(value,`${name}: ${JSON.stringify(detail)}`);checks.push({name,passed:true,detail});console.log('PASS',name);};
const pause=()=>page.getByRole('button',{name:'暂停',exact:true}).click();
const close=()=>page.locator('#drawer [data-ui="close-drawer"]').click();
const project=(gx,gz)=>page.evaluate(({gx,gz})=>window.__HAVEN__.getScreenPosition((gx-11.5)*10,(gz-11.5)*10,0),{gx,gz});
async function importFile(value,{accept=true}={}){
  if(!await page.locator('#import-save-input').count())await page.locator('[aria-label="游戏菜单"]').click();
  page.once('dialog',dialog=>accept?dialog.accept():dialog.dismiss());
  await page.locator('#import-save-input').setInputFiles({name:'city-backup.json',mimeType:'application/json',buffer:Buffer.from(typeof value==='string'?value:JSON.stringify(value))});
  await page.waitForTimeout(350);
}
async function buildStop(cell){
  await page.locator('[data-category="公共"]').click();await page.locator('[data-tool="busstop"]').click();
  const p=await project(cell.gx,cell.gz);await page.mouse.click(p.x,p.y);await page.keyboard.press('Escape');
  const stop=(await state()).buildings.find(b=>b.kind==='busstop'&&b.gx===cell.gx&&b.gz===cell.gz);
  check('construct a connected bus stop through the build toolbar',!!stop,cell);return stop;
}
async function walkToStop(stop){
  const s=await state(),roads=s.buildings.filter(b=>b.kind==='road'),key=b=>`${b.gx},${b.gz}`,map=new Map(roads.map(b=>[key(b),b]));
  const source=roads.reduce((a,b)=>Math.hypot((b.gx-11.5)*10-s.player.x,(b.gz-11.5)*10-s.player.z)<Math.hypot((a.gx-11.5)*10-s.player.x,(a.gz-11.5)*10-s.player.z)?b:a);
  const previous=new Map([[key(source),null]]),queue=[source];let goal;
  for(let i=0;i<queue.length;i++){
    const b=queue[i];if(Math.abs(b.gx-stop.gx)+Math.abs(b.gz-stop.gz)===1){goal=key(b);break;}
    for(const [gx,gz]of [[b.gx+1,b.gz],[b.gx-1,b.gz],[b.gx,b.gz+1],[b.gx,b.gz-1]]){const k=`${gx},${gz}`;if(map.has(k)&&!previous.has(k)){previous.set(k,key(b));queue.push(map.get(k));}}
  }
  assert.ok(goal);const route=[];for(let k=goal;k!==null;k=previous.get(k))route.unshift(map.get(k));
  for(const road of route){
    for(let attempt=0;attempt<12;attempt++){
      const {player}=await state();if(Math.hypot(player.x-(stop.gx-11.5)*10,player.z-(stop.gz-11.5)*10)<17)return;
      const dx=(road.gx-11.5)*10-player.x,dz=(road.gz-11.5)*10-player.z;if(Math.hypot(dx,dz)<.8)break;
      const yaw=(await view()).lifeYaw,forward=dx*Math.sin(yaw)+dz*Math.cos(yaw),right=-dx*Math.cos(yaw)+dz*Math.sin(yaw);
      const input=Math.abs(forward)>Math.abs(right)?forward>0?'w':'s':right>0?'d':'a';
      await page.keyboard.down(input);await page.waitForTimeout(Math.min(600,Math.max(80,Math.hypot(dx,dz)/6*1000)));await page.keyboard.up(input);
    }
  }
}
try{
  await page.goto(process.env.HAVEN_TEST_URL||'http://localhost:5175/',{waitUntil:'networkidle'});await page.waitForFunction(()=>!!window.__HAVEN__);await pause();
  const seed=await state();check('schema four preserves the inhabited starter city',seed.version===4&&seed.buildings.length===143&&seed.transit.enabled&&seed.transit.fare===4);
  const initialView=await view();check('static scene batches reduce city draw calls',initialView.drawCalls<700,initialView);
  await page.keyboard.press('t');check('T opens the transport drawer',await page.locator('[data-ui="transit-enabled"]').isVisible());
  const frozen=await state();await page.waitForTimeout(200);check('route planning pauses the simulation',(await state()).elapsed===frozen.elapsed);
  check('empty network explains that more stations are needed',/至少两[个座站]/.test(await page.locator('#drawer').innerText()));await close();
  const free=[];
  for(let gx=3;gx<21;gx++)for(let gz=4;gz<20;gz++)if(!seed.buildings.some(b=>b.gx===gx&&b.gz===gz)&&seed.buildings.some(b=>b.kind==='road'&&Math.abs(b.gx-gx)+Math.abs(b.gz-gz)===1)){
    const p=await project(gx,gz);if(p.x>420&&p.x<1240&&p.y>150&&p.y<730)free.push({gx,gz});
  }
  free.sort((a,b)=>Math.hypot((a.gx-11.5)*10-seed.player.x,(a.gz-11.5)*10-seed.player.z)-Math.hypot((b.gx-11.5)*10-seed.player.x,(b.gz-11.5)*10-seed.player.z));
  const start=await buildStop(free[0]);
  const destinationCell=free.find(c=>Math.hypot(c.gx-start.gx,c.gz-start.gz)>4&&Math.hypot(c.gx-start.gx,c.gz-start.gz)<9);assert.ok(destinationCell);
  const destination=await buildStop(destinationCell);let s=await state();
  check('station construction spends municipal funds once',s.money===seed.money-1700);
  check('connected stations activate real ridership and service costs',s.stats.transitCoverage>0&&s.stats.transitRiders>0&&s.stats.transitIncome>0&&s.stats.transitExpenses>16,s.stats);
  await page.keyboard.press('t');await page.locator('[data-ui="transit-fare"][data-fare="2"]').click();const cheap=await state();
  await page.locator('[data-ui="transit-fare"][data-fare="6"]').click();const expensive=await state();
  check('fare changes affect actual projected ridership and revenue',cheap.stats.transitRiders>expensive.stats.transitRiders&&cheap.stats.transitIncome<expensive.stats.transitIncome);
  await page.locator('[data-ui="transit-enabled"]').click();s=await state();check('suspending service removes riders and operating cost',!s.transit.enabled&&s.stats.transitCoverage===0&&s.stats.transitIncome===0&&s.stats.transitExpenses===16);
  await page.locator('[data-ui="transit-enabled"]').click();await page.locator('[data-ui="transit-fare"][data-fare="4"]').click();await snap('01-transport-network');await close();
  // Walk via the same connected road tiles; do not cross shop and apartment colliders.
  await page.keyboard.press('2');s=await state();
  const startX=(start.gx-11.5)*10,startZ=(start.gz-11.5)*10;
  if(Math.hypot(startX-s.player.x,startZ-s.player.z)>=18)await walkToStop(start);
  s=await state();check('walk from the starter street into boarding range',Math.hypot(startX-s.player.x,startZ-s.player.z)<18,{start,player:s.player});
  await page.keyboard.press('t');const ride=page.locator(`[data-ui="ride-transit"][data-id="${destination.id}"]`);
  check('same-network destination can be selected in resident view',await ride.isEnabled());
  const beforeRide=await state();await ride.click();s=await state();
  check('boarding charges only the personal wallet and starts a journey',s.player.money===beforeRide.player.money-4&&s.transit.journey?.toId===destination.id,s.transit);
  check('boarding closes route planning and restores running time',!await page.locator('#drawer').isVisible()&&s.speed>0);
  await pause();const onBus=await state();await page.keyboard.down('w');await page.waitForTimeout(300);await page.keyboard.up('w');s=await state();
  check('pause freezes a journey and walking cannot move the passenger',s.transit.journey.travelled===onBus.transit.journey.travelled&&s.player.x===onBus.player.x&&s.player.z===onBus.player.z);
  await snap('02-passenger-third-person');await page.keyboard.press('3');check('passenger can switch to first person',(await view()).mode==='first');await snap('03-passenger-first-person');await page.keyboard.press('2');
  await page.getByRole('button',{name:'正常速度',exact:true}).click();
  await page.waitForFunction(()=>window.__HAVEN__.getState().transit.journey===null,undefined,{timeout:25000});await pause();s=await state();
  check('bus follows its route and releases the passenger at the destination',s.transit.totalTrips===1&&Math.hypot(s.player.x-(destination.gx-11.5)*10,s.player.z-(destination.gz-11.5)*10)<18,s.player);
  check('arriving does not charge another fare',s.player.money===beforeRide.player.money-4);
  await page.keyboard.press('1');await snap('04-transit-city');
  await page.locator('[aria-label="游戏菜单"]').click();await page.locator('[data-ui="save"]').click();
  const downloadPromise=page.waitForEvent('download');await page.locator('[data-ui="export-save"]').click();const download=await downloadPromise;
  const exported=JSON.parse(await readFile(await download.path(),'utf8'));
  check('export produces a portable JSON backup of the actual city',exported.version===4&&exported.transit.totalTrips===1&&exported.buildings.filter(b=>b.kind==='busstop').length===2);
  const beforeInvalid=await state();await importFile('{invalid JSON');
  check('invalid backup leaves the current city and wallet intact',JSON.stringify(await state())===JSON.stringify(beforeInvalid));
  const future={...exported,version:99};await importFile(future);check('future backups are rejected without replacing progress',(await state()).player.money===beforeInvalid.player.money&&(await state()).transit.totalTrips===1);
  const legacy={...seed,version:3,player:{...seed.player,money:777}};delete legacy.transit;
  for(const key of ['transitCoverage','transitRiders','transitIncome','transitExpenses'])delete legacy.stats[key];
  await importFile(legacy,{accept:false});check('declining import preserves the existing city',(await state()).player.money===beforeInvalid.player.money);
  await importFile(legacy);s=await state();check('version three backup migrates with its original progress',s.version===4&&s.player.money===777&&s.buildings.length===143&&s.transit.totalTrips===0);
  await page.locator('[aria-label="游戏菜单"]').click();await importFile(exported);s=await state();check('exported city restores both stations and the completed trip',s.transit.totalTrips===1&&s.player.money===exported.player.money&&s.buildings.length===exported.buildings.length);
  await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>!!window.__HAVEN__);s=await state();check('successful import persists across a reload',s.transit.totalTrips===1&&s.player.money===exported.player.money);
  await page.setViewportSize({width:390,height:844});await page.keyboard.press('t');await snap('05-mobile-transport');
  const mobile=await page.locator('#drawer').evaluate(el=>({width:el.getBoundingClientRect().width,left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,scroll:el.scrollHeight,client:el.clientHeight}));
  check('mobile transport drawer fits and remains scrollable',mobile.left>=0&&mobile.right<=391&&mobile.scroll>=mobile.client,mobile);
  check('no runtime errors',errors.length===0,errors);await writeFile(resolve(out,'report.json'),JSON.stringify({passed:checks.length,checks,errors,performance:initialView},null,2));
}catch(error){await snap('failure').catch(()=>{});await writeFile(resolve(out,'failure.json'),JSON.stringify({error:String(error),checks,errors,state:await state().catch(()=>null)},null,2));throw error;}finally{await browser.close();}
