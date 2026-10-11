import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyManagedConnection,bestCodingModel,credentialSlot,freeCatalogue,fullCatalogue,groupRouterModels,matchModel,normalizeEndpoint,providerOf,readCredential,routeSlug,shouldRestoreManagedConnection,writeCredential,rememberProfile,recallProfile} from '../lib/mico/providers.mjs';
import {abortableSleep,createRequester,ProviderError,retryDelay} from '../lib/mico/resilience.mjs';
import {POST as ai} from '../api/ai.ts';
import {POST as horde} from '../api/horde.ts';

test('router addresses reject leaked credentials and insecure remote destinations',()=>{
 assert.equal(normalizeEndpoint('http://127.0.0.1:20128/v1/'),'http://127.0.0.1:20128/v1');
 for(const address of ['http://example.com/v1','https://user:password@example.com/v1','https://example.com/v1?key=secret','file:///etc/passwd'])assert.throws(()=>normalizeEndpoint(address));
});
test('free discovery hides paid and unknown routes until exact free IDs are declared',()=>{
 const data={data:[{id:'zero',pricing:{prompt:'0',completion:'0'}},{id:'paid-free',pricing:{prompt:'1',completion:'1'}},{id:'unknown'},{id:'missing-price',pricing:{prompt:'0'}}]};
 assert.deepEqual(freeCatalogue(data).map(m=>m.id),['zero']);
 assert.deepEqual(freeCatalogue(data,['unknown'],true).map(m=>m.id),['zero','unknown']);
 assert.deepEqual(freeCatalogue(data,['unknown'],false).map(m=>m.id),['zero']);
 assert.deepEqual(freeCatalogue(data,['paid-free'],true).map(m=>m.id),['zero']);
});
test('full catalogue lists every router model with verified-free flags',()=>{
 const data={data:[{id:'zero',name:'Zero',context_length:32000,max_completion_tokens:4000,pricing:{prompt:'0',completion:'0'}},{id:'paid',pricing:{prompt:'1',completion:'0'}},{id:'unknown'},{id:'',},{id:42},{id:'x'.repeat(200)}]};
 assert.deepEqual(fullCatalogue(data),[{id:'zero',name:'Zero',verified:true,paid:false,provider:'',contextLength:32000,maxOutput:4000},{id:'paid',name:'paid',verified:false,paid:true,provider:''},{id:'unknown',name:'unknown',verified:false,paid:false,provider:''}]);
 assert.deepEqual(fullCatalogue({models:[{id:'a'}]}),[{id:'a',name:'a',verified:false,paid:false,provider:''}]);
 assert.deepEqual(fullCatalogue({}),[]);
});
test('router catalogues group provider models with pricing flags',()=>{
 const data={object:'list',data:[
  {id:'kr/claude-sonnet-4.5',object:'model',owned_by:'kr'},
  {id:'my-combo',object:'model',owned_by:'combo'},
  {id:'glm/glm-5',object:'model',owned_by:'glm',pricing:{prompt:'0',completion:'0'}},
  {id:'bare-model',object:'model'},
 ]};
 const catalogue=fullCatalogue(data);
 assert.deepEqual(catalogue.map(m=>m.provider),['kr','combo','glm','']);
 assert.equal(catalogue.find(m=>m.id==='glm/glm-5')?.verified,true);
 assert.equal(catalogue.find(m=>m.id==='kr/claude-sonnet-4.5')?.paid,false);
 assert.equal(providerOf({id:'openai/gpt-5'}),'openai');
 const groups=groupRouterModels(catalogue);
 assert.deepEqual(groups.map(g=>g.provider),['combo','glm','kr','Other']);
 assert.ok(matchModel(catalogue[0],'sonnet')&&matchModel(catalogue[0],'KR')&&!matchModel(catalogue[0],'gpt'));
});
test('default coding recommendation includes current provider coding models',()=>{
 assert.equal(bestCodingModel([{id:'glm/glm-4-flash'},{id:'cc/claude-opus-4.6'},{id:'openai/gpt-5-codex'}]),'cc/claude-opus-4.6');
 assert.equal(bestCodingModel([{id:'openai/gpt-5-codex',contextLength:32000},{id:'cc/claude-sonnet-4.6',contextLength:128000}]),'cc/claude-sonnet-4.6');
 assert.equal(bestCodingModel([{id:'glm-4.7-free',contextLength:200000},{id:'muse-spark-1.3-contributor-free',contextLength:1048576},{id:'qwen3.6-plus-free',contextLength:262144}]),'muse-spark-1.3-contributor-free');
 assert.equal(bestCodingModel([{id:'llama-3.1-8b'},{id:'glm-5.3',contextLength:204800},{id:'google/gemma-4-31b-it:free',contextLength:262144}]),'google/gemma-4-31b-it:free');
});
test('credentials never follow a switch to another endpoint or anonymous provider',()=>{
 const map=new Map();const storage={getItem:key=>map.get(key),setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 const first={provider:'proxy',proxyPreset:'9router',proxyUrl:'http://127.0.0.1:20128/v1'};
 writeCredential(first,'private',storage);
 assert.equal(readCredential(first,storage),'private');
 assert.equal(readCredential({...first,proxyUrl:'https://different.example/v1'},storage),'');
 assert.equal(readCredential({...first,provider:'openrouter'},storage),'');
 assert.equal(credentialSlot({...first,proxyPreset:'horde'}),'');
 writeCredential(first,'',storage);assert.equal(readCredential(first,storage),'');
});
test('native setup accepts the managed route allowlist and keeps a still-offered selection',()=>{
 const result={config:{provider:'proxy',proxyPreset:'9router',proxyUrl:'http://127.0.0.1:55000/v1',model:'mico-free/deepseek-r1-8b',freeModels:['mico-free/deepseek-r1-8b','mico-free/llama3-1-8b'],routerEngine:'local'},key:'private'};
 const config=applyManagedConnection({freeModels:[],routerFreeOnly:false,temperature:.2},result);
 assert.deepEqual(config.freeModels,['mico-free/deepseek-r1-8b','mico-free/llama3-1-8b']);assert.equal(config.routerFreeOnly,false);assert.equal(config.managed,true);assert.equal(config.temperature,.2);assert.equal(config.model,'mico-free/deepseek-r1-8b');
 assert.equal(applyManagedConnection({model:'mico-free/llama3-1-8b'},result).model,'mico-free/llama3-1-8b');
 assert.equal(applyManagedConnection({model:'stale-route'},result).model,'mico-free/deepseek-r1-8b');
 const data={data:[{id:'mico-free/deepseek-r1-8b'},{id:'unknown'},{id:'paid',pricing:{prompt:1,completion:1}}]};
 assert.deepEqual(freeCatalogue(data,config.freeModels,config.routerFreeOnly).map(m=>m.id),[]);
 assert.deepEqual(freeCatalogue(data,config.freeModels,true).map(m=>m.id),['mico-free/deepseek-r1-8b']);
 assert.deepEqual(freeCatalogue(data).map(m=>m.id),[]);
 for(const patch of [{proxyUrl:'https://remote.example/v1'},{model:'paid'},{proxyPreset:'custom'},{freeModels:[]},{freeModels:['other']}])assert.throws(()=>applyManagedConnection({}, {...result,config:{...result.config,...patch}}));
 assert.throws(()=>applyManagedConnection({},{config:{provider:'proxy',proxyPreset:'9router',proxyUrl:'http://127.0.0.1:55000/v1',model:'mico-free/free-code'},key:''}));
});
test('managed route slugs stay readable, bounded, and unique',()=>{
 const taken=new Set();
 assert.equal(routeSlug('DeepSeek-R1:8b',taken),'deepseek-r1-8b');
 assert.equal(routeSlug('hf.co/unsloth/DeepSeek-R1-Distill-Llama-8B-GGUF',taken),'hf-co-unsloth-deepseek-r1-distill-llama-8b-gguf');
 assert.equal(routeSlug('DeepSeek-R1:8b',taken),'deepseek-r1-8b-2');
 assert.equal(routeSlug('!!!',taken),'model');
 assert.equal(routeSlug('',taken),'model-2');
});
test('desktop restores managed routes only when the saved workspace selected them',()=>{
 assert.equal(shouldRestoreManagedConnection(undefined),true);
 assert.equal(shouldRestoreManagedConnection({provider:'proxy',managed:true}),true);
 assert.equal(shouldRestoreManagedConnection({provider:'proxy',proxyPreset:'9router',managed:false}),false);
 assert.equal(shouldRestoreManagedConnection({provider:'browser',managed:false}),false);
});
test('switching provider profiles preserves native ownership, engine, and free declarations',()=>{
 const map=new Map(),storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};
 const native=applyManagedConnection({}, {config:{provider:'proxy',proxyPreset:'9router',proxyUrl:'http://127.0.0.1:55000/v1',model:'mico-free/free-code',freeModels:['mico-free/free-code'],routerEngine:'community'},key:'private'});
 rememberProfile(native,storage);
 const restored=recallProfile({provider:'proxy',proxyPreset:'9router',proxyUrl:'http://127.0.0.1:20128/v1',freeModels:[],routerFreeOnly:false,managed:false},storage);
 assert.equal(restored.managed,true);assert.equal(restored.routerEngine,'community');assert.equal(restored.proxyUrl,native.proxyUrl);assert.deepEqual(restored.freeModels,native.freeModels);assert.equal(restored.routerFreeOnly,false);
});
test('legacy manual profiles are never promoted to managed or declared-free routes',()=>{
 const storage={getItem:()=>JSON.stringify({'proxy:9router':{model:'unknown',proxyUrl:'http://127.0.0.1:20128/v1'}})};
 const restored=recallProfile({provider:'proxy',proxyPreset:'9router',managed:true,routerFreeOnly:true},storage);
 assert.equal(restored.managed,false);assert.equal(restored.routerFreeOnly,false);assert.deepEqual(restored.freeModels,[]);
});
test('retry headers support seconds, dates, and request-reset durations',()=>{
 const now=Date.parse('2026-10-10T10:00:00Z');
 assert.equal(retryDelay(new Headers({'Retry-After':'3'}),now),3000);
 assert.equal(retryDelay(new Headers({'Retry-After':'Sat, 10 Oct 2026 10:00:05 GMT'}),now),5000);
 assert.equal(retryDelay(new Headers({'x-ratelimit-reset-requests':'2m'}),now),120000);
});
test('transient retries honor Retry-After and remain bounded',async()=>{
 let time=0,calls=0;const waits=[];
 const request=createRequester({now:()=>time,sleep:async ms=>{waits.push(ms);time+=ms},random:()=>0});
 const result=await request(async()=>++calls===1?Response.json({error:'busy'},{status:429,headers:{'Retry-After':'5'}}):Response.json({ok:true}));
 assert.equal(result.status,200);assert.equal(calls,2);assert.deepEqual(waits,[5000]);
 calls=0;await assert.rejects(()=>request(async()=>{calls++;return Response.json({error:'busy'},{status:503})},{scope:'bounded'}),ProviderError);assert.equal(calls,3);
});
test('daily quotas, billing, and long resets stop without model or credential rotation',async()=>{
 let calls=0;const request=createRequester({now:()=>0,sleep:async()=>assert.fail('Do not sleep beyond the bounded wait')});
 await assert.rejects(()=>request(async()=>{calls++;return Response.json({error:{message:'Daily free quota exhausted'}},{status:429})},{scope:'quota'}),e=>e.exhausted===true);assert.equal(calls,1);
 await assert.rejects(()=>request(async()=>{calls++;return Response.json({ok:true})},{scope:'quota'}));assert.equal(calls,1);
 await assert.rejects(()=>request(async()=>{calls++;return Response.json({error:'busy'},{status:429,headers:{'Retry-After':'120'}})},{scope:'long'}));assert.equal(calls,2);
 await assert.rejects(()=>request(async()=>{calls++;return Response.json({error:'Insufficient credits'},{status:402})},{scope:'credits'}),e=>e.exhausted);assert.equal(calls,3);
});
test('stopping a cooldown aborts promptly',async()=>{
 const abort=new AbortController();const sleep=abortableSleep(60000,abort.signal);abort.abort();await assert.rejects(()=>sleep,e=>e.name==='AbortError');
});
test('successful quota headers pace the following request until reset',async()=>{
 let time=10000;const waits=[];const request=createRequester({now:()=>time,sleep:async ms=>{waits.push(ms);time+=ms}});
 await request(async()=>Response.json({ok:true},{headers:{'x-ratelimit-remaining':'0','x-ratelimit-reset':'14'}}));
 await request(async()=>Response.json({ok:true}));assert.deepEqual(waits,[4000]);
});
test('one connection serializes generations',async()=>{
 let finish;let calls=0;const request=createRequester();
 const first=request(async()=>{calls++;await new Promise(resolve=>{finish=resolve});return Response.json({ok:true})});
 await new Promise(resolve=>setTimeout(resolve,0));
 const second=request(async()=>{calls++;return Response.json({ok:true})});
 await new Promise(resolve=>setTimeout(resolve,0));assert.equal(calls,1);finish();await Promise.all([first,second]);assert.equal(calls,2);
});

