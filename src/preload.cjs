'use strict';
// Jembatan aman antara jendela (renderer) dan proses utama.
const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel) => (cb) => {
  ipcRenderer.on(channel, (_event, payload) => cb(payload));
};

contextBridge.exposeInMainWorld('api', {
  init: () => ipcRenderer.invoke('init'),
  connect: (user) => ipcRenderer.invoke('connect', user),
  disconnect: () => ipcRenderer.invoke('disconnect'),
  demo: () => ipcRenderer.invoke('demo'),
  set: (patch) => ipcRenderer.send('settings:set', patch),
  preset: (name) => ipcRenderer.send('win:preset', name),
  resizeTo: (w, h) => ipcRenderer.send('win:resize', w, h),
  minimize: () => ipcRenderer.send('win:minimize'),
  close: () => ipcRenderer.send('win:close'),
  relaunch: () => ipcRenderer.send('app:relaunch'),
  onBatch: listen('batch'),
  onStatus: listen('status'),
  onState: listen('state'),
  onReset: listen('reset'),
});
