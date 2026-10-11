import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {modelContextBudget,runAgent} from '../lib/mico/agent.ts';
import {defaultConfig} from '../lib/mico/types.ts';
import {exactEdit,mergeFiles,qualityReview,validateReply} from '../lib/mico/core.mjs';

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

let bundledAgent;
async function polishedRun(replies,files,initialChanges={},prompt='Change only the heading to Welcome') {
 if(!bundledAgent){const output=await build({entryPoints:[fileURLToPath(new URL('../lib/mico/agent.ts',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm',external:['@mlc-ai/web-llm']});bundledAgent=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].contents).toString('base64'))}
 const previous=globalThis.fetch,requests=[],notes=[],staged=[];let calls=0;
 globalThis.fetch=async(_url,options)=>{
  requests.push(JSON.parse(options.body));const reply=replies[calls++];
  assert.ok(reply,'A completed narrow edit must not start an unrelated cleanup request.');
  return Response.json({message:{content:JSON.stringify(reply)},done_reason:'stop'});
 };
 try{
  const project={id:'polish-test',name:'polish-test',files,active:'index.html',messages:[],checkpoints:[],changes:initialChanges,updated:0};
  const changes=await bundledAgent.runAgent({project,prompt,mode:'agent',config:{...defaultConfig,provider:'ollama',ollamaUrl:'http://127.0.0.1:11434',model:'test',quality:'polished',resilience:false,maxSteps:8},key:'',signal:new AbortController().signal,onMessage:text=>notes.push(text),onToken:()=>{},onChanges:changes=>staged.push({...changes})});
  return {changes,calls,requests,notes,project,staged};
 }finally{globalThis.fetch=previous}
}
const polishedDocument='<html lang="en"><head><meta name="viewport" content="width=device-width"><title>Test</title></head><body><h1>Hello</h1><img alt="" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///w=="></body></html>';

test('polished narrow edits report preexisting staged warnings without expanding the task',async()=>{
 const staged=polishedDocument.replace('</body>','<a href="#">Preexisting placeholder</a></body>');
 const result=await polishedRun([
  {message:'Read the heading',actions:[{type:'read_file',path:'index.html'}],done:false},
  {message:'Changed only the heading',actions:[{type:'edit_file',path:'index.html',find:'Hello',replace:'Welcome'}],done:true},
 ],{'index.html':polishedDocument},{'index.html':staged});
 assert.equal(result.calls,2);assert.equal(result.changes['index.html'],staged.replace('Hello','Welcome'));
 assert.equal(result.project.files['index.html'],polishedDocument);
 assert.equal(result.notes.filter(text=>text.startsWith('Polish pass')).length,0);
 assert.ok(result.notes.some(text=>text.includes('Static review needs attention:')&&text.includes('replace placeholder links')));
});

test('automatic polish repairs only newly introduced warnings and still reports preexisting issues',async()=>{
 const original=polishedDocument.replace('</body>','<a href="#">Preexisting placeholder</a></body>');
 const result=await polishedRun([
  {message:'Read',actions:[{type:'read_file',path:'index.html'}],done:false},
  {message:'Changed heading and image',actions:[{type:'edit_file',path:'index.html',find:'Hello',replace:'Welcome'},{type:'edit_file',path:'index.html',find:'<img alt=""',replace:'<img'}],done:true},
  {message:'Read the changed image',actions:[{type:'read_file',path:'index.html'}],done:false},
  {message:'Restored image accessibility',actions:[{type:'edit_file',path:'index.html',find:'<img src=',replace:'<img alt="" src='}],done:true},
 ],{'index.html':original});
 assert.equal(result.calls,4);assert.equal(result.changes['index.html'],original.replace('Hello','Welcome'));
 assert.equal(result.notes.filter(text=>text.startsWith('Polish pass')).length,1);
 const repairInstruction=result.requests[2].messages.at(-1).content;
 assert.match(repairInstruction,/add alt text/);assert.ok(!repairInstruction.includes('replace placeholder links'));
 assert.match(repairInstruction,/Preserve unrelated files and preexisting warnings/);
 assert.ok(result.notes.some(text=>text.includes('Static review needs attention:')&&text.includes('replace placeholder links')));
});

test('automatic polish remains bounded when a model leaves its introduced warning unresolved',async()=>{
 const result=await polishedRun([
  {message:'Read',actions:[{type:'read_file',path:'index.html'}],done:false},
  {message:'Changed heading and image',actions:[{type:'edit_file',path:'index.html',find:'Hello',replace:'Welcome'},{type:'edit_file',path:'index.html',find:'<img alt=""',replace:'<img'}],done:true},
  {message:'Unable to improve the image further',actions:[],done:true},
 ],{'index.html':polishedDocument});
 assert.equal(result.calls,3);assert.equal(result.notes.filter(text=>text.startsWith('Polish pass')).length,1);
 assert.equal(result.changes['index.html'],polishedDocument.replace('Hello','Welcome').replace('<img alt=""','<img'));
 assert.ok(result.notes.some(text=>text.includes('Static review needs attention:')&&text.includes('add alt text')));
});

test('a malformed staged title is repaired through a fresh read and exact patch before Apply',async()=>{
 const original=polishedDocument,expected=original.replace('<title>Test</title>','<title>MicoCode</title>');
 const result=await polishedRun([
  {message:'Read the current title',actions:[{type:'read_file',path:'index.html'}],done:false},
  {message:'Updated title',actions:[{type:'edit_file',path:'index.html',find:'<title>Test</title>',replace:'<title>MicoCode</title>}'}],done:true},
  {message:'Inspect the current staged head',actions:[{type:'read_file',path:'index.html'}],done:false},
  {message:'Removed the stray brace',actions:[{type:'edit_file',path:'index.html',find:'</title>}',replace:'</title>'},{type:'check_project'},{type:'review_quality'}],done:true},
 ],{'index.html':original},{},'Change only the document title to MicoCode');
 assert.equal(result.calls,4);assert.equal(result.changes['index.html'],expected);
 assert.equal(result.staged[0]['index.html'],expected.replace('</title>','</title>}'));assert.equal(result.staged[1]['index.html'],expected);
 assert.match(result.requests[2].messages.at(-1).content,/stray text between <head> elements: "}"/);
 assert.match(result.requests[3].messages.at(-1).content,/<title>MicoCode<\/title>}/);
 assert.equal(result.project.files['index.html'],original);assert.deepEqual(result.project.changes,{});
 assert.equal(mergeFiles(result.project.files,result.changes)['index.html'],expected);
 assert.equal(result.notes.filter(text=>text.startsWith('Polish pass')).length,1);
 assert.ok(result.notes.some(text=>text.startsWith('Static review passed.')));
});
