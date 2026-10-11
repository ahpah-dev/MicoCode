import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOpenCodeHandler} from '../api/opencode.ts';
import {OPENCODE_BASE, OPENCODE_METADATA, selectOpenCodeModels, openCodeRequest, readOpenCodeCompletion} from '../lib/mico/opencode.mjs';

const model = (id, extra={}) => ({id,name:id,cost:{input:0,output:0},modalities:{output:['text']},limit:{context:200000,output:16000},...extra});
const registry = entries => ({opencode:{api:OPENCODE_BASE,npm:'@ai-sdk/openai-compatible',models:Object.fromEntries(entries.map(m=>[m.id,m]))}});
const catalogue = ids => ({data:ids.map(id=>({id}))});
const request = (body, key='test-personal-zen-key') => new Request('http://localhost/api/opencode',{method:'POST',headers:{'Content-Type':'application/json',...(key?{Authorization:'Bearer '+key}:{})},body:JSON.stringify(body)});
const prompt = {action:'complete',model:'live-free',messages:[{role:'system',content:'Respond in JSON.'},{role:'user',content:'Say hi'}],temperature:0};
function fixture(entries=[model('live-free')], result=()=>Response.json({choices:[{message:{content:'{"message":"Hello","actions":[],"done":true}'}}]})) {
 const calls=[];
 const handler=createOpenCodeHandler(async(url,options)=>{
  calls.push({url,options});
  if(url===OPENCODE_BASE+'/models') return Response.json(catalogue(entries.map(m=>m.id)));
  if(url===OPENCODE_METADATA) return Response.json(registry(entries));
  return result(url,options);
 });
 return {handler,calls};
}
function sse(events, chunkSize=17) {
 const bytes=new TextEncoder().encode(events.map(event=>'data: '+(typeof event==='string'?event:JSON.stringify(event))+'\r\n\r\n').join(''));
 return new Response(new ReadableStream({start(controller){for(let start=0;start<bytes.length;start+=chunkSize)controller.enqueue(bytes.slice(start,start+chunkSize));controller.close();}}),{headers:{'Content-Type':'text/event-stream'}});
}

test('Zen free catalogue intersects live availability with explicit zero prices and text protocol',()=>{
 const entries=[model('free'),model('paid',{cost:{input:1,output:0}}),model('unknown-free',{cost:{}}),model('blank-free',{cost:{input:'',output:0}}),model('cached-paid',{cost:{input:0,output:0,cache_read:0.1}}),model('tier-paid',{cost:{input:0,output:0,tiers:{long:{input:1}}}}),model('gone'),model('jev-free',{modalities:{output:['decision']}}),model('weird-free',{provider:{npm:'unimplemented-sdk'}}),model('redirect-free',{provider:{api:'https://evil.example/v1'}}),model('response-free',{provider:{npm:'@ai-sdk/openai'}})];
 const live=catalogue(entries.filter(m=>m.id!=='gone').map(m=>m.id));
 live.data.push({id:'free'},{id:'fake-free'},{id:'../bad'});
 const selected=selectOpenCodeModels(live,registry(entries));
 assert.deepEqual(selected.map(m=>m.id),['free','response-free']);
 assert.equal(selected[0].contextLength,200000);
 assert.equal(selected[1].protocol,'responses');
 assert.deepEqual(selectOpenCodeModels(live,{opencode:{...registry(entries).opencode,api:'https://evil.example'}}),[]);
 assert.deepEqual(selectOpenCodeModels({data:[{id:'free',pricing:{prompt:1}}]},registry(entries)),[]);
});

test('Zen model discovery is public and explicitly leaves authorization unchecked',async()=>{
 const {handler,calls}=fixture();
 const response=await handler(request({action:'models'},''));
 const data=await response.json();
 assert.equal(response.status,200);
 assert.equal(data.requiresKey,true);
 assert.equal(data.authorization,'unchecked');
 assert.equal(data.models[0].id,'live-free');
 assert.equal(calls.length,2);
 assert.ok(calls.every(call=>!call.options.headers));
});

test('Zen generation requires a personal key and never guesses paid or missing routes',async()=>{
 const {handler,calls}=fixture([model('live-free'),model('paid-free',{cost:{input:1,output:2}})]);
 assert.equal((await handler(request(prompt,''))).status,401);
 assert.equal(calls.length,0);
 assert.equal((await handler(request({...prompt,model:'paid-free'}))).status,400);
 assert.equal((await handler(request({...prompt,model:'removed-free'}))).status,400);
 assert.equal(calls.filter(c=>c.options.method==='POST').length,0);
});

test('Zen enforces same origin, bounded messages, JSON and supported actions',async()=>{
 const {handler,calls}=fixture();
 const cross=request(prompt);cross.headers.set('Origin','https://evil.example');
 assert.equal((await handler(cross)).status,403);
 assert.equal((await handler(request({action:'connection'}))).status,400);
 assert.equal((await handler(request({...prompt,messages:[{role:'tool',content:'unexpected'}]}))).status,400);
 assert.equal((await handler(request(null))).status,400);
 assert.equal((await handler(new Request('http://localhost/api/opencode',{method:'POST',body:'{'}))).status,400);
 assert.equal(calls.length,0);
});

