import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const { chromium } = createRequire(import.meta.url)(process.env.HAVEN_PLAYWRIGHT_PATH || 'playwright');
const out=resolve(import.meta.dirname,'..',process.env.HAVEN_TEST_OUT||'playtest/v02');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.HAVEN_CHROME_PATH?{executablePath:process.env.HAVEN_CHROME_PATH}:{})});
const context=await browser.newContext({viewport:{width:1600,height:1000},deviceScaleFactor:1});
const page=await context.newPage();
page.setDefaultTimeout(7000);
const errors=[],failedRequests=[],checks=[];
page.on('pageerror',e=>{errors.push(e.stack||String(e));console.error('BROWSER ERROR',e.stack||String(e));});
page.on('requestfailed',r=>failedRequests.push(r.url()));
const state=()=>page.evaluate(()=>window.__HAVEN__.getState());
const view=()=>page.evaluate(()=>window.__HAVEN__.getView());
const snap=name=>page.screenshot({path:resolve(out,name+'.png')});
const check=(name,condition,detail)=>{assert.ok(condition,`${name}: ${JSON.stringify(detail)}`);checks.push({name,passed:true,detail});console.log('PASS',name);};
const project=(x,z,h=1)=>page.evaluate(({x,z,h})=>window.__HAVEN__.getScreenPosition(x,z,h),{x,z,h});
const pause=()=>page.getByRole('button',{name:'暂停',exact:true}).click();
const play=()=>page.getByRole('button',{name:'正常速度',exact:true}).click();
const closeDrawer=()=>page.locator('#drawer [data-ui="close-drawer"]').click();
async function selectBuilding(b){
  for(const h of [3,1,5,8]){
    const p=await project((b.gx-11.5)*10,(b.gz-11.5)*10,h);
    await page.mouse.click(p.x,p.y);
    if((await view()).selected===b.id)return;
  }
  throw new Error('Could not select building '+JSON.stringify(b));
}
async function walkTo(x,z,tolerance=.25){
  let stuck=0,previous=Infinity;
  for(let i=0;i<45;i++){
    const s=await state(),v=await view(),p=s.player,dx=x-p.x,dz=z-p.z,d=Math.hypot(dx,dz);
    if(d<tolerance)return;
    const forward=dx*Math.sin(v.lifeYaw)+dz*Math.cos(v.lifeYaw);
    const right=-dx*Math.cos(v.lifeYaw)+dz*Math.sin(v.lifeYaw);
    const code=Math.abs(forward)>Math.abs(right)?(forward>0?'w':'s'):(right>0?'d':'a');
    const component=Math.max(Math.abs(forward),Math.abs(right));
    await page.keyboard.down(code);await page.waitForTimeout(Math.max(35,Math.min(350,component/3.6*950)));await page.keyboard.up(code);
    if(Math.abs(previous-d)<.025)stuck++;else stuck=0;
    if(stuck>5)throw new Error(`Walking blocked towards ${x},${z} from ${JSON.stringify(p)}`);
    previous=d;
  }
  throw new Error(`Walking did not reach ${x},${z}: ${JSON.stringify((await state()).player)}`);
}
async function buy(kind){
  await page.locator('#decorate-button').click();
  await page.locator(`[data-ui="buy-furniture"][data-kind="${kind}"]`).click();
}
async function use(kind){
  await page.locator('#decorate-button').click();
  const s=await state(),id=s.homes.find(h=>h.homeId===s.interior.homeId).furniture.find(f=>f.kind===kind).id;
  await page.locator(`#drawer [data-ui="interact"][data-id="${id}"]`).click();
}

