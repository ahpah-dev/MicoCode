import assert from 'node:assert/strict';
import {runAgent} from '../lib/mico/agent.ts';
import {mergeFiles} from '../lib/mico/core.mjs';
const initial={'index.html':'<!DOCTYPE html><html><head><title>Test</title></head><body><h1>Hello</h1></body></html>'};
const project={id:'test',name:'Relay verification',files:{...initial},active:'index.html',messages:[],checkpoints:[],changes:{},updated:Date.now()};
const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),240000);
try{
const changes=await runAgent({project,prompt:'Read index.html, change only the h1 text from Hello to MicoCode works, write the complete file, and finish. Do not change any other content.',mode:'agent',config:{provider:'ollama',model:process.env.MICOCODE_TEST_MODEL||'qwen3.5:9b',ollamaUrl:'http://127.0.0.1:11435',browserSize:'9B',temperature:0.2,maxSteps:5},key:'',signal:controller.signal,onMessage:(text,role)=>console.log(role+': '+text),onChanges:()=>{},onToken:()=>{}});
assert.equal(project.files['index.html'],initial['index.html']);assert.match(mergeFiles(project.files,changes)['index.html'],/<h1>MicoCode works<\/h1>/);console.log('PASS: real local inference → read → staged write → review/apply data, original preserved.');
}finally{clearTimeout(timer)}
