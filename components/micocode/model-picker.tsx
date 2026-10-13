'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Check,RefreshCw,Star} from 'lucide-react';
import {groupRouterModels,matchModel} from '@/lib/mico/providers.mjs';

export type PickerModel={id:string;name:string;verified?:boolean;paid?:boolean;provider?:string;contextLength?:number;maxOutput?:number;available?:boolean;executionStatus?:string;unavailableReason?:string};
type Props={models:PickerModel[];value:string;onChange:(id:string)=>void;onRefresh?:()=>void;refreshing?:boolean;allowCustom?:boolean;disabled?:boolean;placeholder?:string;label?:string;hint?:string};

function shortName(m:PickerModel){
 const name=m.name&&m.name!==m.id?m.name:m.id;
 if(name!==m.id)return name;
 const slash=m.id.indexOf('/');
 return slash>0?m.id.slice(slash+1):m.id;
}

export function ModelPicker({models,value,onChange,onRefresh,refreshing=false,allowCustom=true,disabled=false,placeholder='Search by model or provider',label='Model',hint='search, then select a model'}:Props){
 const [query,setQuery]=useState(value);
 const [open,setOpen]=useState(false);
 const [highlight,setHighlight]=useState(0);
 const [favorites,setFavorites]=useState<string[]>([]);
 const [favoritesOnly,setFavoritesOnly]=useState(false);
 const root=useRef<HTMLDivElement>(null);
 useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem('mico-favorite-models:v1')||'[]');if(Array.isArray(saved))setFavorites(saved.filter(x=>typeof x==='string'))}catch{}},[]);
 useEffect(()=>{
  const close=(e:MouseEvent)=>{if(root.current&&!root.current.contains(e.target as Node)){setOpen(false);setQuery('')}};
  document.addEventListener('mousedown',close);return()=>document.removeEventListener('mousedown',close);
 },[]);
 const filtered=useMemo(()=>models.filter(m=>matchModel(m,query)&&(!favoritesOnly||favorites.includes(m.id))),[models,query,favoritesOnly,favorites]);
 const groups=useMemo(()=>groupRouterModels(filtered),[filtered]);
 const flat=useMemo(()=>groups.flatMap(g=>g.items),[groups]);
 const selectable=useMemo(()=>flat.filter(m=>m.available!==false),[flat]);
 const exact=flat.some(m=>m.id===query.trim());
 useEffect(()=>{setHighlight(0)},[query,models]);
 function commit(id:string){if(models.find(m=>m.id===id)?.available===false)return;onChange(id);setQuery('');setOpen(false)}
 function toggleFavorite(id:string){setFavorites(current=>{const next=current.includes(id)?current.filter(x=>x!==id):[...current,id];try{localStorage.setItem('mico-favorite-models:v1',JSON.stringify(next))}catch{}return next})}
 function onKey(e:React.KeyboardEvent){
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(!open){setOpen(true);return}setHighlight(h=>(h+(e.key==='ArrowDown'?1:-1)+Math.max(selectable.length,1))%Math.max(selectable.length,1))}
   else if(e.key==='Enter'){e.preventDefault();const exactModel=flat.find(m=>m.id===query.trim());const pick=exactModel||selectable[highlight];if(pick)commit(pick.id);else if(allowCustom&&query.trim())commit(query.trim())}
   else if(e.key==='Escape'){setOpen(false);setQuery('')}
 }
 const verifiedCount=models.filter(m=>m.verified).length;
 return <div className="model-picker" ref={root}>
  <label>{label} <span className="optional-field">{hint}</span>
   <div className="model-picker-row">
     <input disabled={disabled} value={open?query:value} spellCheck={false} autoComplete="off" placeholder={placeholder}
      onChange={e=>{setQuery(e.target.value);setOpen(true)}}
      onClick={()=>{if(!open){setQuery('');setOpen(true)}}}
      onFocus={()=>{setQuery('');setOpen(true)}} onKeyDown={onKey} role="combobox" aria-expanded={open} aria-label={label}/>
     {models.length>0&&<><button type="button" className={'model-favorites-filter '+(favoritesOnly?'active':'')} onClick={()=>{setFavoritesOnly(v=>!v);setOpen(true)}} title="Show saved models only"><Star size={12}/><span>Saved</span></button><span className="model-count">{models.length} models · {verifiedCount} free</span></>}
    {onRefresh&&<button type="button" className="model-refresh" disabled={disabled||refreshing} onClick={onRefresh} title="Refresh model catalogue" aria-label="Refresh model catalogue"><RefreshCw size={14} className={refreshing?'spin':''}/></button>}
   </div>
  </label>
   {open&&!disabled&&(flat.length>0||query.trim()||!!onRefresh)&&<div className="model-menu" role="listbox">
   {groups.map(g=><div key={g.provider||'Other'}>
    <div className="model-group"><span>{g.provider||'Other'}</span><span>{g.items.length}</span></div>
     {g.items.map(m=><div className="model-option-row" key={m.id}>
      <button type="button" role="option" aria-selected={m.id===value} disabled={m.available===false} title={m.unavailableReason}
       className={'model-option'+(selectable[highlight]===m?' highlighted':'')}
       onMouseEnter={()=>{if(m.available!==false)setHighlight(selectable.indexOf(m))}}
       onClick={()=>commit(m.id)}>
        <div><strong>{shortName(m)}</strong><small>{m.id}{m.contextLength?` · ${m.contextLength>=1000?`${Math.round(m.contextLength/1000)}k`:m.contextLength} context`:''}</small></div>
        {m.verified&&<span className="model-badge free">Free</span>}
        {m.paid&&<span className="model-badge paid">Paid</span>}
        {!m.verified&&!m.paid&&<span className="model-badge unknown">Price unknown</span>}
        {m.available===false&&<span className="model-badge unknown">{m.executionStatus==='exhausted'?'Quota exhausted':'Needs setup'}</span>}
        {m.id===value&&<Check size={13}/>}
       </button><button type="button" className={'model-favorite '+(favorites.includes(m.id)?'active':'')} aria-label={favorites.includes(m.id)?'Remove saved model':'Save model'} aria-pressed={favorites.includes(m.id)} onClick={()=>toggleFavorite(m.id)}><Star size={13} fill={favorites.includes(m.id)?'currentColor':'none'}/></button>
      </div>)}
   </div>)}
    {allowCustom&&query.trim()&&!exact&&<button type="button" className="model-option model-custom" onClick={()=>commit(query.trim())}>
    <div><strong>Use “{query.trim()}”</strong><small>custom model ID, not in the discovered list</small></div>
   </button>}
   {flat.length===0&&<div className="model-empty">{favoritesOnly?'No saved models match. Turn off Saved or star a model to keep it here.':query.trim()?(allowCustom?'No matching model. You can still use the exact ID you typed.':'No matching model. Clear the search or refresh the catalogue.'):(allowCustom?'No discovered routes yet. Connect to list them, or type a model ID.':'No discovered routes yet. Connect or refresh the catalogue.')}</div>}
  </div>}
 </div>;
}
