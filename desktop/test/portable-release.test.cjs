'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkPortableRelease } = require('../portable-release.cjs');
const release = { configured: true, owner: 'haven-city', repo: 'haven-city' };
const fixture = (tag = 'v0.4.0') => {
  const name = `HavenCity-Portable-${tag.replace(/^v/, '')}-x64.exe`;
  return { tag_name: tag, draft: false, prerelease: false, assets: [{ name, state: 'uploaded', size: 123456,
    browser_download_url: `https://github.com/haven-city/haven-city/releases/download/${tag}/${name}` }] };
};
const respond = (body, status = 200) => async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('Portable latest checks use only the fixed unauthenticated GitHub endpoint and a bounded abort signal', async () => {
  const requests = [];
  const fetcher = async (...args) => { requests.push(args); return new Response(JSON.stringify(fixture())); };
  assert.deepEqual(await checkPortableRelease(release, '0.3.0', fetcher), { version: '0.4.0', available: true });
  assert.equal(requests.length, 1);
  const [url, options] = requests[0];
  assert.equal(url, 'https://api.github.com/repos/haven-city/haven-city/releases/latest');
  assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
  assert.equal(options.headers.Accept, 'application/vnd.github+json');
  assert.equal(Object.keys(options.headers).some(key => /authorization|token|cookie/i.test(key)), false);
  assert.ok(options.signal instanceof AbortSignal); assert.equal(options.signal.aborted, false);
});

test('equal and older stable versions stay current and numeric components compare without downgrades', async () => {
  assert.deepEqual(await checkPortableRelease(release, '0.4.0', respond(fixture())), { version: '0.4.0', available: false });
  assert.deepEqual(await checkPortableRelease(release, '0.5.0', respond(fixture())), { version: '0.5.0', available: false });
  assert.deepEqual(await checkPortableRelease(release, '0.9.0', respond(fixture('v0.10.0'))), { version: '0.10.0', available: true });
  assert.deepEqual(await checkPortableRelease(release, '0.4.0+local', respond(fixture('0.4.0+other'))), { version: '0.4.0+local', available: false });
});

test('only an exact uploaded nonempty Portable x64 EXE asset qualifies as an update', async () => {
  const bad = [
    body => { body.assets = []; },
    body => { body.assets[0].name = 'HavenCity-Setup-0.4.0-x64.exe'; },
    body => { body.assets[0].name = 'HavenCity-Portable-0.4.0-arm64.exe'; },
    body => { body.assets[0].name = 'HavenCity-Portable-0.4.0-x64.zip'; },
    body => { body.assets[0].state = 'new'; },
    body => { body.assets[0].size = 0; },
    body => { body.assets[0].size = '123'; },
    body => { body.assets[0].size = Infinity; },
  ];
  for (const change of bad) { const body = fixture(); change(body); await assert.rejects(checkPortableRelease(release, '0.3.0', respond(body)), /缺少有效/); }
});

test('drafts, prereleases, malformed versions and unsafe numeric versions are rejected', async () => {
  for (const body of [{ ...fixture(), draft: true }, { ...fixture(), prerelease: true }, { ...fixture(), prerelease: undefined }]) {
    await assert.rejects(checkPortableRelease(release, '0.3.0', respond(body)), /正式发行/);
  }
  for (const tag of ['v0.5.0-rc.1', '0.4', '01.4.0', 'latest', '0.4.0.1', '9007199254740992.0.0', '1'.repeat(121) + '.0.0']) {
    await assert.rejects(checkPortableRelease(release, '0.3.0', respond(fixture(tag))), /缺少有效/);
  }
});

