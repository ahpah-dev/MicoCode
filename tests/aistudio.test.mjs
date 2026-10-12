import test from 'node:test';
import assert from 'node:assert/strict';
import {createAiStudioHandler,AISTUDIO_BASE} from '../api/aistudio.ts';
import {complete} from '../lib/mico/agent.ts';
import {listProxyModels,proxyPresets,selectCatalogueModel} from '../lib/mico/providers.mjs';
import {defaultConfig} from '../lib/mico/types.ts';

const key='AIzaSyTestPrivateKey1234567890';
const request=(body,token=key)=>new Request('http://localhost/api/aistudio',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});

test('Google AI Studio relay validates requests and blocks cross-origin or missing keys',async()=>{
 let calls=0;const handler=createAiStudioHandler(async()=>{calls++;return Response.json({})});
 assert.equal((await handler(request({action:'models'},''))).status,401);
 assert.equal((await handler(request({action:'proxy',url:'https://other.example'}))).status,400);
 const cross=request({action:'models'});cross.headers.set('Origin','https://other.example');assert.equal((await handler(cross)).status,403);
 assert.equal((await handler(request({action:'complete',model:'gemini-2.5-pro',messages:[{role:'tool',content:'bad'}]}))).status,400);assert.equal(calls,0);
});

test('Google AI Studio relay normalizes models/ prefixes, filters non-chat models, and redacts keys in errors',async()=>{
 const handler=createAiStudioHandler(async(url,options)=>{
  assert.equal(url,AISTUDIO_BASE+'/models');assert.equal(options.headers.Authorization,'Bearer '+key);assert.equal(options.redirect,'error');
  return Response.json({data:[
   {id:'models/gemini-2.5-pro',displayName:'Gemini 2.5 Pro',owned_by:'google'},
   {id:'models/gemini-2.5-flash',displayName:'Gemini 2.5 Flash',owned_by:'google'},
   {id:'models/text-embedding-004',owned_by:'google'},
   {id:'models/imagen-3.0-generate-002',owned_by:'google'},
  ]});
 });
 const models=(await (await handler(request({action:'models'}))).json()).models;
 assert.deepEqual(models.map(m=>m.id),['gemini-2.5-pro','gemini-2.5-flash']);
 assert.equal(models[0].provider,'Google AI Studio');
 assert.equal(models[0].contextLength,1048576);
 assert.equal(selectCatalogueModel(models),'gemini-2.5-pro');

 const denied=createAiStudioHandler(async()=>Response.json([{error:{message:'API key not valid: '+key}}],{status:400,headers:{'Retry-After':'15'}}));
 const response=await denied(request({action:'models'}));assert.equal(response.status,400);assert.equal(response.headers.get('retry-after'),'15');
 const error=(await response.json()).error;assert.match(error,/Google AI Studio rejected this key/);assert.ok(!error.includes(key));
});

test('Google AI Studio preset discovers models and completes agent generations via /api/aistudio',async()=>{
 const preset=proxyPresets.find(p=>p.id==='aistudio');
 assert.equal(preset.url,AISTUDIO_BASE);assert.equal(preset.hidden,false);
 const prior=globalThis.fetch;let forwarded;
 const handler=createAiStudioHandler(async(url,options)=>{
  if(url===AISTUDIO_BASE+'/models')return Response.json({data:[{id:'models/gemini-2.5-flash',owned_by:'google'}]});
  forwarded={url,body:JSON.parse(options.body)};
  return Response.json({choices:[{message:{content:'{"message":"Done","actions":[],"done":true}'},finish_reason:'stop'}]});
 });
 globalThis.fetch=async(url,options)=>{assert.equal(url,'/api/aistudio');return handler(new Request('http://localhost'+url,options))};
 try{
  const listed=await listProxyModels({provider:'proxy',proxyPreset:'aistudio',proxyUrl:preset.url},key);
  assert.deepEqual(listed.map(m=>m.id),['gemini-2.5-flash']);
  const result=await complete([{role:'user',content:'Fix a title'}],{...defaultConfig,provider:'proxy',proxyPreset:'aistudio',proxyUrl:preset.url,model:'models/gemini-2.5-flash',resilience:false},key,new AbortController().signal,()=>{});
  assert.match(result,/Done/);assert.equal(forwarded.url,AISTUDIO_BASE+'/chat/completions');assert.equal(forwarded.body.model,'gemini-2.5-flash');assert.equal(forwarded.body.max_tokens,4096);
 }finally{globalThis.fetch=prior}
});
