import { createRequire } from 'node:module';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

// Reuse the same externally supplied Playwright/Chrome paths as the game smoke tests.
const { chromium } = createRequire(import.meta.url)(process.env.HAVEN_PLAYWRIGHT_PATH || 'playwright');
const root = resolve(import.meta.dirname, '..');
const out = resolve(root, process.env.HAVEN_TEST_OUT || 'playtest/v04-updates');
const url = process.env.HAVEN_TEST_URL || 'http://localhost:5175/';
const config = JSON.parse(await readFile(resolve(root, 'src/release-config.json'), 'utf8'));
assert.ok(config.owner && config.repo, 'Update UI tests require a configured public repository');
const currentVersion = config.version;
const newVersion = '0.6.0';
const repository = `${config.owner}/${config.repo}`;
const apiUrl = `https://api.github.com/repos/${repository}/releases/latest`;
const release = (version = newVersion) => ({
  tag_name: `v${version}`, draft: false, prerelease: false,
  html_url: `https://github.com/${repository}/releases/tag/v${version}`,
  assets: [{
    name: `HavenCity-Portable-${version}-x64.exe`, state: 'uploaded', content_type: 'application/octet-stream',
    browser_download_url: `https://github.com/${repository}/releases/download/v${version}/HavenCity-Portable-${version}-x64.exe`,
  }],
});
await mkdir(out, { recursive: true });
const browser = await chromium.launch({headless: true, ...(process.env.HAVEN_CHROME_PATH ? {executablePath: process.env.HAVEN_CHROME_PATH} : {})});
const context = await browser.newContext({viewport: {width: 1600, height: 1000}, deviceScaleFactor: 1});
const page = await context.newPage();
page.setDefaultTimeout(9000);
const checks = [], errors = [], failedRequests = [], apiRequests = [], unexpectedExternalRequests = [];
let mock = {status: 200, body: release()};
let armedRequest;
page.on('pageerror', error => errors.push(error.stack || String(error)));
page.on('requestfailed', request => failedRequests.push({url: request.url(), error: request.failure()?.errorText}));
page.on('request', request => {
  const requestUrl = new URL(request.url());
  if (!['http:', 'https:'].includes(requestUrl.protocol)) return;
  if (requestUrl.href === apiUrl || ['localhost', '127.0.0.1', '[::1]'].includes(requestUrl.hostname)) return;
  // If a hosted build is supplied, its own static assets are still allowed.
  if (requestUrl.origin === new URL(url).origin && requestUrl.origin !== 'null') return;
  unexpectedExternalRequests.push(requestUrl.href);
});
await page.route('https://api.github.com/repos/**/releases/latest', async route => {
  const response = structuredClone(mock);
  apiRequests.push({url: route.request().url(), method: route.request().method(), status: response.status});
  const fulfill = () => route.fulfill({
    status: response.status,
    headers: {'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store'},
    body: JSON.stringify(response.body),
  });
  if (armedRequest) {
    const resolveRequest = armedRequest;
    armedRequest = undefined;
    // Hold the response so the actual transient checking UI is testable without timing guesses.
    await new Promise(resume => resolveRequest({finish: async () => { await fulfill(); resume(); }}));
  } else await fulfill();
});
const check = (name, condition, detail) => {
  assert.ok(condition, `${name}: ${JSON.stringify(detail)}`);
  checks.push({name, passed: true, ...(detail === undefined ? {} : {detail})});
  console.log('PASS', name);
};
const snap = name => page.screenshot({path: resolve(out, `${name}.png`)});
const panel = () => page.locator('#update-state');
const checkButton = () => page.locator('#drawer [data-ui="check-update"]');
const status = name => page.locator(`#update-state .update-status.${name}`);
const safeLinks = async () => page.locator('#update-state a').evaluateAll(links => links.map(link => ({href: link.href, target: link.target, rel: link.rel})));