test('Portable assets reject foreign hosts, schemes, credentials, ports, repositories, tags and filenames', async () => {
  const file = 'HavenCity-Portable-0.4.0-x64.exe';
  const unsafe = [
    `http://github.com/haven-city/haven-city/releases/download/v0.4.0/${file}`,
    `https://evil.example/haven-city/haven-city/releases/download/v0.4.0/${file}`,
    `https://github.com.evil.example/haven-city/haven-city/releases/download/v0.4.0/${file}`,
    `https://github.com@evil.example/haven-city/haven-city/releases/download/v0.4.0/${file}`,
    `https://user:pass@github.com/haven-city/haven-city/releases/download/v0.4.0/${file}`,
    `https://github.com:444/haven-city/haven-city/releases/download/v0.4.0/${file}`,
    `https://github.com:443/haven-city/haven-city/releases/download/v0.4.0/${file}`,
    `https://github.com/other/haven-city/releases/download/v0.4.0/${file}`,
    `https://github.com/haven-city/other/releases/download/v0.4.0/${file}`,
    `https://github.com/haven-city/haven-city/releases/download/v0.5.0/${file}`,
    `https://github.com/haven-city/haven-city/releases/download/v0.4.0/HavenCity-Setup-0.4.0-x64.exe`,
    `https://github.com/haven-city/haven-city/releases/download/v0.4.0/${file}?token=secret`,
    `https://github.com/haven-city/haven-city/releases/download/v0.4.0/${file}#asset`,
    `https://github.com/haven-city/haven-city/releases/download/v0.4.0/HavenCity%2FPortable-0.4.0-x64.exe`,
    'javascript:alert(1)', 'file:///C:/Windows/cmd.exe',
  ];
  for (const url of unsafe) { const body = fixture(); body.assets[0].browser_download_url = url; await assert.rejects(checkPortableRelease(release, '0.3.0', respond(body)), /缺少有效/, url); }
});

test('HTTP failures, timeout, network errors and invalid JSON have readable failure messages', async () => {
  for (const status of [403, 404, 429, 500]) await assert.rejects(checkPortableRelease(release, '0.3.0', respond({}, status)), /GitHub|公开发布|HTTP/);
  await assert.rejects(checkPortableRelease(release, '0.3.0', async () => { throw new Error('offline'); }), /无法连接 GitHub/);
  await assert.rejects(checkPortableRelease(release, '0.3.0', async () => { throw new DOMException('expired', 'TimeoutError'); }), /超时/);
  await assert.rejects(checkPortableRelease(release, '0.3.0', async () => new Response('{bad')), /无法读取/);
});

test('unconfigured repositories and invalid local versions fail before any network request', async () => {
  let requests = 0;
  const fetcher = async () => { requests++; throw new Error('must not fetch'); };
  for (const config of [null, { ...release, configured: false }, { ...release, owner: '' }, { ...release, owner: 'a/b' }, { ...release, repo: '..' }]) {
    await assert.rejects(checkPortableRelease(config, '0.3.0', fetcher), /未配置/);
  }
  await assert.rejects(checkPortableRelease(release, '0.3.0-beta', fetcher), /当前游戏版本无效/);
  assert.equal(requests, 0);
});

const latestPage = 'https://github.com/haven-city/haven-city/releases/latest';
const tagPage = tag => `https://github.com/haven-city/haven-city/releases/tag/${tag}`;
const assetPage = tag => `https://github.com/haven-city/haven-city/releases/download/${tag}/HavenCity-Portable-${tag.replace(/^v/, '')}-x64.exe`;
const assetRedirect = 'https://release-assets.githubusercontent.com/github-production-release-asset/123/asset?signature=test';
const redirect = (location, status = 302) => new Response(null, { status, headers: { Location: location } });
function limitedFetcher({ status = 403, tag = 'v0.5.0', pageLocation = tagPage(tag), assetLocation = assetRedirect, assetStatus = 302 } = {}) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return new Response(null, { status });
    if (calls.length === 2) { assert.equal(url, latestPage); return redirect(pageLocation); }
    assert.equal(calls.length, 3, 'the signed asset redirect must never be followed');
    assert.equal(url, assetPage(tag));
    return redirect(assetLocation, assetStatus);
  };
  return { fetcher, calls };
}

test('API rate limits fall back to public HEAD checks with one shared fifteen-second signal and no download', async t => {
  const signal = new AbortController().signal;
  let timeouts = 0;
  t.mock.method(AbortSignal, 'timeout', milliseconds => { assert.equal(milliseconds, 15000); timeouts++; return signal; });
  for (const status of [403, 429]) {
    const { fetcher, calls } = limitedFetcher({ status });
    assert.deepEqual(await checkPortableRelease(release, '0.4.0', fetcher), { version: '0.5.0', available: true });
    assert.equal(calls.length, 3);
    assert.equal(calls[0].url, 'https://api.github.com/repos/haven-city/haven-city/releases/latest');
    for (const { url, options } of calls) {
      assert.ok(['api.github.com', 'github.com'].includes(new URL(url).hostname));
      assert.equal(options.signal, signal); assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store');
      assert.equal(Object.keys(options.headers || {}).some(key => /authorization|token|cookie/i.test(key)), false);
    }
    for (const { options } of calls.slice(1)) { assert.equal(options.method, 'HEAD'); assert.equal(options.redirect, 'manual'); }
  }
  assert.equal(timeouts, 2, 'each check shares one timeout across all of its requests');
});

