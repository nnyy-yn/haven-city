import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)(process.env.HAVEN_PLAYWRIGHT_PATH||'playwright');
const out=resolve(import.meta.dirname,'..',process.env.HAVEN_TEST_OUT||'playtest/v03-edge');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.HAVEN_CHROME_PATH?{executablePath:process.env.HAVEN_CHROME_PATH}:{})});
const page=await browser.newPage({viewport:{width:1600,height:1000}}),checks=[],errors=[];
page.on('pageerror',e=>errors.push(String(e)));
const state=()=>page.evaluate(()=>window.__HAVEN__.getState());
const check=(name,pass)=>{assert.ok(pass,name);checks.push({name,passed:true});console.log('PASS',name);};
try{
  await page.goto(process.env.HAVEN_TEST_URL||'http://localhost:5175/',{waitUntil:'networkidle'});await page.waitForFunction(()=>!!window.__HAVEN__);
  const snapshot=await state();snapshot.speed=0;snapshot.money=-250;
  const power=snapshot.buildings.find(b=>b.kind==='power'),event=snapshot.civic.events[0];
  event.kind='outage';event.buildingId=power.id;
  // Replay a valid saved debt scenario; interactions below go through the real game UI.
  await page.addInitScript(s=>localStorage.setItem('haven-city-save-v1',JSON.stringify(s)),snapshot);
  await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>!!window.__HAVEN__);
  check('negative municipal balance loads as a valid save',(await state()).money===-250);
  await page.keyboard.press('j');
  const free=page.locator(`[data-ui="resolve-event"][data-id="${event.id}"][data-choice="ration"]`),paid=page.locator(`[data-ui="resolve-event"][data-id="${event.id}"][data-choice="repair"]`);
  check('free event response remains enabled in debt',await free.isEnabled());
  check('paid event response is disabled without city funds',await paid.isDisabled());
  await free.click();const resolved=await state();
  check('free response resolves the outage without charging debt',resolved.money===-250&&resolved.civic.events.find(e=>e.id===event.id).status==='resolved'&&resolved.civic.effects.some(e=>e.kind==='rationing'));
  await page.screenshot({path:resolve(out,'debt-response.png')});
  await page.locator('#drawer [data-ui="close-drawer"]').click();await page.keyboard.press('2');
  await page.locator('[data-drawer="career"]').click();await page.setViewportSize({width:390,height:844});
  check('context prompt stays behind open reading panels',!await page.locator('#context-prompt').isVisible());
  check('reading panel remains within mobile viewport',!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth));
  await page.screenshot({path:resolve(out,'career-mobile.png')});
  await page.setViewportSize({width:320,height:740});
  check('reading panel fits a narrow mobile viewport',!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth));
  await page.screenshot({path:resolve(out,'career-narrow.png')});
  check('no runtime errors',errors.length===0);
  await writeFile(resolve(out,'report.json'),JSON.stringify({passed:checks.length,checks,errors},null,2));
}finally{await browser.close();}
