'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const versionArgument = process.argv.find(argument => argument.startsWith('--haven-version='));
const version = versionArgument ? versionArgument.slice('--haven-version='.length) : '0.3.0';

contextBridge.exposeInMainWorld('havenDesktop', Object.freeze({
  version,
  getUpdateState: () => ipcRenderer.invoke('haven:update:get'),
  checkForUpdates: () => ipcRenderer.invoke('haven:update:check'),
  downloadUpdate: () => ipcRenderer.invoke('haven:update:download'),
  installUpdate: () => ipcRenderer.invoke('haven:update:install'),
  onUpdateState(callback) {
    if (typeof callback !== 'function') throw new TypeError('需要更新状态回调函数');
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('haven:update:state', listener);
    return () => ipcRenderer.removeListener('haven:update:state', listener);
  }
}));
