import test from 'node:test';
import assert from 'node:assert/strict';
import {createAiHubMixHandler,AIHUBMIX_BASE} from '../api/aihubmix.ts';
import {complete} from '../lib/mico/agent.ts';
import {listProxyModels,proxyPresets,selectCatalogueModel} from '../lib/mico/providers.mjs';
import {defaultConfig} from '../lib/mico/types.ts';

const key='sk-aihubmix-test-token-1234567890';
const request=(body,token=key)=>new Request('http://localhost/api/aihubmix',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});

test('AIHubMix relay validates requests and blocks cross-origin or missing keys',async()=>{
 let calls=0;const handler=createAiHubMixHandler(async()=>{calls++;return Response.json({})});
 assert.equal((await handler(request({action:'models'},''))).status,401);
 assert.equal((await handler(request({action:'proxy',url:'https://other.example'}))).status,400);
 const cross=request({action:'models'});cross.headers.set('Origin','https://other.example');assert.equal((await handler(cross)).status,403);
 assert.equal((await handler(request({action:'complete',model:'gpt-4o',messages:[{role:'tool',content:'bad'}]}))).status,400);assert.equal(calls,0);
});

test('AIHubMix relay normalizes catalogue, tags providers, and redacts keys in errors',async()=>{
 const handler=createAiHubMixHandler(async(url,options)=>{
  assert.equal(url,AIHUBMIX_BASE+'/models');assert.equal(options.headers.Authorization,'Bearer '+key);assert.equal(options.redirect,'error');
  return Response.json({data:[
   {id:'claude-3-7-sonnet-20250219'},
   {id:'gpt-4o-mini'},
   {id:'gemini-2.5-pro'},
   {id:'deepseek-chat'},
   {id:'qwen-max'},
   {id:'text-embedding-3-small'},
   {id:'dall-e-3'},
  ]});
 });
 const models=(await (await handler(request({action:'models'}))).json()).models;
 assert.deepEqual(models.map(m=>m.id),['claude-3-7-sonnet-20250219','gpt-4o-mini','gemini-2.5-pro','deepseek-chat','qwen-max']);
 const claude=models.find(m=>m.id==='claude-3-7-sonnet-20250219');
 assert.equal(claude.provider,'Anthropic');
 assert.equal(claude.contextLength,128000);
 const gemini=models.find(m=>m.id==='gemini-2.5-pro');
 assert.equal(gemini.provider,'Google');
 assert.equal(gemini.contextLength,1048576);

 const denied=createAiHubMixHandler(async()=>Response.json({error:{message:'Invalid token: '+key}},{status:401,headers:{'Retry-After':'20'}}));
 const response=await denied(request({action:'models'}));assert.equal(response.status,401);assert.equal(response.headers.get('retry-after'),'20');
 const error=(await response.json()).error;assert.match(error,/AIHubMix rejected this key/);assert.ok(!error.includes(key));
});

test('AIHubMix preset discovers models and completes agent generations via /api/aihubmix',async()=>{
 const preset=proxyPresets.find(p=>p.id==='aihubmix');
 assert.equal(preset.url,AIHUBMIX_BASE);assert.equal(preset.hidden,false);
 const prior=globalThis.fetch;let forwarded;
 const handler=createAiHubMixHandler(async(url,options)=>{
  if(url===AIHUBMIX_BASE+'/models')return Response.json({data:[{id:'gpt-4o-mini'}]});
  forwarded={url,body:JSON.parse(options.body)};
  return Response.json({choices:[{message:{content:'{"message":"Done","actions":[],"done":true}'},finish_reason:'stop'}]});
 });
 globalThis.fetch=async(url,options)=>{assert.equal(url,'/api/aihubmix');return handler(new Request('http://localhost'+url,options))};
 try{
  const listed=await listProxyModels({provider:'proxy',proxyPreset:'aihubmix',proxyUrl:preset.url},key);
  assert.deepEqual(listed.map(m=>m.id),['gpt-4o-mini']);
  const result=await complete([{role:'user',content:'Fix a title'}],{...defaultConfig,provider:'proxy',proxyPreset:'aihubmix',proxyUrl:preset.url,model:'gpt-4o-mini',resilience:false,freeFallback:false},key,new AbortController().signal,()=>{});
  assert.match(result,/Done/);assert.equal(forwarded.url,AIHUBMIX_BASE+'/chat/completions');assert.equal(forwarded.body.model,'gpt-4o-mini');assert.equal(forwarded.body.max_tokens,4096);
 }finally{globalThis.fetch=prior}
});