test('generation timeouts are distinguished from an unreachable router',async()=>{
 const request=createRequester();
 await assert.rejects(request(async()=>{throw new DOMException('Expired','TimeoutError')}),e=>e.status===504&&/smaller local model/.test(e.message)&&!/CORS/.test(e.message));
 const controller=new AbortController();controller.abort();await assert.rejects(request(async()=>Response.json({}),{signal:controller.signal}),e=>e.name==='AbortError');
});
test('OpenRouter relay enforces zero price and only same-provider free fallbacks',async()=>{
 const previous=globalThis.fetch;let sent;
 globalThis.fetch=async(url,options)=>{assert.equal(url,'https://openrouter.ai/api/v1/chat/completions');sent=JSON.parse(options.body);return Response.json({choices:[]},{headers:{'Retry-After':'7','x-ratelimit-remaining':'0'}})};
 try{
  const req=body=>new Request('https://micocode.vercel.app/api/ai',{method:'POST',headers:{Authorization:'Bearer test-key-12345','Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await ai(req({model:'paid/model',messages:[]}))).status,400);
  const result=await ai(req({model:'example/model:free',messages:[{role:'user',content:'test'}],freeFallback:true}));
  assert.equal(result.status,200);assert.deepEqual(sent.provider.max_price,{prompt:0,completion:0});assert.deepEqual(sent.models,['example/model:free','openrouter/free']);assert.equal(result.headers.get('retry-after'),'7');assert.equal(result.headers.get('x-ratelimit-remaining'),'0');
 }finally{globalThis.fetch=previous}
});
test('community relay cannot be used as an arbitrary URL proxy',async()=>{
 const previous=globalThis.fetch;globalThis.fetch=async()=>assert.fail('Invalid request must never reach upstream');
 try{assert.equal((await horde(new Request('https://micocode.vercel.app/api/horde',{method:'POST',body:JSON.stringify({action:'proxy',url:'http://127.0.0.1/private'})}))).status,400)}finally{globalThis.fetch=previous}
});
test('community discovery excludes unsupported templates and inactive workers',async()=>{
 const previous=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  if(url.endsWith('/models'))return Response.json({data:[{id:'live-instruct',known_to_horde:true,worker_threads:1,template:'llama-3-instruct'},{id:'broken-template',known_to_horde:true,worker_threads:3,template:'unknown'},{id:'offline',known_to_horde:true,worker_threads:0,template:'chatml'}]});
  assert.equal(url,'https://oai.aihorde.net/v1/chat/completions');assert.equal(options.headers.Authorization,'Bearer 0000000000');return Response.json({choices:[{message:{content:'OK'}}]});
 };
 const req=body=>new Request('https://micocode.vercel.app/api/horde',{method:'POST',headers:{Authorization:'Bearer not-forwarded'},body:JSON.stringify(body)});
 try{const r=await horde(req({action:'models'}));assert.deepEqual((await r.json()).models.map(m=>m.id),['live-instruct']);assert.equal((await horde(req({action:'complete',model:'broken-template',messages:[{role:'user',content:'test'}]}))).status,400);assert.equal((await horde(req({action:'complete',model:'live-instruct',messages:[{role:'user',content:'test'}]}))).status,200)}finally{globalThis.fetch=previous}
});
