import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

// Exercise the real Chromium parser, inherited desktop CSP, opaque-origin
// sandbox and module loader. A string assertion cannot detect these failures.
test('preview executes classic and local module code within the desktop sandbox',async context=>{
 let electron;try{electron=(await import('electron')).default}catch{context.skip('Electron runtime is unavailable.');return}
 if(typeof electron!=='string'||!existsSync(electron)){context.skip('Electron runtime is unavailable.');return}
 const repo=fileURLToPath(new URL('../',import.meta.url));
 const prefix=path.join(os.tmpdir(),'micocode-preview-');
 const temp=await mkdtemp(prefix);
 try{
  const renderer=`
import {makePreview} from ${JSON.stringify(path.join(repo,'components/micocode/preview.tsx'))};
const logs=[];const expected=['classic-ok </script> parsed','module-static 42','module-dynamic 42','inline-module 42'];
const frame=document.createElement('iframe');frame.sandbox.add('allow-scripts');document.body.append(frame);
const finish=passed=>console.log('PREVIEW_RESULT '+JSON.stringify({passed,logs,isolated:frame.sandbox.value==='allow-scripts',validations}));
const validations=[];
try{makePreview({'index.html':'<script type="module" src="missing.js"></script>','missing.js':'import "./gone.js"'},'index.html','missing')}catch(e){validations.push(e.message)}
try{makePreview({'index.html':'<script type="module" src="a.js"></script>','a.js':'import "./b.js"','b.js':'import "./a.js"'},'index.html','cycle')}catch(e){validations.push(e.message)}
window.addEventListener('message',event=>{
 if(event.source!==frame.contentWindow||event.data?.mico!=='regression')return;
 logs.push({level:event.data.level,text:event.data.text});
 if(expected.every(text=>logs.some(m=>m.text===text)))setTimeout(()=>finish(logs.every(m=>m.level!=='error')),50);
});
const result=makePreview({
 'index.html':'<!doctype html><html><head><script src="classic.js" defer></script><script type="module" src="modules/root.js"></script><script type="module">import {value} from "./shared.js"; console.log("inline-module",value);</script></head><body><div id="ready">parsed</div></body></html>',
 'classic.js':'const tag="</script>"; console.log("classic-ok",tag,document.querySelector("#ready").textContent);',
 'shared.js':'export const value=42;',
 'modules/child.js':'export {value} from "../shared.js";',
 'modules/root.js':'import {value} from "./child.js"; console.log("module-static",value); import("../shared.js").then(m=>console.log("module-dynamic",m.value));',
},'index.html','regression');
frame.srcdoc=result.html;setTimeout(()=>finish(false),15000);`;
  const bundled=await build({stdin:{contents:renderer,resolveDir:repo,sourcefile:'preview-regression.ts'},bundle:true,write:false,format:'iife',platform:'browser'});
  await writeFile(path.join(temp,'bundle.js'),bundled.outputFiles[0].contents);
  // Match the actual application policy instead of granting data: script access.
  const serverSource=await readFile(path.join(repo,'desktop/server.mjs'),'utf8');
  const csp=serverSource.match(/'Content-Security-Policy':"([^"]+)"/)?.[1];
  assert.ok(csp,'Desktop CSP must be available to the browser regression.');
  const main=`
const {app,BrowserWindow}=require('electron');const http=require('node:http');const fs=require('node:fs');const path=require('node:path');
app.setPath('userData',path.join(__dirname,'profile'));let server;const browserErrors=[];
app.whenReady().then(async()=>{
 server=http.createServer((req,res)=>{res.setHeader('Content-Security-Policy',${JSON.stringify(csp)});if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(__dirname,'bundle.js')))}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body><script src="/bundle.js"></script></body></html>')}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
 win.webContents.on('console-message',details=>{if(details.level==='error')browserErrors.push(details.message);if(details.message.startsWith('PREVIEW_RESULT ')){const result=JSON.parse(details.message.slice(15));fs.writeFileSync(path.join(__dirname,'report.json'),JSON.stringify({...result,browserErrors}));app.quit()}});
 await win.loadURL('http://127.0.0.1:'+server.address().port);setTimeout(()=>app.quit(),22000);
}).catch(error=>{fs.writeFileSync(path.join(__dirname,'report.json'),JSON.stringify({passed:false,error:error.message}));app.quit()});
app.on('window-all-closed',()=>app.quit());app.on('will-quit',()=>server?.close());`;
  const mainPath=path.join(temp,'main.cjs');await writeFile(mainPath,main);
  await promisify(execFile)(electron,[mainPath],{windowsHide:true,timeout:30000,maxBuffer:1000000});
  const result=JSON.parse(await readFile(path.join(temp,'report.json'),'utf8'));
  assert.equal(result.passed,true,JSON.stringify(result));assert.equal(result.isolated,true);
  assert.deepEqual(result.browserErrors,[]);
  assert.match(result.validations[0],/Missing module gone.js/);
  assert.match(result.validations[1],/Circular local module imports/);
 }finally{
  // The recursive cleanup is restricted to this test's freshly created directory.
  if(path.resolve(temp).startsWith(path.resolve(prefix)))await rm(temp,{recursive:true,force:true});
 }
});
