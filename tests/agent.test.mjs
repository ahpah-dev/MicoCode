import {test} from 'node:test';
import assert from 'node:assert/strict';
import {modelContextBudget,runAgent} from '../lib/mico/agent.ts';
import {defaultConfig} from '../lib/mico/types.ts';
import {exactEdit,qualityReview,validateReply} from '../lib/mico/core.mjs';

test('exact edits preserve surrounding content and reject ambiguous replacements',()=>{
 assert.equal(exactEdit('keep\nhello\nkeep','hello','new'),'keep\nnew\nkeep');
 assert.throws(()=>exactEdit('same same','same','new'));assert.throws(()=>exactEdit('existing','missing','new'));
 assert.throws(()=>validateReply(JSON.stringify({message:'',done:true,actions:[{type:'edit_file',path:'x.js',find:'',replace:'new'}]})));
 assert.throws(()=>validateReply(JSON.stringify({message:'',done:false,actions:[{type:'read_file',path:'x.js',startLine:0,endLine:20}]})));
});
test('quality review checks real HTML omissions without claiming runtime correctness',()=>{
 assert.ok(qualityReview({'index.html':'<html><head></head><body><img src="x"><a href="#">Go</a><input></body></html>'}).length>=5);
 assert.deepEqual(qualityReview({'index.html':'<html lang="en"><head><meta name="viewport" content="width=device-width"><title>Test</title></head><body><label for="name">Name</label><input id="name"><img alt="" src="x"></body></html>'}),[]);
});
test('agent context budget adapts safely to model-reported context size',()=>{
 assert.equal(modelContextBudget(undefined,50000),50000);
 assert.equal(modelContextBudget(8192,50000),13107);
 assert.equal(modelContextBudget(128000,10000),204800);
 assert.equal(modelContextBudget(1000000,50000),240000);
});
test('typed model IDs can be attempted when a router does not publish a catalogue',async()=>{
 const previous=globalThis.fetch;const requests=[];
 globalThis.fetch=async(url,options={})=>{
  requests.push({url:String(url),body:options.body&&JSON.parse(options.body)});
  if(String(url).endsWith('/models'))return Response.json({data:[]});
  return Response.json({choices:[{message:{content:JSON.stringify({message:'Plan ready',actions:[],done:true})}}]});
 };
 const project={id:'router-test',name:'router-test',files:{'index.html':'<h1>Hi</h1>'},active:'index.html',messages:[],checkpoints:[],changes:{},updated:0};
 try{
  const changes=await runAgent({project,prompt:'Plan my next improvement',mode:'plan',config:{...defaultConfig,provider:'proxy',proxyPreset:'custom',proxyUrl:'http://127.0.0.1:9000/v1',model:'connected-provider/latest-model',resilience:false,maxSteps:1,quality:'focused'},key:'router-key',signal:new AbortController().signal,onMessage:()=>{},onToken:()=>{},onChanges:()=>{}});
  assert.deepEqual(changes,{});assert.equal(requests[1].url,'http://127.0.0.1:9000/v1/chat/completions');assert.equal(requests[1].body.model,'connected-provider/latest-model');
 }finally{globalThis.fetch=previous}
});
async function simulate(replies,mode='agent',files={'index.html':'<h1>Hello</h1>'}){
 const previous=globalThis.fetch;let i=0;let staged={};
 globalThis.fetch=async()=>Response.json({message:{content:JSON.stringify(replies[Math.min(i++,replies.length-1)])}});
 const project={id:'test',name:'test',files,active:'index.html',messages:[],checkpoints:[],changes:{},updated:0};
 try{const changes=await runAgent({project,prompt:'Change the heading',mode,config:{...defaultConfig,provider:'ollama',ollamaUrl:'http://127.0.0.1:11434',model:'test',quality:'focused',resilience:false,maxSteps:replies.length},key:'',signal:new AbortController().signal,onMessage:()=>{},onToken:()=>{},onChanges:c=>{staged=c}});return{changes,project,staged}}finally{globalThis.fetch=previous}
}
test('agent stages exact edits only after reading the matching text',async()=>{
 const result=await simulate([{message:'inspect',done:false,actions:[{type:'read_file',path:'index.html'}]},{message:'edit',done:true,actions:[{type:'edit_file',path:'index.html',find:'Hello',replace:'MicoCode'}]}]);
 assert.equal(result.changes['index.html'],'<h1>MicoCode</h1>');assert.equal(result.project.files['index.html'],'<h1>Hello</h1>');
 const refused=await simulate([{message:'edit',done:true,actions:[{type:'edit_file',path:'index.html',find:'Hello',replace:'MicoCode'}]}]);assert.deepEqual(refused.changes,{});
});
test('partial reads allow precise patches while preserving the unread remainder',async()=>{
 const original='<h1>Hello</h1>\n'+'untouched\n'.repeat(6000);
 const result=await simulate([{message:'inspect',done:false,actions:[{type:'read_file',path:'index.html',startLine:1,endLine:1}]},{message:'edit',done:true,actions:[{type:'edit_file',path:'index.html',find:'Hello',replace:'New'}]}],'agent',{'index.html':original});
 assert.equal(result.changes['index.html'],original.replace('Hello','New'));
 const refused=await simulate([{message:'inspect',done:false,actions:[{type:'read_file',path:'index.html',startLine:1,endLine:1}]},{message:'overwrite',done:true,actions:[{type:'write_file',path:'index.html',content:'wrong'}]}],'agent',{'index.html':original});assert.deepEqual(refused.changes,{});
});
test('plan mode cannot edit, write, or delete files',async()=>{
 const result=await simulate([{message:'inspect',done:false,actions:[{type:'read_file',path:'index.html'}]},{message:'attempt edits',done:true,actions:[{type:'edit_file',path:'index.html',find:'Hello',replace:'wrong'},{type:'delete_file',path:'index.html'},{type:'write_file',path:'other.txt',content:'wrong'}]}],'plan');assert.deepEqual(result.changes,{});assert.equal(result.project.files['index.html'],'<h1>Hello</h1>');
});
