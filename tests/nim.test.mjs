import test from 'node:test';
import assert from 'node:assert/strict';
import {createNimHandler,NIM_BASE} from '../api/nim.ts';
import {complete} from '../lib/mico/agent.ts';
import {defaultConfig} from '../lib/mico/types.ts';

const key='nvapi-test-private-key';
const request=(body,token=key)=>new Request('http://localhost/api/nim',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
test('NIM relay validates requests and cannot forward keys to arbitrary hosts',async()=>{
 let calls=0;const handler=createNimHandler(async()=>{calls++;return Response.json({})});
 assert.equal((await handler(request({action:'models'},''))).status,401);
 assert.equal((await handler(request({action:'proxy',url:'https://other.example'}))).status,400);
 const cross=request({action:'models'});cross.headers.set('Origin','https://other.example');assert.equal((await handler(cross)).status,403);
 assert.equal((await handler(request({action:'complete',model:'nvidia/test',messages:[{role:'tool',content:'bad'}]}))).status,400);assert.equal(calls,0);
});
test('NIM relay discovers and deduplicates models, and surfaces redacted NVIDIA problem errors',async()=>{
 const handler=createNimHandler(async(url,options)=>{
  assert.equal(url,NIM_BASE+'/models');assert.equal(options.headers.Authorization,'Bearer '+key);assert.equal(options.redirect,'error');
  return Response.json({data:[{id:'nvidia/test',owned_by:'nvidia'},{id:'nvidia/test',owned_by:'nvidia'}]});
 });
 assert.equal((await (await handler(request({action:'models'}))).json()).models.length,1);
 const denied=createNimHandler(async()=>Response.json({detail:'Authorization failed '+key},{status:403,headers:{'Retry-After':'30'}}));
 const response=await denied(request({action:'models'}));assert.equal(response.status,403);assert.equal(response.headers.get('retry-after'),'30');
 const error=(await response.json()).error;assert.match(error,/NVIDIA rejected this key/);assert.ok(!error.includes(key));
});
test('NIM agent generation uses the same-origin relay and preserves output-limit metadata',async()=>{
 const prior=globalThis.fetch;let forwarded;
 const handler=createNimHandler(async(url,options)=>{forwarded={url,body:JSON.parse(options.body)};return Response.json({choices:[{message:{content:'{"message":"Done","actions":[],"done":true}'},finish_reason:'stop'}]})});
 globalThis.fetch=async(url,options)=>{assert.equal(url,'/api/nim');return handler(new Request('http://localhost'+url,options))};
 try{
  const result=await complete([{role:'user',content:'Fix a title'}],{...defaultConfig,provider:'proxy',proxyPreset:'nim',model:'nvidia/test',resilience:false},key,new AbortController().signal,()=>{});
  assert.match(result,/Done/);assert.equal(forwarded.url,NIM_BASE+'/chat/completions');assert.equal(forwarded.body.model,'nvidia/test');assert.equal(forwarded.body.max_tokens,4096);
 }finally{globalThis.fetch=prior}
 const limited=createNimHandler(async()=>Response.json({choices:[{message:{content:'partial'},finish_reason:'length'}]}));
 assert.equal((await (await limited(request({action:'complete',model:'nvidia/test',messages:[{role:'user',content:'Hi'}]}))).json()).choices[0].finish_reason,'length');
});
