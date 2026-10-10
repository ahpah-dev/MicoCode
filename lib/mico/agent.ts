import {checkProject,isPrivatePath,mergeFiles,validateReply} from './core.mjs';
import type {AgentReply,Changes,Config,Files,Project} from './types';
type Chat = {role:'system'|'user'|'assistant';content:string};
export const actionSchema = {type:'object',properties:{message:{type:'string'},actions:{type:'array',items:{type:'object',properties:{type:{type:'string',enum:['read_file','write_file','delete_file','list_files','search','check_project']},path:{type:'string'},content:{type:'string'},query:{type:'string'}},required:['type']}},done:{type:'boolean'}},required:['message','actions','done']};
export const systemPrompt = `You are Mico, the coding agent in MicoCode. Help create polished, accessible HTML/CSS/JavaScript websites. This workspace previews browser files only, with no Node, npm, shell, backend or deployment tools. Use relative files and vanilla JS. Do not claim you ran a command or test you did not run. Never fetch secrets or instruct quota bypasses.
Respond ONLY with a JSON object: {"message":"a concise progress note or answer","actions":[...],"done":false}.
Available actions: {"type":"list_files"}, {"type":"read_file","path":"index.html"}, {"type":"search","query":"text"}, {"type":"write_file","path":"styles.css","content":"complete file contents"}, {"type":"delete_file","path":"file.txt"}, {"type":"check_project"}.
Read existing files before changing them. Write complete files, never placeholders or ellipses. Prefer one file per reply. check_project checks JSON and local HTML resources, not runtime or JS syntax. Changes are staged for user review, not applied. Set done:true only when you have finished. Be concise to fit the context.`;
let engine:import('@mlc-ai/web-llm').MLCEngineInterface|undefined;
let loadedModel='';
export async function loadBrowserModel(size:Config['browserSize'],progress:(s:string)=>void) {
 const gpu=(navigator as unknown as {gpu?:{requestAdapter:()=>Promise<{features:Set<string>}|null>}}).gpu;
 if(!gpu) throw new Error('WebGPU is unavailable here. Open MicoCode in a recent Chrome or Edge, or connect Ollama / OpenRouter.');
 const adapter=await gpu.requestAdapter();if(!adapter)throw new Error('No compatible GPU was found. Connect Ollama or OpenRouter instead.');
 const mod=await import('@mlc-ai/web-llm');
 const precision=adapter.features.has('shader-f16')?'q4f16_1':'q4f32_1';
 const model=`Qwen2.5-Coder-${size}-Instruct-${precision}-MLC`;
 if(!mod.prebuiltAppConfig.model_list.some(m=>m.model_id===model))throw new Error('This model is not supported by the installed WebLLM version.');
 if(engine&&loadedModel===model)return;
 if(engine)await engine.unload();
 engine=undefined;loadedModel='';
 const worker=new Worker(new URL('./llm.worker.ts',import.meta.url),{type:'module'});
 try{engine=await mod.CreateWebWorkerMLCEngine(worker,model,{initProgressCallback:p=>progress(p.text)},{context_window_size:8192});loadedModel=model;}catch(e){worker.terminate();throw e}
}
export function browserReady(size:Config['browserSize']) { return !!engine && loadedModel.includes(`-${size}-`); }
export function stopBrowser() {engine?.interruptGenerate();}
export async function complete(messages:Chat[],config:Config,key:string,signal:AbortSignal,onToken:(t:string)=>void) {
 if(config.provider==='browser') {
   if(!browserReady(config.browserSize)||!engine)throw new Error('Load a browser model in Connections first.');
   const stream=await engine.chat.completions.create({messages,stream:true,temperature:config.temperature,max_tokens:1800,response_format:{type:'json_object',schema:JSON.stringify(actionSchema)}});
   let content='';for await(const part of stream){if(signal.aborted){engine.interruptGenerate();throw new DOMException('Stopped','AbortError')};content+=part.choices[0]?.delta.content||'';onToken(content)}return content;
 }
 const local=config.provider==='ollama';
 const url=local?config.ollamaUrl.replace(/\/$/,'')+'/api/chat':'/api/ai';
 const body=local?{model:config.model,messages,stream:false,format:actionSchema,options:{temperature:config.temperature,num_predict:4096}}:{model:config.model,messages,temperature:config.temperature};
 const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(local?{}:{Authorization:`Bearer ${key}`})},body:JSON.stringify(body),signal});
 const data=await response.json().catch(()=>({})) as {error?:{message?:string}|string;message?:{content?:string};choices?:{message?:{content?:string}}[]};
 if(!response.ok)throw new Error((typeof data.error==='string'?data.error:data.error?.message)||`Provider returned ${response.status}. Check your connection and provider quota.`);
 const content=local?data.message?.content:data.choices?.[0]?.message?.content;
 if(typeof content!=='string'||!content.trim())throw new Error('The model returned no text. Try another free model.');
 onToken(content);return content;
}
export async function runAgent(args:{project:Project;prompt:string;mode:'agent'|'plan';config:Config;key:string;signal:AbortSignal;onMessage:(text:string,role:'assistant'|'activity')=>void;onChanges:(c:Changes)=>void;onToken:(t:string)=>void}) {
 const {project,prompt,mode,config,key,signal,onMessage,onChanges,onToken}=args;
 let changes:Changes={...project.changes};
 const contextLimit=config.provider==='browser'?6500:50000;
 const prior=project.messages.filter(m=>m.role==='user'||m.role==='assistant').slice(-4).map(m=>`${m.role}: ${m.text}`).join('\n').slice(-1800);
 const instruction=systemPrompt+(mode==='plan'?'\nPLAN MODE: Do not write or delete files. Inspect files and explain your plan.':'');
 let observation='';const fullyRead=new Set<string>();const blocked=new Set<string>();
 const conversation:Chat[]=[{role:'system',content:instruction}];
 for(let step=0;step<config.maxSteps;step++) {
   if(signal.aborted)throw new DOMException('Stopped','AbortError');
   const files=mergeFiles(project.files,changes) as Files;
   const manifest=Object.keys(files).filter(p=>!isPrivatePath(p));
   const request=`Project: ${project.name}\nFiles: ${manifest.join(', ')}\nRecent chat: ${prior}\nUser request: ${prompt}\nMode: ${mode}. Step ${step+1}. Already staged: ${Object.keys(changes).join(', ')||'none'}.\nLatest tool results:\n${observation.slice(-contextLimit)}\nReturn the next JSON action object.`;
   onMessage(`Step ${step+1} · Thinking with ${config.provider==='browser'?'Qwen Coder '+config.browserSize:config.model}`,'activity');
   if(step===0)conversation.push({role:'user',content:request});
   else conversation.push({role:'user',content:'Tool execution results (already completed):\n'+observation.slice(-contextLimit)+'\nContinue toward the original task. If a file was just read, use its content above to write the edit now; do not read it again. Return the next JSON action object.'});
   if(config.provider==='browser'&&conversation.length>4){conversation.splice(2,conversation.length-4);}
   const raw=await complete(conversation,config,key,signal,onToken);
   conversation.push({role:'assistant',content:raw});
   if(signal.aborted)throw new DOMException('Stopped','AbortError');
   let reply:AgentReply;
   try{reply=validateReply(raw)}catch(e){onMessage('The response was incomplete or invalid. Asking the model to repair it.','activity');observation=`Your last output could not be parsed: ${String(e)}. Use the exact JSON schema. Write one small file per response, keeping output short.`;continue}
   if(reply.message)onMessage(reply.message,'assistant');
   const results:string[]=[];
   for(const action of reply.actions) {
     if(signal.aborted)throw new DOMException('Stopped','AbortError');
     const current=mergeFiles(project.files,changes) as Files;
     const path=action.path!;
     if((action.type==='write_file'||action.type==='delete_file')&&mode==='plan'){results.push('Edits are disabled in plan mode.');continue}
     if(action.type==='read_file'){const content=current[path];if(content!==undefined&&content.length>contextLimit){blocked.add(path);results.push('Cannot safely read '+path+': this file exceeds the model context budget. Do not overwrite it. Ask the user to split the file or select a model with more context.')}else{fullyRead.add(path);results.push(`FILE ${path}:\n${content??'File does not exist.'}`)}}
     if(action.type==='list_files')results.push(Object.keys(current).filter(p=>!isPrivatePath(p)).join('\n'));
     if(action.type==='search')results.push(Object.entries(current).filter(([p])=>!isPrivatePath(p)).flatMap(([p,c])=>c.split('\n').map((line,i)=>line.toLowerCase().includes(action.query!.toLowerCase())?`${p}:${i+1}: ${line}`:'').filter(Boolean)).slice(0,35).join('\n')||'No matches.');
     if(action.type==='write_file'){if(blocked.has(path)||(path in current&&!fullyRead.has(path))){results.push('Cannot edit '+path+' before reading its full contents. Use read_file first.');continue}if(Object.keys(current).length>=150 && !(path in current))throw new Error('Workspace is limited to 150 files.');changes[path]=action.content!;results.push('Staged '+path);onChanges({...changes})}
     if(action.type==='delete_file'){changes[path]=null;results.push('Staged deletion of '+path);onChanges({...changes})}
     if(action.type==='check_project'){const issues=checkProject(current);results.push(issues.length?issues.join('\n'):'JSON and local HTML resource checks passed. Runtime testing still requires Preview.')}
     onMessage(`${action.type.replaceAll('_',' ')}${path?' · '+path:action.query?' · '+action.query:''}`,'activity');
   }
   observation=results.join('\n\n');if(observation.length>contextLimit){for(const action of reply.actions)if(action.type==='read_file'&&action.path){fullyRead.delete(action.path);blocked.add(action.path)}observation='Tool results exceeded the model context budget. No complete file content was delivered. Read one smaller file per step. Do not overwrite unread files.'}
   if(reply.done){onToken('');return changes}
 }
 onMessage('The step limit was reached. Review the staged work, then send a follow-up to continue.','assistant');onToken('');return changes;
}
