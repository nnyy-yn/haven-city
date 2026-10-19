'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

test('sandbox preload exposes only fixed updater calls and never forwards IPC event objects', async () => {
  const ipc = new EventEmitter();
  const invocations = [];
  ipc.invoke = async channel => { invocations.push(channel); return { status: 'idle' }; };
  let api;
  const source = fs.readFileSync(path.join(__dirname, '..', 'preload.cjs'), 'utf8');
  vm.runInNewContext(source, {
    process: { argv: ['app', '--haven-version=0.3.0'] },
    require: name => {
      assert.equal(name, 'electron');
      return { contextBridge: { exposeInMainWorld: (key, value) => { assert.equal(key, 'havenDesktop'); api = value; } }, ipcRenderer: ipc };
    }
  });
  assert.deepEqual(Object.keys(api), ['version', 'getUpdateState', 'checkForUpdates', 'downloadUpdate', 'installUpdate', 'onUpdateState']);
  assert.equal(api.version, '0.3.0'); assert.equal(Object.isFrozen(api), true);
  await api.getUpdateState(); await api.checkForUpdates(); await api.downloadUpdate(); await api.installUpdate();
  assert.deepEqual(invocations, ['haven:update:get', 'haven:update:check', 'haven:update:download', 'haven:update:install']);
  const received = [];
  const unsubscribe = api.onUpdateState((...args) => received.push(args));
  ipc.emit('haven:update:state', { privileged: true }, { status: 'current' });
  assert.deepEqual(received, [[{ status: 'current' }]]);
  unsubscribe(); assert.equal(ipc.listenerCount('haven:update:state'), 0);
  assert.throws(() => api.onUpdateState('not a callback'), /回调/);
});
