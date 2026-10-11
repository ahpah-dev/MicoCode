'use client';
import {useEffect,useRef,useState} from 'react';
import {Monitor,Smartphone,RotateCw,Globe} from 'lucide-react';
import type {Files} from '@/lib/mico/types';
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
 const capture=doc.createElement('script');capture.textContent=scriptText(`(()=>{const token=${JSON.stringify(token)};const send=(level,args)=>{try{parent.postMessage({mico:token,level,text:args.map(v=>typeof v==='string'?v:JSON.stringify(v)).join(' ').slice(0,3000)},'*')}catch{}};for(const level of ['log','warn','error','info']){const original=console[level];console[level]=(...args)=>{original.apply(console,args);send(level,args)}}window.addEventListener('error',e=>send('error',[e.message]));window.addEventListener('unhandledrejection',e=>send('error',[String(e.reason)]));})();`);
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
export default function Preview({files,onLog,revision,pending}:{files:Files;onLog:(s:string)=>void;revision:number;pending:boolean}) {
 const [mobile,setMobile]=useState(false);const [reload,setReload]=useState(0);const [content,setContent]=useState('');const [error,setError]=useState('');const iframe=useRef<HTMLIFrameElement>(null);const logRef=useRef(onLog);logRef.current=onLog;
 const [selected,setSelected]=useState('index.html');const entries=Object.keys(files).filter(p=>p.endsWith('.html'));const entry=entries.includes(selected)?selected:entries[0]||'';
 useEffect(()=>{const token=crypto.randomUUID();let urls:string[]=[];let listener:(e:MessageEvent)=>void;const timer=setTimeout(()=>{try{const result=makePreview(files,entry,token);urls=result.urls;setContent(result.html);setError('')}catch(e){setError(String(e))}listener=e=>{if(e.source===iframe.current?.contentWindow&&e.data?.mico===token&&typeof e.data.text==='string')logRef.current(`[${e.data.level}] ${e.data.text}`)};window.addEventListener('message',listener)},450);return()=>{clearTimeout(timer);urls.forEach(URL.revokeObjectURL);if(listener)window.removeEventListener('message',listener)}},[files,entry,reload,revision]);
 return <div className="preview"><div className="preview-toolbar"><button className="icon-button" title="Reload preview" onClick={()=>setReload(v=>v+1)}><RotateCw size={14}/></button><div className="address"><Globe size={12}/><select aria-label="Preview entry file" value={entry} onChange={e=>setSelected(e.target.value)}>{entries.map(p=><option key={p}>{p}</option>)}</select>{pending&&<span className="pending-label">staged</span>}</div><button title="Desktop preview" className={'icon-button '+(!mobile?'selected':'')} onClick={()=>setMobile(false)}><Monitor size={15}/></button><button title="Mobile preview" className={'icon-button '+(mobile?'selected':'')} onClick={()=>setMobile(true)}><Smartphone size={14}/></button></div><div className={'preview-canvas '+(mobile?'mobile':'')}>{error?<div className="empty"><p>{error}</p></div>:!entry?<div className="empty">Add an HTML file to preview this project.</div>:<iframe title="Project preview" ref={iframe} srcDoc={content} sandbox="allow-scripts" referrerPolicy="no-referrer"/>}</div></div>;
}
