import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, GameUpdater, normalizeRelease, queryLatestRelease, type HavenDesktopBridge, type UpdateState } from '../src/updater.ts';

const repository = { owner: 'haven-city', repo: 'haven-city' };
const config = { ...repository, version: '1.2.3' };
const release = (tag = 'v1.3.0') => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  html_url: `https://github.com/haven-city/haven-city/releases/tag/${tag}`,
  assets: [{
    name: 'HavenCity-Setup.exe',
    browser_download_url: `https://github.com/haven-city/haven-city/releases/download/${tag}/HavenCity-Setup.exe`,
    content_type: 'application/octet-stream',
    state: 'uploaded',
  }],
});
const respond = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
})) as typeof fetch;
const settled = () => new Promise<void>(resolve => setImmediate(resolve));
function desktopBridge(overrides: Partial<HavenDesktopBridge> = {}) {
  const calls = { get: 0, check: 0, download: 0, install: 0, unsubscribe: 0 };
  let listener: ((state: UpdateState) => void) | undefined;
  const bridge: HavenDesktopBridge = {
    version: config.version,
    async getUpdateState() { calls.get++; return { status: 'idle' }; },
    async checkForUpdates() { calls.check++; return { status: 'available', version: '1.3.0' }; },
    async downloadUpdate() { calls.download++; return { status: 'downloaded', version: '1.3.0' }; },
    async installUpdate() { calls.install++; },
    onUpdateState(callback) { listener = callback; return () => { calls.unsubscribe++; listener = undefined; }; },
    ...overrides,
  };
  return { bridge, calls, emit: (state: UpdateState) => listener?.(state) };
}

test('semantic versions compare numeric components and ignore v prefix and build metadata', () => {
  assert.equal(compareVersions('1.10.0', '1.9.99'), 1);
  assert.equal(compareVersions('2.0.0', '10.0.0'), -1);
  assert.equal(compareVersions('v1.2.3+windows.7', '1.2.3+other'), 0);
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
});

test('semantic prerelease precedence respects numeric identifiers and stable versions', () => {
  const ordered = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0'];
  for (let i = 1; i < ordered.length; i++) {
    assert.equal(compareVersions(ordered[i - 1], ordered[i]), -1);
    assert.equal(compareVersions(ordered[i], ordered[i - 1]), 1);
  }
});

test('invalid semantic versions fail closed instead of being compared as updates', () => {
  for (const invalid of ['', '1', '1.2', '01.2.3', '1.2.03', '1.2.3-alpha.01', 'latest', '1.2.3.4', '1.2.3-', '1.2.3+']) {
    assert.equal(compareVersions(invalid, '1.2.3'), null, invalid);
    assert.equal(compareVersions('1.2.3', invalid), null, invalid);
  }
});

test('release normalization selects a stable Windows installer from the configured repository', () => {
  const normalized = normalizeRelease(release(), repository);
  assert.ok(normalized);
  assert.equal(compareVersions(normalized.version, '1.3.0'), 0);
  assert.equal(normalized.assetName, 'HavenCity-Setup.exe');
  assert.equal(normalized.releaseUrl, 'https://github.com/haven-city/haven-city/releases/tag/v1.3.0');
  assert.equal(normalized.assetUrl, 'https://github.com/haven-city/haven-city/releases/download/v1.3.0/HavenCity-Setup.exe');
});

test('drafts, prereleases, prerelease tags and missing EXE assets are rejected', () => {
  assert.equal(normalizeRelease({ ...release(), draft: true }, repository), null);
  assert.equal(normalizeRelease({ ...release(), prerelease: true }, repository), null);
  assert.equal(normalizeRelease(release('v2.0.0-rc.1'), repository), null);
  assert.equal(normalizeRelease(release('latest'), repository), null);
  assert.equal(normalizeRelease({ ...release(), assets: [] }, repository), null);
  const zipped = release(); zipped.assets[0].name = 'HavenCity.zip';
  zipped.assets[0].browser_download_url = zipped.assets[0].browser_download_url.replace('HavenCity-Setup.exe', 'HavenCity.zip');
  assert.equal(normalizeRelease(zipped, repository), null);
  assert.equal(normalizeRelease(null, repository), null);
  assert.equal(normalizeRelease({ html_url: 1, assets: 'wrong' }, repository), null);
});