async function boot(scenario, viewport = {width: 1600, height: 1000}) {
  mock = scenario;
  const before = apiRequests.length;
  await page.setViewportSize(viewport);
  await page.goto(url, {waitUntil: 'networkidle'});
  await page.waitForFunction(() => !!window.__HAVEN__);
  check('browser fallback has no native update bridge', await page.evaluate(() => !window.havenDesktop));
  await page.getByRole('button', {name: '游戏菜单', exact: true}).click();
  await panel().waitFor({state: 'visible'});
  // Let the existing save-restored toast leave the menu header before visual captures.
  await page.waitForFunction(() => !document.querySelector('#toast')?.classList.contains('visible'), null, {timeout: 7000});
  await page.waitForTimeout(250);
  check('opening the game and menu does not check or download automatically', apiRequests.length === before, {before, after: apiRequests.length});
  check('menu displays the configured running version', await page.locator('.update-heading').innerText().then(text => text.includes(`v${currentVersion}`)), {currentVersion});
}

async function clickCheck(label) {
  const before = apiRequests.length;
  let timeout;
  const request = new Promise((resolveRequest, reject) => {
    armedRequest = resolveRequest;
    timeout = setTimeout(() => { armedRequest = undefined; reject(new Error('The check button did not make a GitHub API request')); }, 9000);
  });
  try {
    const [, pending] = await Promise.all([checkButton().click(), request]);
    clearTimeout(timeout);
    await status('checking').waitFor({state: 'visible'});
    check(`${label}: shows checking and disables duplicate clicks`, await checkButton().isDisabled());
    check(`${label}: requests only the configured GitHub latest-release API`, apiRequests.length === before + 1 && apiRequests.at(-1).url === apiUrl && apiRequests.at(-1).method === 'GET', apiRequests.at(-1));
    await pending.finish();
  } finally { clearTimeout(timeout); }
}

async function assertReleaseLink(label) {
  const links = await safeLinks();
  check(`${label}: download link stays on this repository's exact release page`, links.length === 1 && links[0].href === `https://github.com/${repository}/releases/tag/v${newVersion}`, links);
  check(`${label}: release page opens separately with opener protection`, links[0]?.target === '_blank' && /\bnoopener\b/.test(links[0].rel) && /\bnoreferrer\b/.test(links[0].rel), links);
  check(`${label}: browser offers only the portable EXE release link`, await page.locator('#update-state button:not([data-ui="check-update"])').count() === 0 && /免安装 EXE/.test(await panel().innerText()) && /关闭游戏/.test(await panel().innerText()));
}

