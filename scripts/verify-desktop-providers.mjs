// Opt-in integration check. Downloads official provider packages into an isolated test profile.
import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {ProviderManager} from '../desktop/provider-manager.mjs';
import {createLocalServer} from '../desktop/server.mjs';
import {discoverProxy} from '../lib/mico/providers.mjs';
const root=process.cwd(),dataDir=path.resolve(process.argv[2]||'build/provider-test');
await mkdir(dataDir,{recursive:true});
const secrets=new Map(),vault={get:async key=>secrets.get(key),set:async(key,value)=>secrets.set(key,value)};
let manager;const gatewayKey='integration-only-free-route';
const server=await createLocalServer({webDir:path.join(root,'dist-web'),port:19187,gatewayKey,getOllamaUpstream:()=>manager.ollamaUpstream,getOllamaModel:()=>manager.ollamaModel,getOllamaModels:()=>manager.ollamaModels});
const diagnostics=new Map();
manager=new ProviderManager({dataDir,runtimeDir:path.join(root,'build','resources','node-runtime'),gatewayBase:server.origin+'/managed/v1',gatewayKey,vault,onProgress:p=>{if(p.percent===undefined||p.percent===100)console.log(p.provider+': '+p.stage+' · '+p.message)},onDiagnostic:(id,line)=>diagnostics.set(id,(diagnostics.get(id)||'').slice(-3000)+line)});
const results=[];
try{
 for(const provider of process.argv.slice(3).length?process.argv.slice(3):['9router','cliproxy','litellm','ollama']){
  try{
   const first=await manager.setup(provider),second=await manager.setup(provider);
   if(first.config.provider==='proxy'){const catalogue=await discoverProxy(first.config,first.key,AbortSignal.timeout(20000));if(!catalogue.some(m=>m.id===first.config.model))throw new Error('Frontend free-route discovery rejected the managed model.');}
   const same=first.config.proxyUrl===second.config.proxyUrl&&first.config.ollamaUrl===second.config.ollamaUrl;
   results.push({provider,connected:true,idempotent:same,model:first.config.model,paidFallback:false});
   console.log(provider+': verified, second setup reused the running instance');
   if(process.env.MICOCODE_VERIFY_GENERATION==='1'&&provider==='9router'){
    const r=await fetch(first.config.proxyUrl+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+first.key},body:JSON.stringify({model:first.config.model,messages:[{role:'user',content:'Reply with a brief greeting.'}],stream:false,max_tokens:20}),signal:AbortSignal.timeout(130000)});
    const d=await r.json();results[results.length-1].generation={status:r.status,hasContent:!!d.choices?.[0]?.message?.content,...(!r.ok?{error:d.error}: {})};console.log('9router generation: '+r.status+' · content returned: '+!!d.choices?.[0]?.message?.content);if(!r.ok)console.log(JSON.stringify(d.error));
   }
  }catch(e){results.push({provider,connected:false,error:e.message});console.log(provider+': '+e.message);console.log(diagnostics.get(provider)||'No startup diagnostics.');}
  await manager.stop(provider);
 }
}finally{await manager.close();await server.close();await writeFile(path.join(dataDir,'verification.json'),JSON.stringify(results,null,2))}
if(results.some(r=>!r.connected||!r.idempotent))process.exitCode=1;
