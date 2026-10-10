import {checkProject,exactEdit,isPrivatePath,mergeFiles,qualityReview,validateReply} from './core.mjs';
import {discoverProxy,normalizeEndpoint} from './providers.mjs';
import {resilientRequest} from './resilience.mjs';
import type {AgentReply,Changes,Config,Files,Project} from './types';
type Chat = {role:'system'|'user'|'assistant';content:string};
export const actionSchema = {type:'object',properties:{message:{type:'string'},actions:{type:'array',items:{type:'object',properties:{type:{type:'string',enum:['read_file','write_file','edit_file','delete_file','list_files','search','check_project','review_quality']},path:{type:'string'},content:{type:'string'},query:{type:'string'},find:{type:'string'},replace:{type:'string'},startLine:{type:'integer'},endLine:{type:'integer'}},required:['type']}},done:{type:'boolean'}},required:['message','actions','done']};
export const systemPrompt = `You are Mico, the coding agent in MicoCode. Help create polished, accessible HTML/CSS/JavaScript websites. This workspace previews browser files only, with no Node, npm, shell, backend or deployment tools. Use relative files and vanilla JS. Do not claim you ran a command or test you did not run. Never fetch secrets or instruct quota bypasses.
Respond ONLY with a JSON object: {"message":"a concise progress note or answer","actions":[...],"done":false}.
Available actions: {"type":"list_files"}, {"type":"read_file","path":"index.html"}, {"type":"read_file","path":"index.html","startLine":1,"endLine":80}, {"type":"search","query":"text"}, {"type":"edit_file","path":"index.html","find":"exact unique text that was read","replace":"replacement text"}, {"type":"write_file","path":"styles.css","content":"complete file contents"}, {"type":"delete_file","path":"file.txt"}, {"type":"check_project"}, {"type":"review_quality"}.
Read before changing. Prefer exact edit_file patches for existing files: match once, include surrounding text. Large files can be read by line ranges; do not rewrite a partially read file. Write complete files, never placeholders or ellipses. Prefer one file per reply. check_project checks JSON and local HTML resources. review_quality checks basic HTML accessibility and mobile metadata. Neither runs JavaScript or tests runtime. Changes are staged for review. Check work before setting done:true. Be concise.`;
const polishPrompt='\nPOLISHED MODE: Make focused, maintainable changes. Preserve working features and match the existing design. For new interfaces use cohesive spacing, readable type, responsive layouts, semantic HTML, accessible labels, visible keyboard focus, and useful loading, error and empty states where relevant. Wire up every control you add. Avoid placeholder links and fake data claims. Run check_project and review_quality before finishing; report any runtime checks still needed.';
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
export async function complete(messages:Chat[],config:Config,key:string,signal:AbortSignal,onToken:(t:string)=>void,onStatus:(t:string)=>void=()=>{}) {
 if(config.provider==='browser') {
   if(!browserReady(config.browserSize)||!engine)throw new Error('Load a browser model in Connections first.');
   const stream=await engine.chat.completions.create({messages,stream:true,temperature:config.temperature,max_tokens:1800,response_format:{type:'json_object',schema:JSON.stringify(actionSchema)}});
   let content='';for await(const part of stream){if(signal.aborted){engine.interruptGenerate();throw new DOMException('Stopped','AbortError')};content+=part.choices[0]?.delta.content||'';onToken(content)}return content;
 }
 const local=config.provider==='ollama';
 const horde=config.provider==='proxy'&&config.proxyPreset==='horde';
 const custom=config.provider==='proxy'&&!horde;
 const managedLocal=config.managed&&config.routerEngine==='local';
 if(managedLocal)onStatus('Generating with your local model. The first prompt may take longer while it loads; Stop cancels the request.');
 const url=local?config.ollamaUrl.replace(/\/$/,'')+'/api/chat':horde?'/api/horde':custom?normalizeEndpoint(config.proxyUrl)+'/chat/completions':'/api/ai';
 const body=local?{model:config.model,messages,stream:false,format:actionSchema,options:{temperature:config.temperature,num_predict:managedLocal?1800:4096}}:horde?{action:'complete',model:config.model,messages,temperature:config.temperature}:custom?{model:config.model,messages,temperature:config.temperature,max_tokens:managedLocal?1800:4096,stream:false}:{model:config.model,messages,temperature:config.temperature,freeFallback:config.freeFallback};
 const operation=()=>fetch(url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',...(!local&&!horde&&key?{Authorization:`Bearer ${key}`}:{})},body:JSON.stringify(body),signal:AbortSignal.any([signal,AbortSignal.timeout(managedLocal?620000:130000)])});
 // Cooldowns belong to the connection, never to a model: switching models cannot reset quotas.
 const response=await resilientRequest(operation,{scope:config.provider+':'+(custom?normalizeEndpoint(config.proxyUrl):local?config.ollamaUrl:''),signal,enabled:config.resilience,paceMs:local?0:config.provider==='openrouter'?3200:1500,onStatus});
 const data=await response.json().catch(()=>({})) as {error?:{message?:string}|string;message?:{content?:string};choices?:{message?:{content?:string}}[]};
 const content=local?data.message?.content:data.choices?.[0]?.message?.content;
 if(typeof content!=='string'||!content.trim())throw new Error('The model returned no text. Try another free model.');
 onToken(content);return content;
}
export async function runAgent(args:{project:Project;prompt:string;mode:'agent'|'plan';config:Config;key:string;signal:AbortSignal;onMessage:(text:string,role:'assistant'|'activity')=>void;onChanges:(c:Changes)=>void;onToken:(t:string)=>void}) {
 const {project,prompt,mode,config,key,signal,onMessage,onChanges,onToken}=args;
 let changes:Changes={...project.changes};
 if(config.provider==='proxy') {
  onMessage('Verifying available free routes…','activity');
  const available=await discoverProxy(config,key,AbortSignal.any([signal,AbortSignal.timeout(20000)]));
  if(!available.some((m:{id:string})=>m.id===config.model))throw new Error('The selected free route is no longer available. Reconnect and select an active free model.');
 }
 const contextLimit=config.provider==='browser'?6500:config.provider==='proxy'&&(config.proxyPreset==='horde'||config.managed)?10000:50000;
 const prior=project.messages.filter(m=>m.role==='user'||m.role==='assistant').slice(-4).map(m=>`${m.role}: ${m.text}`).join('\n').slice(-1800);
 const instruction=systemPrompt+(config.quality==='polished'?polishPrompt:'')+(mode==='plan'?'\nPLAN MODE: Do not write, edit or delete files. Inspect files and explain your plan.':'');
 let observation='';let invalid=0;let polishPass=false;const fullyRead=new Set<string>();const fragments=new Map<string,string[]>();
 const conversation:Chat[]=[{role:'system',content:instruction}];
 for(let step=0;step<config.maxSteps;step++) {
   if(signal.aborted)throw new DOMException('Stopped','AbortError');
   const files=mergeFiles(project.files,changes) as Files;
   const manifest=Object.keys(files).filter(p=>!isPrivatePath(p));
   const request=`Project: ${project.name}\nFiles: ${manifest.join(', ')}\nRecent chat: ${prior}\nUser request: ${prompt}\nMode: ${mode}. Step ${step+1}. Already staged: ${Object.keys(changes).join(', ')||'none'}.\nLatest tool results:\n${observation.slice(-contextLimit)}\nReturn the next JSON action object.`;
   onToken('');onMessage(`Step ${step+1} · Thinking with ${config.provider==='browser'?'Qwen Coder '+config.browserSize:config.model}`,'activity');
   if(step===0)conversation.push({role:'user',content:request});
   else conversation.push({role:'user',content:'Tool execution results (already completed):\n'+observation.slice(-contextLimit)+'\nContinue toward the original task. If a file was just read, use its content above to write the edit now; do not read it again. Return the next JSON action object.'});
   const budget=contextLimit+(config.provider==='browser'?4000:8000);
   if((config.compactContext||config.provider==='browser')&&conversation.length>4&&conversation.reduce((n,m)=>n+m.content.length,0)>budget){const before=conversation.reduce((n,m)=>n+m.content.length,0);conversation.splice(2,conversation.length-4);onMessage(`Context optimized · removed ${Math.round((before-conversation.reduce((n,m)=>n+m.content.length,0))/4).toLocaleString()} estimated tokens of older tool results; keeping your task and latest read.`,'activity')}
   const raw=await complete(conversation,config,key,signal,onToken,text=>onMessage(text,'activity'));
   conversation.push({role:'assistant',content:raw});
   if(signal.aborted)throw new DOMException('Stopped','AbortError');
   let reply:AgentReply;
   try{reply=validateReply(raw);invalid=0}catch(e){if(++invalid>2)throw new Error('This model could not follow the action format after two repairs. Select another free model; staged work is preserved.');onMessage('The response was incomplete or invalid. Asking the model to repair it.','activity');observation=`Your last output could not be parsed: ${String(e)}. Use the exact JSON schema. Prefer one small exact edit per response, keeping output short.`;continue}
   if(reply.message)onMessage(reply.message,'assistant');
   const results:string[]=[];let failed=false;const delivered:string[]=[];
   for(const action of reply.actions) {
     if(signal.aborted)throw new DOMException('Stopped','AbortError');
     const current=mergeFiles(project.files,changes) as Files;
     const path=action.path!;
     if(['write_file','edit_file','delete_file'].includes(action.type)&&mode==='plan'){results.push('Edits are disabled in plan mode.');failed=true;continue}
     if(action.type==='read_file'){
      const content=current[path];const partial=action.startLine!==undefined;
      const read=partial?content?.split('\n').slice(action.startLine!-1,action.endLine).join('\n'):content;
      if(read!==undefined&&read.length>contextLimit){failed=true;results.push('Cannot safely read '+path+': this exceeds the context budget. Use a smaller startLine/endLine range and edit_file, never overwrite unread content.')}
      else {if(content!==undefined){if(!partial)fullyRead.add(path);fragments.set(path,[...(fragments.get(path)||[]).slice(-9),read!]);delivered.push(path)}results.push(`FILE ${path}${partial?' · lines '+action.startLine+'–'+action.endLine:''}:\n${read??'File does not exist.'}`)}
     }
     if(action.type==='list_files')results.push(Object.keys(current).filter(p=>!isPrivatePath(p)).join('\n'));
     if(action.type==='search')results.push(Object.entries(current).filter(([p])=>!isPrivatePath(p)).flatMap(([p,c])=>c.split('\n').map((line,i)=>line.toLowerCase().includes(action.query!.toLowerCase())?`${p}:${i+1}: ${line}`:'').filter(Boolean)).slice(0,35).join('\n')||'No matches.');
     if(action.type==='write_file'){if(path in current&&!fullyRead.has(path)){failed=true;results.push('Cannot overwrite '+path+' before reading its full contents. Use read_file first, or an exact edit_file patch after reading a range.');continue}if(Object.keys(current).length>=150 && !(path in current))throw new Error('Workspace is limited to 150 files.');changes[path]=action.content!;results.push('Staged '+path);onChanges({...changes})}
     if(action.type==='edit_file'){
      if(!fragments.get(path)?.some(text=>text.includes(action.find!))){failed=true;results.push('Read the exact text you want to edit in '+path+' first.');continue}
      try{changes[path]=exactEdit(current[path],action.find!,action.replace!);results.push('Staged exact edit of '+path);onChanges({...changes})}catch(e){failed=true;results.push((e as Error).message)}
     }
     if(action.type==='delete_file'){if(!fullyRead.has(path)){failed=true;results.push('Read '+path+' before proposing its deletion.');continue}changes[path]=null;results.push('Staged deletion of '+path);onChanges({...changes})}
     if(action.type==='check_project'){const issues=checkProject(current);results.push(issues.length?issues.join('\n'):'JSON and local HTML resource checks passed. Runtime testing still requires Preview.')}
     if(action.type==='review_quality'){const issues=qualityReview(current);results.push(issues.length?issues.join('\n'):'Basic HTML quality checks passed. Manually check responsive layout, focus, contrast and interaction in Preview.')}
     onMessage(`${action.type.replaceAll('_',' ')}${path?' · '+path:action.query?' · '+action.query:''}`,'activity');
   }
   observation=results.join('\n\n');if(observation.length>contextLimit){for(const path of delivered){fullyRead.delete(path);fragments.delete(path)}failed=true;observation='Tool results exceeded the context budget. File reads were withheld. Read one smaller range per step; use exact edits and preserve unread content.'}
   if(reply.done&&!failed){
    if(mode==='agent'&&Object.keys(changes).length){const merged=mergeFiles(project.files,changes) as Files;const issues=[...checkProject(merged),...(config.quality==='polished'?qualityReview(merged):[])];
     if(issues.length&&config.quality==='polished'&&!polishPass&&step+1<config.maxSteps){polishPass=true;observation+='\nFinal static review:\n'+issues.join('\n')+'\nFix relevant issues with focused edits before finishing.';onMessage('Polish pass · checking accessibility, mobile metadata and local resources.','activity');continue}
     onMessage(issues.length?'Static review needs attention:\n'+issues.join('\n'):'Static review passed. Check layout and interaction in Preview before applying.','activity');
    }onToken('');return changes
   }
 }
 onMessage('The step limit was reached. Review the staged work, then send a follow-up to continue.','assistant');onToken('');return changes;
}