test('installer links reject unsafe schemes, credentials, ports, lookalike hosts and foreign repositories', () => {
  const badUrls = [
    'javascript:alert(1)',
    'file:///C:/Windows/system32/cmd.exe',
    'http://github.com/haven-city/haven-city/releases/download/v1.3.0/HavenCity-Setup.exe',
    'https://github.com.evil.example/haven-city/haven-city/releases/download/v1.3.0/HavenCity-Setup.exe',
    'https://github.com@evil.example/haven-city/haven-city/releases/download/v1.3.0/HavenCity-Setup.exe',
    'https://user:password@github.com/haven-city/haven-city/releases/download/v1.3.0/HavenCity-Setup.exe',
    'https://github.com:444/haven-city/haven-city/releases/download/v1.3.0/HavenCity-Setup.exe',
    'https://github.com/someone-else/haven-city/releases/download/v1.3.0/HavenCity-Setup.exe',
    'https://github.com/haven-city/other-project/releases/download/v1.3.0/HavenCity-Setup.exe',
    'https://github.com/haven-city/haven-city/releases/download/v9.9.9/HavenCity-Setup.exe',
    'https://github.com/haven-city/haven-city/releases/download/v1.3.0/payload.zip',
    'https://github.com/haven-city/haven-city/releases/download/v1.3.0/HavenCity-Setup.exe?next=https://evil.example',
    'https://github.com/haven-city/haven-city/releases/download/v1.3.0/HavenCity-Setup.exe#payload',
    'https://github.com/haven-city/haven-city/releases/download/v1.3.0/HavenCity%2FSetup.exe',
    'https://github.com/haven-city/haven-city/releases/download/v1.3.0/HavenCity%5CSetup.exe',
  ];
  for (const url of badUrls) {
    const raw = release(); raw.assets[0].browser_download_url = url;
    assert.equal(normalizeRelease(raw, repository), null, url);
  }
});

test('release-page links must point at the same GitHub repository and exact release tag', () => {
  for (const url of [
    'https://evil.example/haven-city/haven-city/releases/tag/v1.3.0',
    'http://github.com/haven-city/haven-city/releases/tag/v1.3.0',
    'https://user@github.com/haven-city/haven-city/releases/tag/v1.3.0',
    'https://github.com:444/haven-city/haven-city/releases/tag/v1.3.0',
    'https://github.com/haven-city/other-project/releases/tag/v1.3.0',
    'https://github.com/haven-city/haven-city/releases/tag/v1.4.0',
    'https://github.com/haven-city/haven-city/issues/1',
  ]) assert.equal(normalizeRelease({ ...release(), html_url: url }, repository), null, url);
});

test('checking updates reports available only for a valid newer stable release', async () => {
  assert.equal((await queryLatestRelease(config, respond(release()))).status, 'available');
  assert.equal((await queryLatestRelease(config, respond(release('v1.2.3')))).status, 'current');
  assert.equal((await queryLatestRelease(config, respond(release('v1.0.0')))).status, 'current');
  assert.equal((await queryLatestRelease(config, respond(release('v2.0.0-beta.1')))).status, 'error');
});

test('unconfigured repositories do not make network requests', async () => {
  let requests = 0;
  const fetcher = (async () => { requests++; throw new Error('must not fetch'); }) as typeof fetch;
  assert.equal((await queryLatestRelease({ owner: '', repo: '', version: '1.2.3' }, fetcher)).status, 'unconfigured');
  assert.equal(requests, 0);
});

test('network errors, GitHub failures, invalid JSON and unsafe release responses become explicit error states', async () => {
  const offline = (async () => { throw new TypeError('network unavailable'); }) as typeof fetch;
  const invalidJSON = (async () => new Response('{broken', { status: 200 })) as typeof fetch;
  assert.equal((await queryLatestRelease(config, offline)).status, 'error');
  for (const status of [403, 404, 429, 503]) assert.equal((await queryLatestRelease(config, respond({ message: 'unavailable' }, status))).status, 'error');
  assert.equal((await queryLatestRelease(config, invalidJSON)).status, 'error');
  assert.equal((await queryLatestRelease(config, respond({ ...release(), assets: [] }))).status, 'error');
  assert.equal((await queryLatestRelease(config, respond({ ...release(), html_url: 'https://evil.example' }))).status, 'error');
});

test('browser updater makes its first network request only after an explicit check', async t => {
  const fetcher = t.mock.method(globalThis, 'fetch', respond(release()));
  const updater = new GameUpdater(undefined, config);
  await settled();
  assert.equal(updater.desktop, false);
  assert.equal(updater.getState().status, 'idle');
  assert.equal(fetcher.mock.callCount(), 0);
  assert.equal((await updater.check()).status, 'available');
  assert.equal(fetcher.mock.callCount(), 1);
  updater.dispose();
});

