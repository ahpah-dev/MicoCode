'use client';
import {useEffect,useRef,useState} from 'react';
import {Monitor,Smartphone,RotateCw,Globe,Crosshair,Terminal,Trash2,ChevronDown,Sparkles} from 'lucide-react';
import type {Files} from '@/lib/mico/types';

export interface PreviewLogItem {
 id:string;
 level:'log'|'warn'|'error'|'info';
 text:string;
 time:number;
}

export interface TargetElementContext {
 selector:string;
 html:string;
 text:string;
 tagName:string;
}

export interface PreviewProps {
 files:Files;
 onLog:((s:string)=>void)|undefined;
 revision:number;
 pending:boolean;
 onTargetElement?:(ctx:TargetElementContext)=>void;
 onFixError?:(errorText:string,entry:string)=>void;
}

function resolveFile(base:string,path:string){ const stack=path.startsWith('/')?[]:base.split('/').slice(0,-1);for(const part of path.split('/')){if(part==='..')stack.pop();else if(part&&part!=='.')stack.push(part)}return stack.join('/'); }

// HTML serialization does not escape script text. Keep literal closing tags
// inside JavaScript strings/comments from terminating the generated element.
function scriptText(code:string){return code.replace(/<\/script/gi,match=>'<\\/'+match.slice(2))}

