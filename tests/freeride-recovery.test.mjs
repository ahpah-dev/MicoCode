import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {ProviderManager} from '../desktop/provider-manager.mjs';
import {createLocalServer} from '../desktop/server.mjs';
import {listProxyModels,discoverProxy} from '../lib/mico/providers.mjs';

const connection=port=>({key:'any',config:{provider:'proxy',proxyPreset:'freeride',proxyUrl:'http://127.0.0.1:'+port+'/v1',model:'freeride/auto',freeModels:['freeride/auto'],managed:true}});
const headers={Authorization:'Bearer any','Content-Type':'application/json'};
test('FreeRide discovery describes a stopped gateway without unrelated CORS advice',async()=>{
 const prior=globalThis.fetch;globalThis.fetch=async()=>{throw new TypeError('Failed to fetch')};
 try{await assert.rejects(listProxyModels({proxyPreset:'freeride',proxyUrl:'http://127.0.0.1:11343/v1'},'any'),error=>/Set up & connect FreeRide/.test(error.message)&&!/CORS/.test(error.message))}finally{globalThis.fetch=prior}
});
test('FreeRide recovers once before replaying an explicitly refused connection',async()=>{
 const stale=connection(55001),repaired=connection(55002);let recoveries=0,calls=[];
 const server=await createLocalServer({webDir:os.tmpdir(),port:0,getManagedConnection:()=>stale,recoverFreeRide:async()=>{recoveries++;return repaired},fetchImpl:async(url,options)=>{
  calls.push(url);if(url.includes('55001'))throw new TypeError('fetch failed',{cause:{code:'ECONNREFUSED'}});
  assert.equal(JSON.parse(options.body).model,'freeride/auto');return Response.json({choices:[{message:{content:'Working'}}]});
 }});
 try{
  const response=await fetch(server.origin+'/providers/freeride/v1/chat/completions',{method:'POST',headers,body:JSON.stringify({model:'freeride/auto',messages:[{role:'user',content:'Hi'}]})});
  assert.equal(response.status,200);assert.equal(recoveries,1);assert.deepEqual(calls,['http://127.0.0.1:55001/v1/chat/completions','http://127.0.0.1:55002/v1/chat/completions']);
 }finally{await server.close()}
});
test('stopped FreeRide catalogue uses recovery and retains its automatic route',async()=>{
 let recovered=0;const server=await createLocalServer({webDir:os.tmpdir(),port:0,getManagedConnection:()=>null,recoverFreeRide:async()=>{recovered++;return connection(55002)},fetchImpl:async()=>Response.json({data:[{id:'a/model',owned_by:'a'}]})});
 try{
  assert.equal((await fetch(server.origin+'/providers/freeride/v1/models')).status,503);assert.equal(recovered,0);
  const models=await discoverProxy({proxyPreset:'freeride',proxyUrl:server.origin+'/providers/freeride/v1',managed:true},'any');
  assert.deepEqual(models.map(m=>m.id),['a/model','freeride/auto']);assert.equal(recovered,1);
 }finally{await server.close()}
});
test('FreeRide HTTP quota errors never restart the gateway or replay generation',async()=>{
 let calls=0,recovered=0;const server=await createLocalServer({webDir:os.tmpdir(),port:0,getManagedConnection:()=>connection(55001),recoverFreeRide:async()=>{recovered++;return connection(55002)},fetchImpl:async()=>{calls++;return Response.json({error:'Quota exhausted'},{status:429})}});
 try{const response=await fetch(server.origin+'/providers/freeride/v1/chat/completions',{method:'POST',headers,body:JSON.stringify({model:'freeride/auto',messages:[{role:'user',content:'Hi'}]})});assert.equal(response.status,429);assert.equal(calls,1);assert.equal(recovered,0)}finally{await server.close()}
});
test('native FreeRide recovery coalesces requests and requires completed setup',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'mico-recovery-'));const manager=new ProviderManager({dataDir:root,runtimeDir:root,vault:{}});let calls=0,release;
 manager.setup=async()=>{calls++;await new Promise(resolve=>{release=resolve});return connection(55002)};
 try{
  await assert.rejects(manager.recoverFreeRide(),/needs setup first/);assert.equal(calls,0);
  await mkdir(manager.folder('freeride'),{recursive:true});await writeFile(path.join(manager.folder('freeride'),'installed.json'),'{}');
  const first=manager.recoverFreeRide();while(!release)await new Promise(r=>setTimeout(r,1));const second=manager.recoverFreeRide();await new Promise(r=>setTimeout(r,20));assert.equal(calls,1);release();
  const results=await Promise.all([first,second]);assert.equal(results[0],results[1]);
 }finally{await rm(root,{recursive:true,force:true})}
});
