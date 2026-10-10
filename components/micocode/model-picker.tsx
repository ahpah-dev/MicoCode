'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Check} from 'lucide-react';
import {groupRouterModels,matchModel} from '@/lib/mico/providers.mjs';

export type PickerModel={id:string;name:string;verified?:boolean;paid?:boolean;provider?:string};
type Props={models:PickerModel[];value:string;onChange:(id:string)=>void;disabled?:boolean;placeholder?:string;label?:string;hint?:string};

function shortName(m:PickerModel){
 const name=m.name&&m.name!==m.id?m.name:m.id;
 if(name!==m.id)return name;
 const slash=m.id.indexOf('/');
 return slash>0?m.id.slice(slash+1):m.id;
}

export function ModelPicker({models,value,onChange,disabled=false,placeholder='Search routes or type a model ID',label='Model',hint='pick a route or type any model ID'}:Props){
 const [query,setQuery]=useState(value);
 const [open,setOpen]=useState(false);
 const [highlight,setHighlight]=useState(0);
 const root=useRef<HTMLDivElement>(null);
 useEffect(()=>setQuery(value),[value]);
 useEffect(()=>{
  const close=(e:MouseEvent)=>{if(root.current&&!root.current.contains(e.target as Node))setOpen(false)};
  document.addEventListener('mousedown',close);return()=>document.removeEventListener('mousedown',close);
 },[]);
 const filtered=useMemo(()=>models.filter(m=>matchModel(m,query)),[models,query]);
 const groups=useMemo(()=>groupRouterModels(filtered),[filtered]);
 const flat=useMemo(()=>groups.flatMap(g=>g.items),[groups]);
 const exact=flat.some(m=>m.id===query.trim());
 useEffect(()=>{setHighlight(0)},[query,models]);
 function commit(id:string){onChange(id);setQuery(id);setOpen(false)}
 function onKey(e:React.KeyboardEvent){
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(!open){setOpen(true);return}setHighlight(h=>(h+(e.key==='ArrowDown'?1:-1)+Math.max(flat.length,1))%Math.max(flat.length,1))}
  else if(e.key==='Enter'){e.preventDefault();const pick=flat[highlight];commit(pick?pick.id:query.trim())}
  else if(e.key==='Escape'){setOpen(false)}
 }
 const verifiedCount=models.filter(m=>m.verified).length;
 return <div className="model-picker" ref={root}>
  <label>{label} <span className="optional-field">{hint}</span>
   <div className="model-picker-row">
    <input disabled={disabled} value={query} spellCheck={false} autoComplete="off" placeholder={placeholder}
     onChange={e=>{setQuery(e.target.value);onChange(e.target.value);setOpen(true)}}
     onFocus={()=>setOpen(true)} onKeyDown={onKey} role="combobox" aria-expanded={open} aria-label={label}/>
    {models.length>0&&<span className="model-count">{models.length} routes{verifiedCount?' · '+verifiedCount+' free':''}</span>}
   </div>
  </label>
  {open&&!disabled&&(flat.length>0||query.trim())&&<div className="model-menu" role="listbox">
   {groups.map(g=><div key={g.provider||'Other'}>
    <div className="model-group"><span>{g.provider||'Other'}</span><span>{g.items.length}</span></div>
    {g.items.map(m=><button type="button" key={m.id} role="option" aria-selected={m.id===value}
      className={'model-option'+(flat[highlight]===m?' highlighted':'')}
      onMouseEnter={()=>setHighlight(flat.indexOf(m))}
      onClick={()=>commit(m.id)}>
      <div><strong>{shortName(m)}</strong><small>{shortName(m)===m.id?(m.provider||'custom route'):m.id}</small></div>
      {m.verified&&<span className="model-badge free">Free</span>}
      {m.paid&&<span className="model-badge paid">Paid</span>}
      {m.id===value&&<Check size={13}/>}
     </button>)}
   </div>)}
   {query.trim()&&!exact&&<button type="button" className="model-option model-custom" onClick={()=>commit(query.trim())}>
    <div><strong>Use “{query.trim()}”</strong><small>custom model ID, not in the discovered list</small></div>
   </button>}
   {flat.length===0&&!query.trim()&&<div className="model-empty">No discovered routes yet. Connect to list them, or type a model ID.</div>}
  </div>}
 </div>;
}