try{
  await page.goto(process.env.HAVEN_TEST_URL||'http://localhost:5175/',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>!!window.__HAVEN__);
  await pause();
  const seed=await state();
  check('v02 city starts with migrated schema',seed.version>=2&&seed.player.hygiene>87&&Array.isArray(seed.homes)&&seed.prison.regime==='balanced');
  const npc=seed.residents.slice().sort((a,b)=>Math.hypot(a.x-seed.player.x,a.z-seed.player.z)-Math.hypot(b.x-seed.player.x,b.z-seed.player.z))[0];
  const np=await project(npc.x,npc.z,1.25);await page.mouse.click(np.x,np.y);
  const friend=(await view()).selected;
  await page.locator('#inspector [data-action="talk"]').click();
  await play();await page.waitForTimeout(1500);
  await page.locator('#inspector [data-ui="social"][data-action="compliment"]').click();
  check('compliment has distinct relationship gain',(await state()).residents.find(r=>r.id===friend).relation===30);
  await page.waitForTimeout(2400);
  const wallet=(await state()).player.money;
  await page.locator('#inspector [data-ui="social"][data-action="gift"]').click();
  await pause();
  check('gift spends personal wallet and establishes friendship',(await state()).residents.find(r=>r.id===friend).relation===55&&(await state()).player.money===wallet-25);
  await page.keyboard.press('Escape');
  const current=await state();
  const home=current.buildings.filter(b=>['home','apartment'].includes(b.kind)&&Math.hypot((b.gx-11.5)*10-current.player.x,(b.gz-11.5)*10-current.player.z)<18)[0];
  await selectBuilding(home);
  const beforeUpgrade=await state();
  await page.locator('#inspector [data-ui="upgrade"]').click();
  check('building upgrade expands city capacity',(await state()).buildings.find(b=>b.id===home.id).level===2&&(await state()).stats.capacity>beforeUpgrade.stats.capacity);
  await page.locator('#inspector [data-ui="upgrade"]').click();
  check('level three is enforced in UI',await page.locator('#inspector [data-ui="upgrade"]').isDisabled());
  await page.locator('#inspector [data-action="adopt"]').click();
  check('own home includes starter furniture',(await state()).player.homeId===home.id&&(await state()).homes.find(h=>h.homeId===home.id).furniture.length===6);
  await snap('01-city-upgrades');
  await page.keyboard.press('Escape');
  await page.locator('[data-ui="category"][data-category="管理"]').click();
  await page.locator('[data-tool="prison"]').click();
  const s=await state(),cells=[];
  for(let gx=3;gx<21;gx++)for(let gz=4;gz<20;gz++)if(!s.buildings.some(b=>b.gx===gx&&b.gz===gz)&&s.buildings.some(b=>b.kind==='road'&&Math.abs(b.gx-gx)+Math.abs(b.gz-gz)===1))cells.push({gx,gz});
  cells.sort((a,b)=>(a.gx-12)**2+(a.gz-12)**2-((b.gx-12)**2+(b.gz-12)**2));
  const c=cells[0],cp=await project((c.gx-11.5)*10,(c.gz-11.5)*10,0);await page.mouse.click(cp.x,cp.y);await page.keyboard.press('Escape');
  check('correction facility can be constructed',(await state()).stats.prisonCapacity===16);
  await page.locator('[aria-label="城市管理"]').click();
  const balanced=(await state()).stats.expenses;
  await page.locator('[data-ui="prison-regime"][data-regime="rehabilitation"]').click();
  check('rehabilitation changes real operating budget',(await state()).prison.regime==='rehabilitation'&&(await state()).stats.expenses>balanced);
  await page.locator('[data-ui="prison-intake"]').click();
  check('intake switch changes simulation',(await state()).prison.intake===false);
  check('current prison phase is highlighted',await page.locator('.prison-schedule .active').count()>0);
  await snap('02-prison-management');await closeDrawer();
  await page.keyboard.press('2');
  await page.locator('#life-dock [data-action="work"]').click();
  await page.locator('#life-dock [data-action="eat"]').click();
  const outdoor=await state();
  await page.keyboard.press('h');await page.waitForTimeout(400);
  check('H enters a walkable home',(await state()).interior?.homeId===home.id&&(await view()).location==='home');
  await snap('03-home-third-person');
  const funds=(await state()).player.money,treasury=(await state()).money;
  await buy('desk');
  check('furniture purchase spends personal money',(await state()).player.money===funds-180&&(await state()).money===treasury);
  await page.locator('[data-ui="buy-furniture"][data-kind="bookshelf"]').click();
  const furnished=await state();
  check('new furniture appears in home state',furnished.homes.find(h=>h.homeId===home.id).furniture.length===8);
  await snap('04-furniture-shop');await closeDrawer();
  await page.locator('[data-ui="drawer"][data-drawer="contacts"]').click();
  await page.locator(`#drawer [data-ui="social"][data-action="invite"][data-id="${friend}"]`).click();
  check('friend comes to the home',(await state()).interior.guestId===friend&&(await state()).missions.find(m=>m.id==='visitor').completed);
  if(await page.locator('#drawer').isVisible())await closeDrawer();
  await play();
  await walkTo(0,-2);
  await walkTo(0,-3.2);
  const beforeWork=(await state()).player;
  await use('desk');
  check('home office pays real wages',(await state()).player.money===beforeWork.money+90);
  await page.waitForTimeout(1400);
  await walkTo(2.8,-3.2);
  const beforeCook=(await state()).player;
  await use('kitchen');
  check('cooking spends ingredients and restores hunger',(await state()).player.money===beforeCook.money-12&&(await state()).player.hunger>beforeCook.hunger+5);
  await walkTo(0,-2);await walkTo(-2.7,-2.1);
  const energy=(await state()).player.energy;
  await use('bed');
  check('bed restores energy',(await state()).player.energy>energy+10);
  await walkTo(0,-1.5);await walkTo(0,5.5);await walkTo(3.9,4.8);
  const hygiene=(await state()).player.hygiene;
  await use('shower');
  check('shower restores fifth need',(await state()).player.hygiene>hygiene);
  await walkTo(0,4.2);await walkTo(0,0);
  await pause();
  await snap('05-home-with-guest');
  await page.keyboard.press('3');await page.waitForTimeout(350);await snap('06-home-first-person');
  check('first person remains inside',(await view()).mode==='first'&&(await state()).interior?.guestId===friend);
  await page.locator('[aria-label="游戏菜单"]').click();await page.locator('[data-ui="save"]').click();
  const saved=await state();await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>!!window.__HAVEN__);
  const restored=await state();
  check('interior furniture guest and policy survive reload',restored.interior?.guestId===friend&&restored.homes.find(h=>h.homeId===home.id).furniture.length===8&&restored.prison.regime==='rehabilitation'&&restored.prison.intake===false&&restored.player.money===saved.player.money);
  check('reload uses an indoor camera',(await view()).location==='home'&&(await view()).mode!=='city');
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(350);await snap('07-home-mobile');
  check('indoor HUD fits small screens',!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth));
  await page.locator('#interior-banner [data-action="exit"]').click();
  check('exit returns to original city position',!(await state()).interior&&Math.hypot((await state()).player.x-outdoor.player.x,(await state()).player.z-outdoor.player.z)<.01);
  await page.setViewportSize({width:1600,height:1000});await page.keyboard.press('1');
  check('city camera restored after home visit',(await view()).mode==='city');
  check('no runtime errors',errors.length===0,errors);
  check('all resources are local',failedRequests.length===0,failedRequests);
  const report={passed:checks.length,checks,errors,failedRequests,performance:await view()};
  await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:checks.length,performance:report.performance},null,2));
}catch(error){
  await snap('failure');await writeFile(resolve(out,'failure.json'),JSON.stringify({error:String(error),checks,errors,failedRequests,state:await state().catch(()=>null)},null,2));throw error;
}finally{await browser.close();}
