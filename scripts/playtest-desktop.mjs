import {createRequire} from 'node:module';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const {_electron}=createRequire(import.meta.url)(process.env.HAVEN_PLAYWRIGHT_PATH||'playwright');
const root=resolve(import.meta.dirname,'..'),out=resolve(root,process.env.HAVEN_TEST_OUT||'playtest/desktop');await mkdir(out,{recursive:true});
const {version}=JSON.parse(await readFile(resolve(root,'src/release-config.json'),'utf8'));
const app=await _electron.launch({executablePath:process.env.HAVEN_TEST_EXE||resolve(root,'desktop/release/win-unpacked/HavenCity.exe'),env:{...process.env,HAVEN_TEST_MODE:'1',HAVEN_TEST_USER_DATA:resolve(out,'profile')},timeout:30000});
const page=await app.firstWindow(),checks=[],errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.stack||String(e)));
const state=()=>page.evaluate(()=>window.__HAVEN__.getState());
const check=(name,passed,detail)=>{assert.ok(passed,`${name}: ${JSON.stringify(detail)}`);checks.push({name,passed:true,detail});console.log('PASS',name);};
try{
  await page.waitForFunction(()=>!!window.__HAVEN__);
  check('packaged EXE starts the offline 3D city',await app.evaluate(({app})=>app.isPackaged)&&(await state()).buildings.length>=143&&await page.evaluate(()=>window.__HAVEN__.getView().drawCalls>0));
  check('desktop renderer has an isolated restricted bridge',await page.evaluate(version=>typeof window.require==='undefined'&&typeof window.process==='undefined'&&window.havenDesktop.version===version,version));
  check('desktop does not check updates on startup',(await page.evaluate(()=>window.havenDesktop.getUpdateState())).status==='idle');
  await page.getByRole('button',{name:'暂停',exact:true}).click();await page.keyboard.press('2');
  const before=await state();await page.locator('#life-dock [data-action="work"]').click();
  check('native game UI earns and records career wages',(await state()).player.money>before.player.money&&(await state()).progression.totalEarned>before.progression.totalEarned);
  await page.locator('[aria-label="游戏菜单"]').click();
  await page.screenshot({path:resolve(out,'01-desktop-update-menu.png')});
  check('desktop menu exposes its explicit update action',await page.locator('[data-ui="check-update"]').isVisible());
  const denied=await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new Error('QA simulated full storage');};try{return window.dispatchEvent(new Event('haven:before-update-install',{cancelable:true}));}finally{Storage.prototype.setItem=original;}});
  check('failed save cancels native update restart',denied===false);
  check('successful update save handshake writes a valid city',await page.evaluate(()=>window.dispatchEvent(new Event('haven:before-update-install',{cancelable:true})))===true&&await page.evaluate(()=>JSON.parse(localStorage.getItem('haven-city-save-v1')).version===4));
  const saved=await state();await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>!!window.__HAVEN__);
  check('desktop origin restores progress after reload',(await state()).player.money===saved.player.money&&(await state()).progression.totalEarned===saved.progression.totalEarned);
  await page.locator('[aria-label="游戏菜单"]').click();
  if(process.env.HAVEN_UPDATE_LIVE==='1'){
    await page.locator('[data-ui="check-update"]').click();
    await page.locator('#update-state .update-status.current, #update-state .update-status.error, #update-state .update-status.available').waitFor({timeout:45000});
    const update=await page.evaluate(()=>window.havenDesktop.getUpdateState());
    check('published GitHub feed confirms this EXE is current',update.status==='current',update);
    await page.screenshot({path:resolve(out,'02-desktop-current-release.png')});
  }
  check('desktop renderer has no runtime errors',errors.length===0,errors);
  await writeFile(resolve(out,'report.json'),JSON.stringify({passed:checks.length,checks,errors,view:await page.evaluate(()=>window.__HAVEN__.getView())},null,2));
}catch(error){await page.screenshot({path:resolve(out,'failure.png')}).catch(()=>{});throw error;}finally{await app.close();}
