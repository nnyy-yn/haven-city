import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {once} from 'node:events';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)(process.env.HAVEN_PLAYWRIGHT_PATH||'playwright');
const root=resolve(import.meta.dirname,'..'),out=resolve(root,process.env.HAVEN_TEST_OUT||'playtest/portable-v04');await mkdir(out,{recursive:true});
const {version}=JSON.parse(await readFile(resolve(root,'src/release-config.json'),'utf8'));
const executable=process.env.HAVEN_TEST_EXE||resolve(root,`desktop/release/HavenCity-Portable-${version}-x64.exe`);
const port=Number(process.env.HAVEN_TEST_CDP_PORT||9467);
const child=spawn(executable,[`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1'],{env:{...process.env,HAVEN_TEST_MODE:'1',HAVEN_TEST_USER_DATA:resolve(out,'profile')},windowsHide:true,stdio:['ignore','pipe','pipe']});
let logs='',browser,page;child.stdout.on('data',data=>logs+=data);child.stderr.on('data',data=>logs+=data);child.on('error',error=>logs+=String(error));
const checks=[],errors=[];
const check=(name,value,detail)=>{assert.ok(value,`${name}: ${JSON.stringify(detail)}`);checks.push({name,passed:true,detail});console.log('PASS',name);};
try{
  for(let attempt=0;attempt<50;attempt++){
    try{browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:700});break;}catch{if(child.exitCode!==null)throw new Error(`Portable quit before launch: ${logs.slice(-2000)}`);await delay(400);}
  }
  assert.ok(browser,`Portable EXE must start its browser runtime: ${logs.slice(-2000)}`);
  const context=browser.contexts()[0];page=context.pages()[0]||await context.waitForEvent('page');page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(String(error)));
  await page.waitForFunction(()=>!!window.__HAVEN__);
  const state=()=>page.evaluate(()=>window.__HAVEN__.getState());
  const initial=await state();check('actual single-file Portable EXE opens the offline 3D game',initial.version===5&&initial.buildings.length===143&&Array.isArray(initial.corrections.sites)&&(await page.evaluate(()=>window.__HAVEN__.getView())).drawCalls>0);
  check('actual Portable EXE exposes only its isolated restricted bridge',await page.evaluate(version=>typeof window.require==='undefined'&&typeof window.process==='undefined'&&window.havenDesktop.version===version,version));
  const initialUpdate=await page.evaluate(()=>window.havenDesktop.getUpdateState());check('Portable mode is detected and startup makes no update check',initialUpdate.status==='idle'&&initialUpdate.message.includes('免安装'),initialUpdate);
  await page.getByRole('button',{name:'暂停',exact:true}).click();await page.keyboard.press('2');
  const beforeWork=await state();await page.locator('#life-dock [data-action="work"]').click();check('the Portable game supports actual life actions and career wages',(await state()).player.money>beforeWork.player.money);
  await page.keyboard.press('t');check('the Portable game includes the public transport controls',await page.locator('[data-ui="transit-enabled"]').isVisible());await page.locator('#drawer [data-ui="close-drawer"]').click();
  await page.keyboard.press('c');check('the Portable game includes correction-center operations',await page.locator('#drawer').isVisible()&&await page.locator('#drawer').evaluate(el=>el.classList.contains('prison-drawer')));await page.locator('#drawer [data-ui="close-drawer"]').click();
  await page.locator('[aria-label="游戏菜单"]').click();check('the Portable menu includes import and export backup actions',await page.locator('[data-ui="export-save"]').isVisible()&&await page.locator('[data-ui="import-save"]').isVisible());
  const denied=await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new Error('QA full storage');};try{return window.dispatchEvent(new Event('haven:before-update-install',{cancelable:true}));}finally{Storage.prototype.setItem=original;}});
  check('storage failure is reported without approving a restart',denied===false);
  await page.locator('[data-ui="save"]').click();const saved=await state();await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>!!window.__HAVEN__);
  check('Portable saves restore without losing wages',(await state()).player.money===saved.player.money&&(await state()).progression.totalEarned===saved.progression.totalEarned);
  await page.locator('[aria-label="游戏菜单"]').click();
  if(process.env.HAVEN_UPDATE_LIVE==='1'){
    await page.locator('[data-ui="check-update"]').click();await page.locator('#update-state .update-status.current, #update-state .update-status.error, #update-state .update-status.available').waitFor({timeout:25000});
    const update=await page.evaluate(()=>window.havenDesktop.getUpdateState());check('Portable checks the live GitHub EXE release without an installer manifest',update.status==='current'&&update.version===version,update);
  }
  await page.screenshot({path:resolve(out,'01-portable-game-menu.png')});check('Portable renderer has no runtime errors',errors.length===0,errors);
  await writeFile(resolve(out,'report.json'),JSON.stringify({passed:checks.length,checks,errors,view:await page.evaluate(()=>window.__HAVEN__.getView())},null,2));
}catch(error){if(page)await page.screenshot({path:resolve(out,'failure.png')}).catch(()=>{});await writeFile(resolve(out,'failure.json'),JSON.stringify({error:String(error),checks,errors,logs:logs.slice(-5000)},null,2));throw error;}
finally{
  if(browser&&browser.isConnected()){
    const cdp=await browser.newBrowserCDPSession().catch(()=>null);
    if(cdp){const disconnected=once(browser,'disconnected');void cdp.send('Browser.close').catch(()=>{});await Promise.race([disconnected,delay(2000)]);}
    await browser.close().catch(()=>{});
  }
  if(child.exitCode===null)await Promise.race([once(child,'exit'),delay(2000)]);
  if(child.exitCode===null)child.kill();
}
