import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readModelText} from '../lib/mico/response-reader.mjs';
import {complete,runAgent} from '../lib/mico/agent.ts';
import {defaultConfig} from '../lib/mico/types.ts';
import {actionSchema} from '../lib/mico/action-schema.mjs';

test('compatible chat responses support text blocks and preserve code verbatim',async()=>{
 const code='{"message":"hello","actions":[],"done":true}';
 assert.equal(await readModelText(Response.json({choices:[{message:{content:[{type:'reasoning',text:'do not execute'},{type:'text',text:code}]}}]})),code);
 assert.equal(await readModelText(Response.json({message:{content:code}}),{local:true}),code);
});
test('router SSE text is decoded when nonstreaming requests still return streams',async()=>{
 const parts=['{"message":"ok",','"actions":[],"done":true}'];
 const raw=parts.map(content=>'data: '+JSON.stringify({choices:[{delta:{content}}]})+'\r\n\r\n').join('')+'data: [DONE]\r\n\r\n';
 assert.equal(await readModelText(new Response(raw,{headers:{'content-type':'text/event-stream'}})),parts.join(''));
 await assert.rejects(()=>readModelText(new Response('data: {"choices":\n\n',{headers:{'content-type':'text/event-stream'}})),/incomplete streaming reply/);
 await assert.rejects(()=>readModelText(new Response('data: '+JSON.stringify({choices:[{delta:{content:'{"message":"ok","actions":[],"done":true}'}}]})+'\n\n',{headers:{'content-type':'text/event-stream'}})),/before its streaming reply finished/);
});
test('success status cannot hide a router error, refusal, or unreadable response',async()=>{
 await assert.rejects(()=>readModelText(Response.json({error:{message:'Model is not enabled'}})),/Model is not enabled/);
 await assert.rejects(()=>readModelText(Response.json({choices:[{message:{refusal:'This model refused the request'}}]})),/refused the request/);
 await assert.rejects(()=>readModelText(new Response('<html>login</html>')),/API address/);
 await assert.rejects(()=>readModelText(Response.json({choices:[{message:{tool_calls:[{function:{name:'write_file'}}]}}]})),/no assistant text/);
});
test('broken bodies and cancellation produce distinct actionable errors',async()=>{
 const broken=()=>new Response(new ReadableStream({start(controller){controller.error(new Error('socket closed'))}}));
 await assert.rejects(()=>readModelText(broken()),e=>e.status===503&&/disconnected/.test(e.message));
 const stop=new AbortController();stop.abort();
 await assert.rejects(()=>readModelText(broken(),{signal:stop.signal}),e=>e.name==='AbortError');
});
test('output limits cannot promote a truncated reply into a complete agent action',async()=>{
 const content='{"message":"partial","actions":[],"done":true}';
 await assert.rejects(()=>readModelText(Response.json({choices:[{finish_reason:'length',message:{content}}]})),e=>e.status===422&&/output limit/.test(e.message));
 await assert.rejects(()=>readModelText(Response.json({done_reason:'length',message:{content:'',thinking:'unfinished reasoning'}}),{local:true}),/output limit/);
 const raw='data: '+JSON.stringify({choices:[{delta:{content},finish_reason:'length'}]})+'\n\ndata: [DONE]\n\n';
 await assert.rejects(()=>readModelText(new Response(raw,{headers:{'content-type':'text/event-stream'}})),/output limit/);
});
test('an output-limit reply is discarded and repaired instead of aborting the run',async()=>{
  const prior=globalThis.fetch;let calls=0;const notes=[];
  // The first reply is cut off mid-object; the retry reads, then completes the edit.
  const replies=[
   {message:{content:'{"message":"truncated","actions":[{"type":"edit_'},done_reason:'length'},
   {message:{content:'{"message":"Reading","actions":[{"type":"read_file","path":"index.html"}],"done":false}'},done_reason:'stop'},
   {message:{content:'{"message":"Fixed","actions":[{"type":"edit_file","path":"index.html","find":"Hello","replace":"Welcome"}],"done":true}'},done_reason:'stop'},
  ];
  globalThis.fetch=async()=>Response.json(replies[Math.min(calls++,replies.length-1)]);
  try{
   const project={id:'limit',name:'limit',files:{'index.html':'<h1>Hello</h1>'},active:'index.html',messages:[],checkpoints:[],changes:{},updated:0};
   const result=await runAgent({project,prompt:'Change the heading',mode:'agent',config:{...defaultConfig,provider:'ollama',ollamaUrl:'http://127.0.0.1:11434',model:'test',quality:'focused',maxSteps:4,resilience:false},key:'',signal:new AbortController().signal,onMessage:text=>notes.push(text),onChanges:()=>{},onToken:()=>{}});
   assert.equal(result['index.html'],'<h1>Welcome</h1>');assert.equal(calls,3);
   assert.ok(notes.some(text=>text.includes('output limit')));
  }finally{globalThis.fetch=prior}
});
test('repeated output-limit replies stop with actionable guidance and preserve staged work',async()=>{
  const prior=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return Response.json({message:{content:'{"message":"cut","actions":[]}'},done_reason:'length'})};
  try{
   const project={id:'stalled',name:'stalled',files:{'index.html':'<h1>Hello</h1>'},active:'index.html',messages:[],checkpoints:[],changes:{},updated:0};
   await assert.rejects(()=>runAgent({project,prompt:'Change the heading',mode:'agent',config:{...defaultConfig,provider:'ollama',ollamaUrl:'http://127.0.0.1:11434',model:'test',quality:'focused',maxSteps:5,resilience:false},key:'',signal:new AbortController().signal,onMessage:()=>{},onChanges:()=>{},onToken:()=>{}}),/repeatedly exceeded its output limit/);
   assert.equal(calls,3);assert.equal(project.files['index.html'],'<h1>Hello</h1>');
  }finally{globalThis.fetch=prior}
});
test('local agent actions disable optional thinking per request to retain answer budget',async()=>{
 const prior=globalThis.fetch;let body;
 globalThis.fetch=async(_url,init)=>{body=JSON.parse(init.body);return Response.json({message:{content:'{"message":"ready","actions":[],"done":true}'},done_reason:'stop'})};
 try{
  const result=await complete([{role:'user',content:'Plan a page'}],{...defaultConfig,provider:'ollama',managed:true,routerEngine:'local',ollamaUrl:'http://127.0.0.1:11434',model:'gemma4:gpu',resilience:false},'',new AbortController().signal,()=>{});
  assert.equal(body.think,false);assert.equal(body.options.num_predict,4096);assert.deepEqual(body.format,actionSchema);assert.match(result,/ready/);
 }finally{globalThis.fetch=prior}
});
test('a unavailable catalogue does not prevent a configured model from completing an edit',async()=>{
 const prior=globalThis.fetch;let calls=0;const notes=[];
 globalThis.fetch=async(url)=>{
  if(String(url).endsWith('/models'))return Response.json({error:'Catalogue temporarily unavailable'},{status:503});
  const reply=++calls===1?{message:'Read',actions:[{type:'read_file',path:'index.html'}],done:false}:{message:'Changed',actions:[{type:'edit_file',path:'index.html',find:'Hello',replace:'Welcome'}],done:true};
  return Response.json({choices:[{message:{content:JSON.stringify(reply)}}]});
 };
 try{
  const project={id:'edit',name:'edit',files:{'index.html':'<h1>Hello</h1>'},active:'index.html',messages:[],checkpoints:[],changes:{},updated:0};
  const result=await runAgent({project,prompt:'Change the heading',mode:'agent',config:{...defaultConfig,provider:'proxy',proxyPreset:'9router',proxyUrl:'http://127.0.0.1:9999/v1',model:'oc/free-model',quality:'focused',maxSteps:3,resilience:false},key:'test-key',signal:new AbortController().signal,onMessage:text=>notes.push(text),onChanges:()=>{},onToken:()=>{}});
  assert.equal(result['index.html'],'<h1>Welcome</h1>');assert.equal(project.files['index.html'],'<h1>Hello</h1>');assert.equal(calls,2);assert.ok(notes.some(text=>text.includes('Catalogue temporarily unavailable')));
 }finally{globalThis.fetch=prior}
});