export function makePreview(files:Files,entry:string,token:string) {
 const urls:string[]=[];
 const doc=new DOMParser().parseFromString(files[entry]||'<h1>No HTML entry point</h1>','text/html');
 doc.querySelectorAll('base').forEach(n=>n.remove());
 const csp=doc.createElement('meta');csp.httpEquiv='Content-Security-Policy';csp.content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' data: blob: https:; style-src 'unsafe-inline' blob: https:; img-src data: blob: https:; font-src data: https:; connect-src https:; media-src data: blob: https:; frame-src 'none'; form-action 'none';";
 doc.head.insertBefore(csp,doc.head.firstChild);
 const modules:Files={};const visiting=new Set<string>();
 const localImport=/((?:from\s*|import\s*\(?\s*)["'])((?:\.{1,2}\/|\/)[^"']+)(["'])/g;
 function collectModule(path:string,source=files[path]):void {
  if(visiting.has(path))throw new Error('Circular local module imports need a local build tool. Export this project to run it.');
  if(path in modules)return;if(source===undefined)throw new Error('Missing module '+path);
  visiting.add(path);source.replace(localImport,(_match,_a,p)=>{collectModule(resolveFile(path,p));return _match});visiting.delete(path);modules[path]=source;
 }
 const runtimeKey='mico-preview-modules-'+token;
 const deferred:HTMLScriptElement[]=[];
 for(const link of doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')) {const p=resolveFile(entry,link.getAttribute('href')||'');if(files[p]!==undefined){const s=doc.createElement('style');s.textContent=files[p];link.replaceWith(s)}}
 for(const [index,script] of [...doc.querySelectorAll<HTMLScriptElement>('script')].entries()) {
  const src=script.getAttribute('src');const path=src?resolveFile(entry,src):resolveFile(entry,`.mico-inline-${index}.js`);
  const source=src?files[path]:script.textContent||'';
  if(source===undefined)continue;
  if(script.type==='module') {
   collectModule(path,source);script.removeAttribute('src');script.removeAttribute('integrity');
   script.textContent=scriptText(`await import(globalThis[${JSON.stringify(runtimeKey)}](${JSON.stringify(path)}));`);
  }else if(src) {
   script.removeAttribute('src');script.removeAttribute('integrity');script.textContent=scriptText(source);
   if(script.hasAttribute('defer')&&!script.hasAttribute('async')){script.removeAttribute('defer');deferred.push(script)}
  }
 }
 // Local deferred classic scripts run after the document has been parsed.
 for(const script of deferred)doc.body.append(script);

 const capture=doc.createElement('script');
 capture.textContent=scriptText(`(()=>{
  const token=${JSON.stringify(token)};
  const send=(level,args)=>{
   try{
    parent.postMessage({
     mico:token,
     level,
     text:args.map(v=>typeof v==='string'?v:JSON.stringify(v)).join(' ').slice(0,3000),
     time:Date.now()
    },'*');
   }catch{}
  };
  for(const level of ['log','warn','error','info']){
   const original=console[level];
   console[level]=(...args)=>{original.apply(console,args);send(level,args)};
  }
  window.addEventListener('error',e=>send('error',[e.message||String(e)]));
  window.addEventListener('unhandledrejection',e=>send('error',[e.reason?(e.reason.message||String(e.reason)):'Unhandled rejection']));

  let inspecting=false;let overlay=null;let badge=null;let lastTarget=null;
  function ensureOverlay(){
   if(overlay&&badge)return;
   overlay=document.createElement('div');
   overlay.id='__mico_inspector_overlay';
   overlay.style.cssText='position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #00f0a8;background:rgba(0,240,168,0.12);border-radius:4px;box-shadow:0 0 0 1px rgba(0,0,0,0.6),0 0 14px rgba(0,240,168,0.35);transition:all 0.04s ease;display:none;';
   badge=document.createElement('div');
   badge.id='__mico_inspector_badge';
   badge.style.cssText='position:fixed;pointer-events:none;z-index:2147483647;background:#0d1117;color:#a5eac8;border:1px solid #30363d;padding:2px 8px;font:600 11px/1.3 monospace;border-radius:4px;box-shadow:0 4px 12px rgba(0,0,0,0.5);white-space:nowrap;display:none;';
   (document.body||document.documentElement).appendChild(overlay);
   (document.body||document.documentElement).appendChild(badge);
  }
  function getSelector(el){
   if(!el||el===document.body||el===document.documentElement)return el?el.tagName.toLowerCase():'';
   if(el.id)return '#'+CSS.escape(el.id);
   let sel=el.tagName.toLowerCase();
   if(el.className&&typeof el.className==='string'){
    const classes=el.className.trim().split(/\\s+/).filter(c=>c&&!c.startsWith('__mico')).slice(0,2);
    if(classes.length)sel+='.'+classes.map(c=>CSS.escape(c)).join('.');
   }
   const parent=el.parentElement;
   if(parent&&parent!==document.body&&parent!==document.documentElement){
    if(parent.id){
     sel='#'+CSS.escape(parent.id)+' > '+sel;
    }else if(parent.className&&typeof parent.className==='string'){
     const pClass=parent.className.trim().split(/\\s+/)[0];
     if(pClass)sel=parent.tagName.toLowerCase()+'.'+CSS.escape(pClass)+' > '+sel;
    }
   }
   return sel;
  }
  function onMouseMove(e){
   if(!inspecting)return;
   ensureOverlay();
   const target=document.elementFromPoint(e.clientX,e.clientY);
   if(!target||target===overlay||target===badge||target===document.documentElement||target===document.body){
    if(overlay)overlay.style.display='none';
    if(badge)badge.style.display='none';
    lastTarget=null;
    return;
   }
   lastTarget=target;
   const rect=target.getBoundingClientRect();
   overlay.style.display='block';
   overlay.style.top=Math.max(0,rect.top)+'px';
   overlay.style.left=Math.max(0,rect.left)+'px';
   overlay.style.width=Math.max(6,rect.width)+'px';
   overlay.style.height=Math.max(6,rect.height)+'px';

   badge.style.display='block';
   const tag=target.tagName.toLowerCase();
   const cls=(target.className&&typeof target.className==='string')?'.'+target.className.trim().split(/\\s+/).filter(c=>c&&!c.startsWith('__mico')).slice(0,1).join('.'):'';
   badge.textContent=tag+cls+' '+Math.round(rect.width)+'x'+Math.round(rect.height);
   const badgeTop=rect.top>26?rect.top-24:rect.bottom+4;
   badge.style.top=Math.max(2,badgeTop)+'px';
   badge.style.left=Math.max(2,Math.min(window.innerWidth-120,rect.left))+'px';
  }
  function onClick(e){
   if(!inspecting)return;
   e.preventDefault();
   e.stopPropagation();
   e.stopImmediatePropagation();
   const target=lastTarget||document.elementFromPoint(e.clientX,e.clientY);
   if(target&&target!==overlay&&target!==badge){
    const selector=getSelector(target);
    const text=(target.innerText||target.textContent||'').trim().replace(/\\s+/g,' ').slice(0,80);
    const html=target.outerHTML?target.outerHTML.slice(0,300):'';
    const tagName=target.tagName.toLowerCase();
    try{
     parent.postMessage({
      mico:token,
      type:'mico-element-selected',
      selector,
      text,
      html,
      tagName
     },'*');
    }catch{}
   }
   setInspect(false);
  }
  function setInspect(active){
   inspecting=!!active;
   if(inspecting){
    ensureOverlay();
    window.addEventListener('mousemove',onMouseMove,{passive:true,capture:true});
    window.addEventListener('click',onClick,{capture:true});
    document.documentElement.style.cursor='crosshair';
   }else{
    window.removeEventListener('mousemove',onMouseMove,{capture:true});
    window.removeEventListener('click',onClick,{capture:true});
    document.documentElement.style.cursor='';
    if(overlay)overlay.style.display='none';
    if(badge)badge.style.display='none';
   }
  }
  window.addEventListener('keydown',e=>{
   if(e.key==='Escape'&&inspecting){
    setInspect(false);
    try{parent.postMessage({mico:token,type:'mico-inspect-cancelled'},'*');}catch{}
   }
  },{capture:true});
  window.addEventListener('message',e=>{
   if(e.data?.micoAction==='set-inspect'){
    setInspect(e.data.enabled);
   }
  });
 })();`);
 doc.head.insertBefore(capture,csp.nextSibling);

 if(Object.keys(modules).length) {
  // Blob URLs must belong to the sandboxed frame's opaque origin. Creating
  // them in the parent would make module imports fail the CORS check.
  const runtime=doc.createElement('script');
  runtime.textContent=scriptText(`(()=>{const sources=${JSON.stringify(modules)};const cache=new Map();const urls=[];const resolve=${resolveFile.toString()};const imports=${localImport.toString()};const make=path=>{if(cache.has(path))return cache.get(path);const code=sources[path].replace(imports,(_match,a,p,b)=>a+make(resolve(path,p))+b);const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));urls.push(url);cache.set(path,url);return url};globalThis[${JSON.stringify(runtimeKey)}]=make;window.addEventListener('pagehide',()=>urls.forEach(url=>URL.revokeObjectURL(url)));})();`);
  doc.head.insertBefore(runtime,capture.nextSibling);
 }
 return {html:'<!DOCTYPE html>\n'+doc.documentElement.outerHTML,urls};
}

export default function Preview({files,onLog,revision,pending,onTargetElement,onFixError}:PreviewProps) {
 const [mobile,setMobile]=useState(false);
 const [reload,setReload]=useState(0);
 const [content,setContent]=useState('');
 const [error,setError]=useState('');
 const [inspecting,setInspecting]=useState(false);
 const [consoleOpen,setConsoleOpen]=useState(false);
 const [logFilter,setLogFilter]=useState<'all'|'error'|'log'>('all');
 const [logs,setLogs]=useState<PreviewLogItem[]>([]);
 const [toastNotice,setToastNotice]=useState('');
 const iframe=useRef<HTMLIFrameElement>(null);
 const logRef=useRef(onLog);
 logRef.current=onLog;

 const [selected,setSelected]=useState('index.html');
 const entries=Object.keys(files).filter(p=>p.endsWith('.html'));
 const entry=entries.includes(selected)?selected:entries[0]||'';

 const toggleInspect=(explicit?:boolean)=>{
  const next=typeof explicit==='boolean'?explicit:!inspecting;
  setInspecting(next);
  try{
   iframe.current?.contentWindow?.postMessage({micoAction:'set-inspect',enabled:next},'*');
  }catch{}
 };

 useEffect(()=>{
  const handleKey=(e:KeyboardEvent)=>{
   if(e.key==='Escape'&&inspecting){
    toggleInspect(false);
   }
  };
  window.addEventListener('keydown',handleKey);
  return()=>window.removeEventListener('keydown',handleKey);
 },[inspecting]);

 useEffect(()=>{
  if(!toastNotice)return;
  const t=setTimeout(()=>setToastNotice(''),2500);
  return()=>clearTimeout(t);
 },[toastNotice]);

 useEffect(()=>{
  const token=crypto.randomUUID();
  let urls:string[]=[];
  let listener:(e:MessageEvent)=>void;
  setInspecting(false);
  const timer=setTimeout(()=>{
   try{
    const result=makePreview(files,entry,token);
    urls=result.urls;
    setContent(result.html);
    setError('');
   }catch(e){
    setError(String(e));
   }
   listener=e=>{
    if(e.source!==iframe.current?.contentWindow||e.data?.mico!==token)return;
    if(e.data?.type==='mico-element-selected'){
     setInspecting(false);
     setToastNotice(`Targeted <${e.data.tagName}>`);
     onTargetElement?.({
      selector:e.data.selector,
      html:e.data.html,
      text:e.data.text,
      tagName:e.data.tagName,
     });
     return;
    }
    if(e.data?.type==='mico-inspect-cancelled'){
     setInspecting(false);
     return;
    }
    if(typeof e.data.text==='string'){
     const level=(e.data.level||'log') as PreviewLogItem['level'];
     logRef.current?.(`[${level}] ${e.data.text}`);
     const item:PreviewLogItem={
      id:Math.random().toString(36).slice(2,9),
      level,
      text:e.data.text,
      time:e.data.time||Date.now(),
     };
     setLogs(prev=>[...prev.slice(-199),item]);
    }
   };
   window.addEventListener('message',listener);
  },450);

  return()=>{
   clearTimeout(timer);
   urls.forEach(URL.revokeObjectURL);
   if(listener)window.removeEventListener('message',listener);
  };
 },[files,entry,reload,revision,onTargetElement]);

 const errorCount=logs.filter(l=>l.level==='error').length;
 const filteredLogs=logs.filter(l=>logFilter==='all'?true:logFilter==='error'?l.level==='error':l.level!=='error');

 return (
  <div className="preview">
   <div className="preview-toolbar">
    <button className="icon-button" title="Reload preview" onClick={()=>{setReload(v=>v+1);setLogs([])}}>
     <RotateCw size={14}/>
    </button>
    <button
     className={'icon-button preview-inspect-btn '+(inspecting?'selected active':'')}
     title={inspecting?'Inspecting element (Esc to cancel)':'Point-and-prompt: click any element to ask Mico'}
     onClick={()=>toggleInspect()}
    >
     <Crosshair size={14}/>
    </button>
    <div className="address">
     <Globe size={12}/>
     <select aria-label="Preview entry file" value={entry} onChange={e=>setSelected(e.target.value)}>
      {entries.map(p=><option key={p}>{p}</option>)}
     </select>
     {pending&&<span className="pending-label">staged</span>}
    </div>
    <button
     className={'icon-button preview-console-btn '+(consoleOpen?'selected':'')}
     title={consoleOpen?'Hide preview console':'Show preview console'}
     onClick={()=>setConsoleOpen(v=>!v)}
    >
     <Terminal size={14}/>
     {errorCount>0?<span className="preview-badge error">{errorCount}</span>:logs.length>0?<span className="preview-badge">{logs.length}</span>:null}
    </button>
    <button title="Desktop preview" className={'icon-button '+(!mobile?'selected':'')} onClick={()=>setMobile(false)}>
     <Monitor size={15}/>
    </button>
    <button title="Mobile preview" className={'icon-button '+(mobile?'selected':'')} onClick={()=>setMobile(true)}>
     <Smartphone size={14}/>
    </button>
   </div>

   <div className={'preview-canvas '+(mobile?'mobile':'')}>
    {inspecting&&<div className="preview-inspect-banner"><Crosshair size={12}/><span>Point &amp; click any element to ask Mico</span><button onClick={()=>toggleInspect(false)}>Cancel <kbd>Esc</kbd></button></div>}
    {toastNotice&&<div className="preview-toast-notice">{toastNotice}</div>}
    {error?<div className="empty"><p>{error}</p></div>:!entry?<div className="empty">Add an HTML file to preview this project.</div>:<iframe title="Project preview" ref={iframe} srcDoc={content} sandbox="allow-scripts" referrerPolicy="no-referrer"/>}
   </div>

   {consoleOpen&&(
    <div className="preview-console-drawer">
     <div className="preview-console-header">
      <div className="preview-console-tabs">
       <button className={logFilter==='all'?'active':''} onClick={()=>setLogFilter('all')}>
        All <span className="tab-count">{logs.length}</span>
       </button>
       <button className={logFilter==='error'?'active':''} onClick={()=>setLogFilter('error')}>
        Errors <span className={'tab-count '+(errorCount>0?'error':'')}>{errorCount}</span>
       </button>
       <button className={logFilter==='log'?'active':''} onClick={()=>setLogFilter('log')}>
        Logs <span className="tab-count">{logs.filter(l=>l.level!=='error').length}</span>
       </button>
      </div>
      <div className="preview-console-actions">
       <button className="icon-button" title="Clear console logs" onClick={()=>setLogs([])}>
        <Trash2 size={13}/>
       </button>
       <button className="icon-button" title="Close console drawer" onClick={()=>setConsoleOpen(false)}>
        <ChevronDown size={14}/>
       </button>
      </div>
     </div>
     <div className="preview-console-body">
      {filteredLogs.length===0?(
       <div className="preview-console-empty">
        {logFilter==='error'?'No preview errors captured.':'Console is clear. Preview output and errors will appear here.'}
       </div>
      ):(
       filteredLogs.map(item=>(
        <div key={item.id} className={'preview-log-row '+item.level}>
         <span className="log-time">{new Date(item.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span>
         <span className={'log-level '+item.level}>{item.level.toUpperCase()}</span>
         <pre className="log-text">{item.text}</pre>
         {item.level==='error'&&onFixError&&(
          <button className="preview-fix-btn" onClick={()=>onFixError(item.text,entry)} title="Ask Mico to fix this error">
           <Sparkles size={11}/>
           <span>Fix with Mico</span>
          </button>
         )}
        </div>
       ))
      )}
     </div>
    </div>
   )}
  </div>
 );
}
