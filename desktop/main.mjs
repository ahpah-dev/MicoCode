import {app,BrowserWindow,ipcMain,nativeTheme,safeStorage,shell,session,dialog} from 'electron';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {ProviderManager,assertProvider} from './provider-manager.mjs';
import {createLocalServer,managedClientConnection} from './server.mjs';

const smoke=process.argv.includes('--smoke-test');
const smokePath=process.argv.find(x=>x.startsWith('--smoke-output='))?.slice('--smoke-output='.length);
const smokeProvider=process.argv.find(x=>x.startsWith('--smoke-provider='))?.slice('--smoke-provider='.length);
const testData=process.argv.find(x=>x.startsWith('--test-data='))?.slice('--test-data='.length);
if(smoke&&testData)app.setPath('userData',path.resolve(testData));
app.setAppUserModelId('app.micocode.desktop');
let window,manager,server,quitting=false;const dashboards=new Set();
const backgrounds={forest:'#111815',graphite:'#151515',midnight:'#101624',violet:'#191322',paper:'#f8f6ef'};
const allowedHosts=new Set(['micocode.vercel.app','github.com','openrouter.ai','docs.litellm.ai','ollama.com','docs.ollama.com','oai.aihorde.net','aihorde.net','nodejs.org']);
function safeExternal(url){try{const u=new URL(url);return u.protocol==='https:'&&allowedHosts.has(u.hostname)&&!u.username&&!u.password}catch{return false}}
async function createVault(dir){
 await mkdir(dir,{recursive:true});const file=path.join(dir,'credentials.bin');let values={};
 if(!safeStorage.isEncryptionAvailable())throw new Error('Windows credential encryption is unavailable. Restart Windows and try again.');
 try{values=JSON.parse(safeStorage.decryptString(await readFile(file)))}catch(e){if(e.code!=='ENOENT')throw new Error('MicoCode could not read its protected credentials. Your projects remain stored on this device.')}
 let writing=Promise.resolve();
 return {get:async key=>values[key]||null,set:async(key,value)=>{values[key]=value;writing=writing.then(async()=>{await writeFile(file+'.tmp',safeStorage.encryptString(JSON.stringify(values)),{mode:0o600});await rename(file+'.tmp',file)});await writing}};
}
function validateSender(event){
 if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||!event.senderFrame.url.startsWith(server.origin+'/app/'))throw new Error('This action is available only in the MicoCode workspace.');
}
function secureWindow(win,ownOrigin){
 win.webContents.setWindowOpenHandler(({url})=>{if(safeExternal(url))void shell.openExternal(url);return {action:'deny'}});
 win.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==ownOrigin){event.preventDefault();if(safeExternal(url))void shell.openExternal(url)}});
 win.webContents.on('will-attach-webview',event=>event.preventDefault());
 win.webContents.session.setPermissionRequestHandler((_contents,permission,callback)=>callback(permission==='local-network-access'));
}
async function start(){
 const appDir=app.getAppPath(),dataDir=app.getPath('userData');const vault=await createVault(dataDir);let gatewayKey=await vault.get('gateway');
 if(!gatewayKey){gatewayKey='sk-mico-'+randomBytes(24).toString('hex');await vault.set('gateway',gatewayKey)}
  server=await createLocalServer({webDir:path.join(appDir,'web'),port:smoke?19287:19286,gatewayKey,getOllamaUpstream:()=>manager?.ollamaUpstream,getOllamaModel:()=>manager?.ollamaModel,getOllamaModels:()=>manager?.ollamaModels,getManagedConnection:id=>manager?.connections.get(id)});
 manager=new ProviderManager({dataDir,runtimeDir:app.isPackaged?path.join(process.resourcesPath,'node-runtime'):path.join(appDir,'..','resources','node-runtime'),gatewayBase:server.origin+'/managed/v1',gatewayKey,vault,onProgress:progress=>{if(window&&!window.isDestroyed())window.webContents.send('mico:progress',progress)}});
 window=new BrowserWindow({width:1440,height:950,minWidth:720,minHeight:540,title:'MicoCode',backgroundColor:backgrounds.forest,show:false,autoHideMenuBar:true,icon:path.join(appDir,'icon.ico'),webPreferences:{preload:path.join(appDir,'preload.cjs'),nodeIntegration:false,nodeIntegrationInWorker:false,contextIsolation:true,sandbox:true,webSecurity:true,partition:'persist:micocode'}});
 window.removeMenu();secureWindow(window,server.origin);
 ipcMain.handle('mico:setup',async(event,provider,engine)=>{validateSender(event);return managedClientConnection(await manager.setup(assertProvider(provider),engine),server.origin)});
 ipcMain.handle('mico:cancel',event=>{validateSender(event);manager.cancel()});
 ipcMain.handle('mico:status',event=>{validateSender(event);return manager.statuses()});
 let restoration;
 ipcMain.handle('mico:restore',event=>{validateSender(event);return restoration||(restoration=manager.restore().then(result=>managedClientConnection(result,server.origin)))});
 ipcMain.handle('mico:stop',(event,provider)=>{validateSender(event);return manager.stop(assertProvider(provider))});
 ipcMain.handle('mico:appearance',(event,theme)=>{validateSender(event);if(!Object.hasOwn(backgrounds,theme))throw new Error('Unknown theme.');window.setBackgroundColor(backgrounds[theme]);nativeTheme.themeSource=theme==='paper'?'light':'dark'});
 ipcMain.handle('mico:dashboard',async(event,provider)=>{
  validateSender(event);assertProvider(provider);const connection=manager.connections.get(provider);if(!connection?.dashboard)throw new Error('Set up 9Router before opening its dashboard.');
  const url=new URL(connection.dashboard);const dashboardSession=session.fromPartition('persist:micocode-9router');
  const cookie=manager.cookies.get(provider)?.split('=');if(cookie?.length===2)await dashboardSession.cookies.set({url:url.origin,name:cookie[0],value:cookie[1],httpOnly:true,sameSite:'lax',path:'/'});
  const win=new BrowserWindow({width:1200,height:800,title:'9Router · MicoCode',autoHideMenuBar:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,session:dashboardSession}});dashboards.add(win);win.on('closed',()=>dashboards.delete(win));secureWindow(win,url.origin);await win.loadURL(url.href);
 });
 const errors=[];window.webContents.on('console-message',details=>{if(details.level==='error')errors.push(details.message.slice(0,220))});window.webContents.on('render-process-gone',()=>errors.push('Renderer exited unexpectedly.'));
 await window.loadURL(server.origin+'/app/');
 if(!smoke){window.show();return}
 // Release smoke check runs only under an explicit test flag and uses an isolated profile.
 await new Promise(resolve=>setTimeout(resolve,2000));
 await restoration;
 const state=await window.webContents.executeJavaScript(`({title:document.title,workspace:!!document.querySelector('.app-shell'),bridge:!!window.micoDesktop,node:typeof window.require,theme:document.documentElement.dataset.theme})`);
 const invalid=await window.webContents.executeJavaScript(`window.micoDesktop.setup('arbitrary-shell').then(()=>false,()=>true)`);
 const statusCount=await window.webContents.executeJavaScript(`window.micoDesktop.providerStatus().then(rows=>rows.length)`);
 let managedSetup;
 if(smokeProvider){
  assertProvider(smokeProvider);
  let ui;
  if(process.argv.includes('--smoke-ui')){
   ui=await window.webContents.executeJavaScript(`(async()=>{
    const wait=async check=>{const end=Date.now()+180000;while(Date.now()<end){const value=check();if(value)return value;await new Promise(r=>setTimeout(r,100))}throw Error('UI setup timed out: '+document.querySelector('.connection-status')?.textContent)};
    const click=async name=>{const button=await wait(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===name));button.click();await new Promise(r=>setTimeout(r,100))};
    await click('Models');
    const setup=await wait(()=>{const b=document.querySelector('button[aria-label="Set up and connect 9Router"]');return b&&!b.disabled?b:null});setup.click();
    await wait(()=>!setup.disabled&&document.querySelector('.connection-status')?.textContent&&!/^Preparing|Connecting/.test(document.querySelector('.connection-status').textContent));
    const initial=!!document.querySelector('.connection-status.success')&&!!document.querySelector('.managed-route');
    const cards=()=>Array.from(document.querySelectorAll('.provider-grid button'));
    cards().find(b=>b.textContent.includes('Ollama')).click();await new Promise(r=>setTimeout(r,100));
    cards().find(b=>b.textContent.includes('Free proxies')).click();await new Promise(r=>setTimeout(r,100));
    const restored=!!document.querySelector('.managed-route');
    await click('Connect & verify');
    await wait(()=>!document.querySelector('.connection-actions button')?.disabled&&document.querySelector('.connection-status')?.textContent.includes('connected'));
    return {initial,restored,success:!!document.querySelector('.connection-status.success'),managed:!!document.querySelector('.managed-route'),status:document.querySelector('.connection-status')?.textContent};
   })()`);
   if(!ui.initial||!ui.restored||!ui.success||!ui.managed)throw Error('Managed connection UI failed: '+JSON.stringify(ui));
  }
  const result=ui?managedClientConnection(manager.connections.get(smokeProvider),server.origin):await window.webContents.executeJavaScript(`window.micoDesktop.setup(${JSON.stringify(smokeProvider)},'local')`);
  const response=await fetch(result.config.proxyUrl+'/models',{headers:{Authorization:'Bearer '+result.key}});
  managedSetup={provider:smokeProvider,model:result.config.model,status:response.status,...(ui?{ui}:{})};
  if(process.argv.includes('--smoke-generation')){
   managedSetup.generation=await window.webContents.executeJavaScript(`(async()=>{const start=Date.now();try{const r=await fetch(${JSON.stringify(result.config.proxyUrl+'/chat/completions')},{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',Authorization:${JSON.stringify('Bearer '+result.key)}},body:JSON.stringify({model:${JSON.stringify(result.config.model)},messages:[{role:'user',content:'Reply with a short JSON object containing a greeting.'}],stream:false,max_tokens:512}),signal:AbortSignal.timeout(130000)});const d=await r.json();return {status:r.status,hasContent:!!d.choices?.[0]?.message?.content,milliseconds:Date.now()-start,...(!r.ok?{error:d.error}:{})}}catch(e){return {name:e.name,error:e.message,milliseconds:Date.now()-start}}})()`);
  }
  if(process.argv.includes('--smoke-agent')){
   managedSetup.agent=await window.webContents.executeJavaScript(`(async()=>{
    const wait=async check=>{const end=Date.now()+650000;while(Date.now()<end){const value=check();if(value)return value;await new Promise(r=>setTimeout(r,100))}throw Error('Agent UI generation timed out')};
    document.querySelector('[aria-label="Close dialog"]')?.click();await new Promise(r=>setTimeout(r,100));
    const mode=document.querySelector('.mode-toggle');if(mode.textContent.includes('Agent'))mode.click();
    const before={assistant:document.querySelectorAll('.message.assistant').length,error:document.querySelectorAll('.message.error').length,activity:document.querySelectorAll('.message.activity').length};
    const input=document.querySelector('[aria-label="Message Mico"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Give a concise three-step plan for a small HTML portfolio. Do not edit files. Return one JSON action object with a short message, an empty actions array, and done:true.');input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,100));
    const start=Date.now();document.querySelector('[aria-label="Send message"]').click();await wait(()=>document.querySelector('[aria-label="Stop agent"]'));
    await wait(()=>document.querySelector('[aria-label="Send message"]'));
    return {assistant:document.querySelectorAll('.message.assistant').length>before.assistant,error:Array.from(document.querySelectorAll('.message.error .message-text')).slice(before.error).map(e=>e.textContent).join(' | ')||null,activity:Array.from(document.querySelectorAll('.message.activity')).slice(before.activity).map(e=>e.textContent),milliseconds:Date.now()-start};
   })()`);
  }
 }
 const api=await fetch(server.origin+'/api/models');
 const report={version:app.getVersion(),...state,invalidProviderRejected:invalid,statusCount,...(managedSetup?{managedSetup}:{}),apiStatus:api.status,errors};
 report.passed=state.workspace&&state.bridge&&state.node==='undefined'&&invalid&&statusCount===4&&(!managedSetup||managedSetup.status===200)&&(!managedSetup?.generation||managedSetup.generation.status===200&&managedSetup.generation.hasContent)&&(!managedSetup?.agent||managedSetup.agent.assistant&&!managedSetup.agent.error)&&api.ok&&errors.length===0;
 const screenshot=process.argv.find(x=>x.startsWith('--smoke-screenshot='))?.slice('--smoke-screenshot='.length);if(screenshot)await writeFile(screenshot,(await window.webContents.capturePage()).toPNG());
 if(smokePath)await writeFile(smokePath,JSON.stringify(report,null,2));await manager.close();await server.close();app.exit(report.passed?0:1);
}
if(!app.requestSingleInstanceLock())app.quit();
else{
 app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus()}});
 app.whenReady().then(start).catch(async error=>{if(smoke&&smokePath)await writeFile(smokePath,JSON.stringify({passed:false,error:error.message},null,2));else dialog.showErrorBox('MicoCode could not open',error.code==='EADDRINUSE'?'MicoCode’s local workspace port is in use. Close the other instance and retry.':error.message);app.quit()});
 app.on('window-all-closed',()=>app.quit());
 app.on('before-quit',event=>{if(quitting)return;event.preventDefault();quitting=true;for(const win of dashboards)win.close();Promise.resolve(manager?.close()).then(()=>server?.close()).finally(()=>app.exit())});
}
