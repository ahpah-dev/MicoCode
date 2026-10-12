import test from 'node:test';
import assert from 'node:assert/strict';
import {codingRank,discoverLocalNineKey,rankCodingModels,pickWorkingCodingModel,probeModel} from '../lib/mico/auto-connect.mjs';
import {validateReply} from '../lib/mico/core.mjs';

test('strong coding models outrank small local and non-chat models',()=>{
  assert.ok(codingRank('kc/anthropic/claude-sonnet-4-20250514')>codingRank('kimchi/kimi-k3'));
  assert.ok(codingRank('kimchi/kimi-k3')>codingRank('gemma4:gpu'));
  assert.equal(codingRank('nvidia/parakeet-ctc-1.1b-asr'),-1);
  // A current model must always beat a superseded one, however flagship it once was.
  assert.ok(codingRank('kimchi/glm-5.3')>codingRank('kc/openai/gpt-4.1'));
  assert.ok(codingRank('kc/openai/gpt-5')>codingRank('kc/openai/gpt-4o'));
  assert.ok(codingRank('google/gemini-3.8-flash')>codingRank('google/gemini-2.5-pro'));
  assert.ok(codingRank('anthropic/claude-sonnet-4')>codingRank('anthropic/claude-3-5-sonnet'));
  const ranked=rankCodingModels(['gemma4:gpu','nvidia/parakeet-ctc-1.1b-asr','kimchi/glm-5.3','kc/openai/gpt-4.1']);
  assert.deepEqual(ranked,['kimchi/glm-5.3','gemma4:gpu','kc/openai/gpt-4.1']);
  // Superseded models stay usable when they are genuinely all that is on offer.
  assert.deepEqual(rankCodingModels(['kc/openai/gpt-4o']),['kc/openai/gpt-4o']);
});

test('auto-connect returns the highest-ranked model that follows the action format',async()=>{
  const calls=[];
  const probe=async({model})=>{calls.push(model);return {ok:model==='kimchi/kimi-k3',model}};
  const models=['gemma4:gpu','kc/anthropic/claude-sonnet-4-20250514','kimchi/kimi-k3','kimchi/glm-5.3'];
  assert.equal(await pickWorkingCodingModel({base:'http://127.0.0.1:20128/v1',key:'k',models,probe}),'kimchi/kimi-k3');
  assert.equal(await pickWorkingCodingModel({base:'http://127.0.0.1:20128/v1',key:'k',models,probe:async({model})=>({ok:false,model})}),null);
});

test('probeModel accepts a compliant reply and rejects HTTP errors and prose',async()=>{
  const reply=text=>async()=>({ok:true,json:async()=>({choices:[{message:{content:text}}]})});
  const good='<think>hm</think>{"message":"ok","actions":[{"type":"list_files"}],"done":false}';
  assert.equal((await probeModel({base:'http://127.0.0.1:1/v1',key:'k',model:'m',fetchImpl:reply(good)})).ok,true);
  assert.equal((await probeModel({base:'http://127.0.0.1:1/v1',key:'k',model:'m',fetchImpl:reply('Sure, here you go')})).ok,false);
  assert.equal((await probeModel({base:'http://127.0.0.1:1/v1',key:'k',model:'m',fetchImpl:async()=>({ok:false,status:401})})).ok,false);
});

test('validateReply tolerates harmless format variations from capable models',()=>{
  assert.deepEqual(validateReply('{"message":"hi"}').actions,[]);
  assert.equal(validateReply('{"message":"hi"}').done,true);
  const aliased=validateReply('{"message":"x","action":{"tool":"edit","file":"index.html","old_string":"a","new_string":"b"}}');
  assert.deepEqual(aliased.actions[0],{tool:'edit',file:'index.html',old_string:'a',new_string:'b',type:'edit_file',path:'index.html',find:'a',replace:'b'});
  assert.equal(aliased.done,false);
  const nativeCall=validateReply(JSON.stringify({message:'',tool_calls:[{function:{name:'read_file',arguments:'{"path":"app.js"}'}}],done:false}));
  assert.equal(nativeCall.actions[0].type,'read_file');
  assert.equal(validateReply('Here is my plan: add a header.').done,true);
});

test('tolerant parsing still refuses unknown operations and private files',()=>{
  assert.throws(()=>validateReply('{"message":"x","actions":[{"type":"shell","command":"rm -rf /"}],"done":false}'));
  assert.throws(()=>validateReply('{"message":"x","actions":[{"type":"read","path":".env"}],"done":false}'));
  assert.throws(()=>validateReply('{"message":"x","actions":[{"type":"write_file","path":"a.js"}],"done":false}'));
  assert.throws(()=>validateReply('{"message": broken'));
});

test('discoverLocalNineKey reuses existing active key or auto-creates one when none exists',async()=>{
  const existing=await discoverLocalNineKey(async()=>({ok:true,json:async()=>({keys:[{key:'sk-existing-12345678',name:'Default Key',isActive:true}]})}));
  assert.deepEqual(existing,{key:'sk-existing-12345678',name:'Default Key'});
  const created=await discoverLocalNineKey(async(_url,init)=>init?.method==='POST'?{ok:true,json:async()=>({key:'sk-created-87654321'})}:{ok:true,json:async()=>({keys:[]})});
  assert.deepEqual(created,{key:'sk-created-87654321',name:'MicoCode desktop'});
});