test('desktop updater reads its initial status without automatically checking, downloading or installing', async () => {
  const fixture = desktopBridge();
  const updater = new GameUpdater(fixture.bridge, config);
  await settled();
  assert.equal(updater.desktop, true);
  assert.deepEqual(fixture.calls, { get: 1, check: 0, download: 0, install: 0, unsubscribe: 0 });
  await updater.check();
  assert.equal(fixture.calls.check, 1);
  assert.equal(fixture.calls.download, 0);
  assert.equal(fixture.calls.install, 0);
  updater.dispose();
  assert.equal(fixture.calls.unsubscribe, 1);
});

test('download and installation each require the appropriate state and their own explicit action', async () => {
  const fixture = desktopBridge();
  const updater = new GameUpdater(fixture.bridge, config);
  await settled();
  await updater.download(); await updater.install();
  assert.equal(fixture.calls.download, 0);
  assert.equal(fixture.calls.install, 0);
  await updater.check(); await updater.install();
  assert.equal(fixture.calls.install, 0);
  assert.equal((await updater.download()).status, 'downloaded');
  assert.equal(fixture.calls.download, 1);
  assert.equal(fixture.calls.install, 0, 'finishing a download must not start an install');
  await updater.download();
  assert.equal(fixture.calls.download, 1, 'a completed update must not download again');
  await updater.install();
  assert.equal(fixture.calls.install, 1);
  updater.dispose();
});

test('desktop progress and links are sanitized before reaching subscribers', async () => {
  const fixture = desktopBridge();
  const updater = new GameUpdater(fixture.bridge, config);
  await settled();
  const states: UpdateState[] = [];
  const unsubscribe = updater.subscribe(state => states.push(state));
  fixture.emit({ status: 'downloading', progress: -8, releaseUrl: 'https://evil.example/update' });
  assert.equal(states.at(-1)?.progress, 0);
  assert.equal(states.at(-1)?.releaseUrl, undefined);
  fixture.emit({ status: 'downloading', progress: 108, releaseUrl: release().html_url });
  assert.equal(states.at(-1)?.progress, 100);
  assert.equal(states.at(-1)?.releaseUrl, release().html_url);
  fixture.emit({ status: 'downloading', progress: NaN, releaseUrl: 'https://github.com/other/repo/releases/latest' });
  assert.equal(states.at(-1)?.progress, undefined);
  assert.equal(states.at(-1)?.releaseUrl, undefined);
  fixture.emit({ status: 'unknown' } as unknown as UpdateState);
  assert.equal(states.at(-1)?.status, 'error');
  const snapshot = updater.getState(); snapshot.status = 'downloaded';
  assert.equal(updater.getState().status, 'error', 'callers cannot mutate internal update status');
  unsubscribe();
  const count = states.length;
  fixture.emit({ status: 'idle' });
  assert.equal(states.length, count);
  updater.dispose();
});

test('a delayed initial bridge status cannot replace a newer explicit check result', async () => {
  let resolveInitial!: (value: UpdateState) => void;
  const initial = new Promise<UpdateState>(resolve => { resolveInitial = resolve; });
  const fixture = desktopBridge({ getUpdateState: () => initial });
  const updater = new GameUpdater(fixture.bridge, config);
  await settled();
  assert.equal((await updater.check()).status, 'available');
  resolveInitial({ status: 'idle' });
  await settled();
  assert.equal(updater.getState().status, 'available');
  assert.equal(updater.getState().version, '1.3.0');
  updater.dispose();
});

test('download and install rejections become errors and permit a fresh check and retry', async () => {
  let downloads = 0, installs = 0;
  const fixture = desktopBridge({
    async downloadUpdate() {
      if (++downloads === 1) throw new Error('download failed');
      return { status: 'downloaded', version: '1.3.0' };
    },
    async installUpdate() { if (++installs === 1) throw new Error('install failed'); },
  });
  const updater = new GameUpdater(fixture.bridge, config);
  await settled();
  await updater.check();
  assert.equal((await updater.download()).status, 'error');
  assert.equal((await updater.check()).status, 'available');
  assert.equal((await updater.download()).status, 'downloaded');
  await updater.install();
  assert.equal(updater.getState().status, 'error');
  assert.equal((await updater.check()).status, 'available');
  assert.equal((await updater.download()).status, 'downloaded');
  await updater.install();
  assert.equal(updater.getState().status, 'downloaded');
  assert.equal(downloads, 3);
  assert.equal(installs, 2);
  updater.dispose();
});
