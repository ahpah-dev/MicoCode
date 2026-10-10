const {contextBridge,ipcRenderer}=require('electron');
if(process.isMainFrame)contextBridge.exposeInMainWorld('micoDesktop',Object.freeze({
 version:'0.3.1',
 setup:(provider,engine)=>ipcRenderer.invoke('mico:setup',provider,engine),
 cancelSetup:()=>ipcRenderer.invoke('mico:cancel'),
 providerStatus:()=>ipcRenderer.invoke('mico:status'),
 restoreConnection:()=>ipcRenderer.invoke('mico:restore'),
 openDashboard:provider=>ipcRenderer.invoke('mico:dashboard',provider),
 stopProvider:provider=>ipcRenderer.invoke('mico:stop',provider),
 appearance:theme=>ipcRenderer.invoke('mico:appearance',theme),
 onProgress:callback=>{const listener=(_event,progress)=>callback(progress);ipcRenderer.on('mico:progress',listener);return()=>ipcRenderer.removeListener('mico:progress',listener)},
}));