test('public fallback equal and older releases remain current while all supported asset redirects work', async () => {
  for (const [tag, status] of [['v0.4.0', 302], ['v0.3.0', 303], ['v0.2.0', 307]]) {
    const f = limitedFetcher({ tag, assetStatus: status });
    assert.deepEqual(await checkPortableRelease(release, '0.4.0', f.fetcher), { version: '0.4.0', available: false });
    assert.equal(f.calls.length, 3);
  }
});

test('public latest fallback rejects cross-repository, unsafe and prerelease tag redirects before requesting an asset', async () => {
  for (const location of [
    'https://evil.example/haven-city/haven-city/releases/tag/v0.5.0',
    'http://github.com/haven-city/haven-city/releases/tag/v0.5.0',
    'https://github.com/other/haven-city/releases/tag/v0.5.0',
    'https://github.com/haven-city/other/releases/tag/v0.5.0',
    'https://user@github.com/haven-city/haven-city/releases/tag/v0.5.0',
    'https://github.com:443/haven-city/haven-city/releases/tag/v0.5.0',
    'https://github.com/haven-city/haven-city/releases/tag/v0.5.0?next=evil',
    'https://github.com/haven-city/haven-city/releases/tag/v0.5.0#asset',
    'https://github.com/haven-city/haven-city/releases/tag/v0.5.0-rc.1',
    'https://github.com/haven-city/haven-city/releases/tag/9007199254740992.0.0',
    'https://github.com/haven-city/haven-city/releases/tag/v0.5.0%2Fevil',
    'https://github.com/haven-city/haven-city/issues/1',
  ]) {
    const f = limitedFetcher({ pageLocation: location });
    await assert.rejects(checkPortableRelease(release, '0.4.0', f.fetcher), /公开发行页/);
    assert.equal(f.calls.length, 2, location);
  }
});

test('public asset fallback rejects missing files and untrusted redirect destinations without following them', async () => {
  for (const location of [
    'https://evil.example/asset.exe',
    'https://release-assets.githubusercontent.com.evil.example/asset',
    'http://release-assets.githubusercontent.com/asset',
    'https://user:password@release-assets.githubusercontent.com/asset',
    'https://release-assets.githubusercontent.com:443/asset',
    'https://release-assets.githubusercontent.com:444/asset',
    'https://release-assets.githubusercontent.com/asset#payload',
    'https://github.com/haven-city/haven-city/releases/download/v0.5.0/asset.exe',
    'file:///C:/payload.exe',
  ]) {
    const f = limitedFetcher({ assetLocation: location });
    await assert.rejects(checkPortableRelease(release, '0.4.0', f.fetcher), /缺少有效/);
    assert.equal(f.calls.length, 3);
    assert.ok(f.calls.every(call => ['api.github.com', 'github.com'].includes(new URL(call.url).hostname)));
  }
  for (const status of [200, 301, 308, 404, 500]) {
    const f = limitedFetcher({ assetStatus: status });
    await assert.rejects(checkPortableRelease(release, '0.4.0', f.fetcher), /缺少有效/);
  }
});

test('invalid API data and ordinary API failures never trigger the public fallback', async () => {
  for (const [body, status] of [[{ ...fixture(), draft: true }, 200], [fixture('v0.5.0-rc.1'), 200], [{ ...fixture(), assets: [] }, 200], [{}, 500]]) {
    let calls = 0;
    const fetcher = async () => { calls++; return new Response(JSON.stringify(body), { status }); };
    await assert.rejects(checkPortableRelease(release, '0.4.0', fetcher));
    assert.equal(calls, 1);
  }
});

test('public fallback request failures keep readable timeout and network messages', async () => {
  for (const failAt of [2, 3]) {
    let calls = 0;
    const fetcher = async () => {
      calls++;
      if (calls === 1) return new Response(null, { status: 429 });
      if (calls === failAt) throw new DOMException('timeout', 'TimeoutError');
      return redirect(tagPage('v0.5.0'));
    };
    await assert.rejects(checkPortableRelease(release, '0.4.0', fetcher), /超时/);
    assert.equal(calls, failAt);
  }
  let calls = 0;
  await assert.rejects(checkPortableRelease(release, '0.4.0', async () => {
    if (++calls === 1) return new Response(null, { status: 403 });
    throw new Error('offline');
  }), /无法连接 GitHub/);
});
