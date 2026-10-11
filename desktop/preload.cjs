const {contextBridge,ipcRenderer}=require('electron');
if(process.isMainFrame)contextBridge.exposeInMainWorld('micoDesktop',Object.freeze({
 version:'0.6.0',
 setup:(provider,engine)=>ipcRenderer.invoke('mico:setup',provider,engine),
 cancelSetup:()=>ipcRenderer.invoke('mico:cancel'),
 providerStatus:()=>ipcRenderer.invoke('mico:status'),
 refreshModels:()=>ipcRenderer.invoke('mico:refresh-models'),
 restoreConnection:()=>ipcRenderer.invoke('mico:restore'),
 openDashboard:provider=>ipcRenderer.invoke('mico:dashboard',provider),
 stopProvider:provider=>ipcRenderer.invoke('mico:stop',provider),
 appearance:theme=>ipcRenderer.invoke('mico:appearance',theme),
 openFolder:()=>ipcRenderer.invoke('mico:open-folder'),
 applyFolderChanges:(folder,changes)=>ipcRenderer.invoke('mico:apply-folder',folder,changes),
 onProgress:callback=>{const listener=(_event,progress)=>callback(progress);ipcRenderer.on('mico:progress',listener);return()=>ipcRenderer.removeListener('mico:progress',listener)},
}));
