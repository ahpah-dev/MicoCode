import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import JSZip from 'jszip';
import {archivePath,extractVerifiedZip,downloadVerified} from '../desktop/install.mjs';
import {assertProvider,assertEngine,cliProxyConfig,liteLLMConfig,ProviderManager} from '../desktop/provider-manager.mjs';
import {isLocalRequest,createLocalServer} from '../desktop/server.mjs';

test('provider automation only accepts supported installer IDs',()=>{for(const id of ['9router','cliproxy','litellm','ollama'])assert.equal(assertProvider(id),id);for(const id of ['../ollama','custom','powershell','9router;whoami',null])assert.throws(()=>assertProvider(id))});
test('managed engines cannot be changed to paid or arbitrary destinations',()=>{assert.equal(assertEngine('local'),'local');assert.equal(assertEngine('community'),'community');for(const value of ['paid','https://other.example','custom',null])assert.throws(()=>assertEngine(value))});
test('provider archives cannot escape, create links, or overwrite a destination',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'mico-archive-'));
 try{
  for(const name of ['../bad','/outside','C:/outside','folder/../../bad','folder\\bad','a/./bad','bad\0file'])assert.throws(()=>archivePath(root,name));
  const zip=new JSZip();zip.file('folder/working.txt','verified');const file=path.join(root,'test.zip');await writeFile(file,await zip.generateAsync({type:'nodebuffer'}));
  const out=path.join(root,'out');await extractVerifiedZip(file,out);assert.equal(await readFile(path.join(out,'folder','working.txt'),'utf8'),'verified');await assert.rejects(extractVerifiedZip(file,out),/already exists/);
  const link=new JSZip();link.file('link','../outside',{unixPermissions:0o120777});const bad=path.join(root,'link.zip');await writeFile(bad,await link.generateAsync({type:'nodebuffer',platform:'UNIX'}));await assert.rejects(extractVerifiedZip(bad,path.join(root,'bad')),/Links and special files/);
 }finally{await rm(root,{recursive:true,force:true})}
});
test('private router configs expose only the selected free route on loopback',()=>{
 const cli=cliProxyConfig(30001,'sk-client','http://127.0.0.1:19286/managed/v1','sk-internal','C:\\Mico\\auth');
 const lite=liteLLMConfig(30002,'sk-client','http://127.0.0.1:19286/managed/v1','sk-internal');
 assert.match(cli,/host: 127\.0\.0\.1/);assert.match(cli,/allow-remote: false/);assert.match(cli,/disable-control-panel: true/);assert.match(cli,/alias: free-code/);assert.match(lite,/model: openai\/free-code/);assert.doesNotMatch(cli+lite,/openrouter\.ai|antigravity-credits: true|claude|paid/);
});
test('native server rejects hostile hosts and origins and protects the managed gateway',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'mico-web-'));await writeFile(path.join(root,'index.html'),'<h1>Local workspace</h1>');const server=await createLocalServer({webDir:root,port:0,gatewayKey:'private'});
 try{
  assert.equal((await fetch(server.origin)).status,200);
  assert.equal((await fetch(server.origin,{headers:{Origin:'https://other.example'}})).status,403);
  assert.equal((await fetch(server.origin+'/managed/v1/models')).status,401);
  assert.equal((await fetch(server.origin+'/managed/ollama/api/chat',{method:'POST',body:'{}'})).status,503);
  assert.equal((await fetch(server.origin+'/managed/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer private','Content-Type':'application/json'},body:JSON.stringify({model:'paid-model',messages:[]})})).status,400);
  assert.equal(isLocalRequest(new Request(server.origin,{headers:{'sec-fetch-site':'cross-site'}}),server.origin),false);
 }finally{await server.close();await rm(root,{recursive:true,force:true})}
});
test('cancelled setup does not begin a download',async()=>{const abort=new AbortController();abort.abort();await assert.rejects(downloadVerified({url:'https://example.com/file.zip',sha256:'0'.repeat(64),maxBytes:1},path.join(os.tmpdir(),'mico-cancel-test.zip'),abort.signal),/abort/i)});