try {
  await boot({status: 200, body: release()});
  await snap('01-menu-before-check');
  await clickCheck('new stable version');
  await status('available').waitFor({state: 'visible'});
  check(`new stable ${newVersion} is visible`, (await panel().innerText()).includes(`v${newVersion}`));
  await assertReleaseLink('desktop');
  const afterAvailable = apiRequests.length;
  await page.locator('#drawer [data-ui="close-drawer"]').click();
  await page.getByRole('button', {name: '游戏菜单', exact: true}).click();
  await page.waitForTimeout(250);
  check('reopening the menu preserves the update without fetching or downloading', apiRequests.length === afterAvailable && await status('available').isVisible());
  await snap('02-new-stable-version');

  await boot({status: 200, body: release(currentVersion)});
  await clickCheck('current version');
  await status('current').waitFor({state: 'visible'});
  check(`current ${currentVersion} reports current without a download link`, (await panel().innerText()).includes('已是最新版本') && (await safeLinks()).length === 0);
  check('current version can be checked again', await checkButton().isEnabled());
  await snap('03-current-version');

  await boot({status: 503, body: {message: 'Service Unavailable'}});
  await clickCheck('HTTP 503');
  await status('error').waitFor({state: 'visible'});
  check('HTTP failure is explicit and allows retry', (await panel().innerText()).includes('503') && await checkButton().isEnabled());
  check('HTTP failure exposes no download link', (await safeLinks()).length === 0);
  await snap('04-network-error-retry');
  await clickCheck('repeated HTTP 503 retry');
  await status('error').waitFor({state: 'visible'});
  check('repeated failure leaves retry usable', await checkButton().isEnabled());
  mock = {status: 200, body: release(currentVersion)};
  await clickCheck('successful retry without reloading');
  await status('current').waitFor({state: 'visible'});
  check('retry recovers from HTTP errors in the same menu', await status('current').isVisible());

  const hostilePage = release();
  hostilePage.html_url = `https://github.com.evil.example/${repository}/releases/tag/v${newVersion}`;
  await boot({status: 200, body: hostilePage});
  await clickCheck('unsafe release page');
  await status('error').waitFor({state: 'visible'});
  check('unsafe release page becomes an error and never a clickable link', (await safeLinks()).length === 0);
  await snap('05-unsafe-release-rejected');
  const hostileAsset = release();
  hostileAsset.assets[0].browser_download_url = `https://github.com/another-owner/${config.repo}/releases/download/v${newVersion}/HavenCity-Portable-${newVersion}-x64.exe`;
  mock = {status: 200, body: hostileAsset};
  await clickCheck('foreign portable EXE repository');
  await status('error').waitFor({state: 'visible'});
  check('a valid release page cannot authorize a foreign portable EXE', (await safeLinks()).length === 0 && await checkButton().isEnabled());

  await boot({status: 200, body: release()}, {width: 390, height: 844});
  await clickCheck('mobile new stable version');
  await status('available').waitFor({state: 'visible'});
  await assertReleaseLink('mobile');
  const releaseLink = page.locator('#update-state [data-ui="release-link"]');
  await releaseLink.scrollIntoViewIfNeeded();
  const layout = await page.evaluate(() => {
    const drawer = document.querySelector('#drawer'), update = document.querySelector('.update-panel');
    const rect = drawer.getBoundingClientRect();
    return {
      viewport: {width: innerWidth, height: innerHeight}, documentWidth: document.documentElement.scrollWidth,
      drawer: {x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, clientWidth: drawer.clientWidth, scrollWidth: drawer.scrollWidth},
      update: {clientWidth: update.clientWidth, scrollWidth: update.scrollWidth},
      buttonFonts: [...update.querySelectorAll('button,a')].map(button => Number.parseFloat(getComputedStyle(button).fontSize)),
    };
  });
  check('390px menu and update panel have no horizontal overflow', layout.documentWidth <= 390 && layout.drawer.x >= 0 && layout.drawer.right <= 390 && layout.drawer.scrollWidth <= layout.drawer.clientWidth && layout.update.scrollWidth <= layout.update.clientWidth, layout);
  check('mobile drawer stays within the viewport', layout.drawer.y >= 0 && layout.drawer.bottom <= 844, layout.drawer);
  check('mobile update controls keep readable type', layout.buttonFonts.length > 0 && layout.buttonFonts.every(size => size >= 12), layout.buttonFonts);
  const linkCanBeTapped = await releaseLink.evaluate(link => {
    const rect = link.getBoundingClientRect();
    return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('[data-ui="release-link"]') === link;
  });
  check('mobile download link is reachable and unobstructed inside the scrolling menu', await releaseLink.isVisible() && linkCanBeTapped);
  await snap('06-mobile-new-stable-version');
  await page.locator('#drawer .menu-footer').scrollIntoViewIfNeeded();
  check('mobile menu footer remains reachable by scrolling', await page.locator('#drawer .menu-footer').isVisible());
  await snap('07-mobile-menu-footer');

  check('all update checks stayed within the configured API', apiRequests.every(request => request.url === apiUrl && request.method === 'GET'), apiRequests);
  check('no external download or unauthorized host was requested', unexpectedExternalRequests.length === 0, unexpectedExternalRequests);
  check('no browser runtime errors', errors.length === 0, errors);
  check('all local resources and mocked API requests completed', failedRequests.length === 0, failedRequests);
  const report = {passed: checks.length, url, repository, currentVersion, newVersion, checks, errors, failedRequests, apiRequests, unexpectedExternalRequests};
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  await Promise.all([rm(resolve(out, 'failure.json'), {force: true}), rm(resolve(out, 'failure.png'), {force: true})]);
  console.log(JSON.stringify({passed: checks.length, requests: apiRequests.length, screenshots: out}, null, 2));
} catch (error) {
  await snap('failure').catch(() => {});
  await writeFile(resolve(out, 'failure.json'), JSON.stringify({error: error.stack || String(error), checks, errors, failedRequests, apiRequests, unexpectedExternalRequests, menu: await panel().innerText().catch(() => null)}, null, 2));
  throw error;
} finally { await browser.close(); }
