'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdateController } = require('../update-controller.cjs');

const release = { configured: true, owner: 'example', repo: 'haven-city', releaseUrl: 'https://github.com/example/haven-city/releases/latest' };

function fixture(overrides = {}) {
  const updater = new EventEmitter();
  const calls = [];
  updater.checkForUpdates = async () => { calls.push('check'); updater.emit('update-available', { version: '0.4.0' }); };
  updater.downloadUpdate = async () => { calls.push('download'); updater.emit('download-progress', { percent: 48.5 }); updater.emit('update-downloaded', { version: '0.4.0' }); };
  updater.quitAndInstall = (silent, runAfter) => { calls.push(['install', silent, runAfter]); };
  const controller = createUpdateController({
    release, isPackaged: true, isPortable: false,
    createUpdater: () => { calls.push('create'); return updater; },
    publish: state => calls.push(['state', state]),
    openRelease: async url => calls.push(['open', url]),
    prepareInstall: async () => calls.push('save'),
    confirmInstall: async () => { calls.push('confirm'); return true; },
    ...overrides
  });
  return { controller, updater, calls };
}

test('startup is offline; renderer snapshot is isolated; unavailable config never creates an updater', async () => {
  const f = fixture();
  assert.deepEqual(f.calls, []);
  const state = f.controller.getState(); state.status = 'error';
  assert.equal(f.controller.getState().status, 'idle');
  const noConfig = fixture({ release: { configured: false } });
  assert.equal((await noConfig.controller.checkForUpdates()).status, 'unconfigured');
  assert.deepEqual(noConfig.calls, []);
  const development = fixture({ isPackaged: false });
  assert.equal((await development.controller.checkForUpdates()).status, 'unconfigured');
  assert.deepEqual(development.calls, []);
});

test('concurrent checks share one operation; checks never download or install', async () => {
  const { controller, updater, calls } = fixture();
  const states = await Promise.all([controller.checkForUpdates(), controller.checkForUpdates()]);
  assert.equal(calls.filter(call => call === 'check').length, 1);
  assert.equal(states[0].status, 'available'); assert.equal(states[1].version, '0.4.0');
  assert.equal(updater.autoDownload, false); assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowPrerelease, false); assert.equal(updater.allowDowngrade, false);
  assert.equal(calls.includes('download'), false);
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'install'), false);
});

test('download emits progress, requires confirmation, saves before explicit installation', async () => {
  const { controller, calls } = fixture();
  await controller.downloadUpdate();
  assert.deepEqual(calls, []);
  await controller.checkForUpdates();
  await Promise.all([controller.downloadUpdate(), controller.downloadUpdate()]);
  assert.equal(calls.filter(call => call === 'download').length, 1);
  assert.equal(controller.getState().status, 'downloaded');
  assert.ok(calls.some(call => Array.isArray(call) && call[0] === 'state' && call[1].progress === 48.5));
  await controller.installUpdate(); await new Promise(resolve => setImmediate(resolve));
  assert.ok(calls.indexOf('confirm') < calls.indexOf('save'));
  const installation = calls.findIndex(call => Array.isArray(call) && call[0] === 'install');
  assert.ok(calls.indexOf('save') < installation);
  assert.deepEqual(calls[installation], ['install', false, true]);
});

test('cancelled installation can be requested again without downloading twice', async () => {
  let attempts = 0;
  const { controller, calls } = fixture({ confirmInstall: async () => ++attempts > 1 });
  await controller.checkForUpdates(); await controller.downloadUpdate();
  await controller.installUpdate(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.includes('save'), false);
  assert.equal(controller.getState().status, 'downloaded');
  await controller.installUpdate(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(attempts, 2); assert.ok(calls.includes('save'));
});

test('portable checks but opens the release page rather than installing NSIS', async () => {
  const { controller, calls } = fixture({ isPortable: true });
  await controller.checkForUpdates();
  assert.equal((await controller.downloadUpdate()).status, 'available');
  assert.ok(calls.some(call => Array.isArray(call) && call[0] === 'open' && call[1] === release.releaseUrl));
  await controller.installUpdate();
  assert.equal(calls.includes('download'), false); assert.equal(calls.includes('save'), false);
});

test('network failure becomes a bounded state and can be retried', async () => {
  const { controller, updater } = fixture();
  updater.checkForUpdates = async () => { throw new Error('offline'); };
  assert.equal((await controller.checkForUpdates()).status, 'error');
  assert.match(controller.getState().message, /offline/);
  updater.checkForUpdates = async () => updater.emit('update-not-available', { version: '0.3.0' });
  assert.equal((await controller.checkForUpdates()).status, 'current');
});

test('save failure prevents installing the downloaded update', async () => {
  const { controller, calls } = fixture({ prepareInstall: async () => { throw new Error('save failed'); } });
  await controller.checkForUpdates(); await controller.downloadUpdate();
  await controller.installUpdate(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(controller.getState().status, 'error');
  assert.equal(calls.some(call => Array.isArray(call) && call[0] === 'install'), false);
});