test('Zen sends only the user key to the fixed matching chat endpoint',async()=>{
 const {handler,calls}=fixture();
 const response=await handler(request(prompt));
 assert.equal(response.status,200);
 const call=calls.at(-1);
 assert.equal(call.url,OPENCODE_BASE+'/chat/completions');
 assert.equal(call.options.redirect,'error');
 assert.deepEqual(call.options.headers,{'Content-Type':'application/json',Authorization:'Bearer test-personal-zen-key'});
 const body=JSON.parse(call.options.body);
 assert.equal(body.temperature,0);
 assert.equal(body.stream,true);
 assert.equal(body.max_tokens,4096);
 assert.equal(body.model,'live-free');
 assert.equal(body.models,undefined);
 assert.equal((await response.json()).choices[0].message.content.includes('Hello'),true);
});

test('Zen selects Responses and Anthropic protocols from model metadata',async()=>{
 for(const [npm,path] of [['@ai-sdk/openai','/responses'],['@ai-sdk/anthropic','/messages']]){
  const answer=npm==='@ai-sdk/openai'?{output:[{type:'message',content:[{type:'output_text',text:'Hello'}]}]}:{content:[{type:'text',text:'Hello'}]};
  const {handler,calls}=fixture([model('live-free',{provider:{npm}})],()=>Response.json(answer));
  const response=await handler(request(prompt));
  assert.equal(response.status,200);
  assert.equal(calls.at(-1).url,OPENCODE_BASE+path);
  assert.equal((await response.json()).choices[0].message.content,'Hello');
  const body=JSON.parse(calls.at(-1).options.body);
  if(path==='/responses'){assert.equal(body.max_output_tokens,4096);assert.equal(body.store,false);assert.equal(body.messages,undefined);assert.deepEqual(body.input,prompt.messages);}
  else {assert.equal(body.system,'Respond in JSON.');assert.equal(body.messages.length,1);assert.equal(calls.at(-1).options.headers['x-api-key'],'test-personal-zen-key');}
 }
});

test('Zen preserves quota status and Retry-After without leaking a key',async()=>{
 const {handler}=fixture(undefined,()=>Response.json({error:{message:'quota test-personal-zen-key'}},{status:429,headers:{'Retry-After':'600'}}));
 const response=await handler(request(prompt));
 assert.equal(response.status,429);
 assert.equal(response.headers.get('Retry-After'),'600');
 const {error}=await response.json();
 assert.match(error,/usage limit/);
 assert.ok(!error.includes('test-personal-zen-key'));
});

test('Zen discovery failure fails closed before inference',async()=>{
 let requests=0;
 const handler=createOpenCodeHandler(async()=>{requests++;return new Response('Unavailable',{status:503})});
 const response=await handler(request(prompt));
 assert.equal(response.status,502);
 assert.match((await response.json()).error,/discovery/);
 assert.equal(requests,2);
});

test('stream normalization handles chunk boundaries, unicode and answer-only text',async()=>{
 const content=await readOpenCodeCompletion(sse([{choices:[{delta:{reasoning_content:'secret reasoning',content:'Ž'}}]},{choices:[{delta:{content:[{type:'text',text:'ivjo'}]},finish_reason:'stop'}]},'[DONE]'],1),'chat');
 assert.equal(content,'Živjo');
 const responses=await readOpenCodeCompletion(sse([{type:'response.reasoning_summary_text.delta',delta:'ignore'},{type:'response.output_text.delta',delta:'Hi'},{type:'response.completed',response:{output:[{type:'message',content:[{type:'output_text',text:'Hi'}]}]}}]),'responses');
 assert.equal(responses,'Hi');
 const messages=await readOpenCodeCompletion(sse([{type:'content_block_delta',delta:{type:'thinking_delta',thinking:'ignore'}},{type:'content_block_delta',delta:{type:'text_delta',text:'Hi'}},{type:'message_stop'}]),'messages');
 assert.equal(messages,'Hi');
});

test('HTTP-200 errors, truncated streams and reasoning-only completions fail visibly',async()=>{
 await assert.rejects(readOpenCodeCompletion(sse([{error:{message:'provider failed'}}]),'chat'),/provider failed/);
 await assert.rejects(readOpenCodeCompletion(sse([{choices:[{delta:{content:'partial'}}]}]),'chat'),/disconnected/);
 await assert.rejects(readOpenCodeCompletion(sse([{choices:[{delta:{reasoning_content:'thinking'},finish_reason:'stop'}]},'[DONE]']),'chat'),/no answer/);
 await assert.rejects(readOpenCodeCompletion(sse([{type:'response.incomplete',response:{status:'incomplete'}}]),'responses'),/could not complete/);
 await assert.rejects(readOpenCodeCompletion(Response.json({error:{message:'failed'}}),'chat'),/failed/);
 await assert.rejects(readOpenCodeCompletion(sse([{choices:[{delta:{content:'partial'},finish_reason:'length'}]},'[DONE]']),'chat'),/output limit/);
});

test('OpenCode output respects a smaller advertised model output cap',()=>{
 assert.equal(openCodeRequest({id:'small',protocol:'chat',maxOutput:512},prompt.messages).body.max_tokens,512);
});
