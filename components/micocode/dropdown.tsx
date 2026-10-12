'use client';
import {useEffect,useId,useMemo,useRef,useState} from 'react';
import {Check,ChevronDown} from 'lucide-react';
import {paletteKeyAction,typeaheadIndex} from '@/lib/mico/interface';

export type DropdownOption={value:string;label:string;description?:string};
export type DropdownGroup={label:string;options:DropdownOption[]};

type Props={
 value:string;
 onChange:(value:string)=>void;
 options?:DropdownOption[];
 groups?:DropdownGroup[];
 /** Accessible name for the control. The visible label lives in the caller. */
 label:string;
 placeholder?:string;
 disabled?:boolean;
 className?:string;
};

/** One dropdown for the whole workspace, painted on the same surface as the
 *  model menu: opaque panel, grouped rows, a check on the current value, and a
 *  highlight the arrow keys move. Keyboard, pointer, and typeahead all drive the
 *  same flat list, so every dropdown behaves the way the model menu does. */
export function Dropdown({value,onChange,options=[],groups,label,placeholder='Choose…',disabled=false,className=''}:Props){
 const flat=useMemo(()=>groups?groups.flatMap(group=>group.options):options,[groups,options]);
 const index=new Map(flat.map((option,i)=>[option,i]));
 const current=flat.find(option=>option.value===value);
 const [open,setOpen]=useState(false);
 const [active,setActive]=useState(0);
 // A menu that only ever grows downwards gets clipped by the dialog around it,
 // so it flips above the trigger when that side has more room and never takes
 // more height than the space it actually has.
 const [placement,setPlacement]=useState<'below'|'above'>('below');
 const [maxHeight,setMaxHeight]=useState(290);
 const root=useRef<HTMLDivElement>(null);
 const trigger=useRef<HTMLButtonElement>(null);
 const menu=useRef<HTMLDivElement>(null);
 const typed=useRef({text:'',at:0});
 const base=useId();
 const menuId=base+'-list';
 const optionId=(i:number)=>base+'-option-'+i;
 const selectedIndex=()=>flat.findIndex(option=>option.value===value);

 function place(){
  const rect=trigger.current?.getBoundingClientRect();
  if(!rect)return;
  const below=window.innerHeight-rect.bottom-16;
  const above=rect.top-16;
  const next=below<250&&above>below?'above':'below';
  setPlacement(next);
  setMaxHeight(Math.max(140,Math.min(290,next==='above'?above:below)));
 }

 useEffect(()=>{
  if(!open)return;
  const close=(e:MouseEvent)=>{if(root.current&&!root.current.contains(e.target as Node))setOpen(false)};
  const reposition=()=>place();
  document.addEventListener('mousedown',close);
  window.addEventListener('resize',reposition);
  window.addEventListener('scroll',reposition,true);
  return()=>{
   document.removeEventListener('mousedown',close);
   window.removeEventListener('resize',reposition);
   window.removeEventListener('scroll',reposition,true);
  };
 },[open]);

 useEffect(()=>{
  if(!open)return;
  menu.current?.querySelector<HTMLElement>('.dropdown-option.highlighted')?.scrollIntoView({block:'nearest'});
 },[open,active]);

 function openAt(index:number){place();setActive(index<0?0:index);setOpen(true)}
 function commit(option:DropdownOption|undefined){
  if(!option)return;
  onChange(option.value);
  setOpen(false);
  trigger.current?.focus({preventScroll:true});
 }
 function onKeyDown(e:React.KeyboardEvent){
  if(disabled)return;
  if(!open){
   if(e.key==='ArrowDown'||e.key==='ArrowUp'||e.key==='Enter'||e.key===' '){e.preventDefault();openAt(selectedIndex())}
   return;
  }
  if(e.key==='Tab'){setOpen(false);return}
  const result=paletteKeyAction(e.key,active,flat.length);
  if(result){
   e.preventDefault();
   if(result.type==='move')setActive(result.index);
   else commit(flat[active]);
   return;
  }
  if(e.key.length===1&&!e.ctrlKey&&!e.metaKey&&!e.altKey){
   const now=Date.now();
   typed.current={text:(now-typed.current.at>700?'':typed.current.text)+e.key,at:now};
   const found=typeaheadIndex(flat.map(option=>option.label),typed.current.text,active);
   if(found>=0){e.preventDefault();setActive(found)}
  }
 }

 function row(option:DropdownOption){
  const i=index.get(option)??0;
  const selected=option.value===value;
  return <button
   key={option.value}
   type="button"
   role="option"
   id={optionId(i)}
   aria-selected={selected}
   tabIndex={-1}
   className={'dropdown-option'+(i===active?' highlighted':'')}
   onMouseEnter={()=>setActive(i)}
   onClick={()=>commit(option)}>
   <div><strong>{option.label}</strong>{option.description&&<small>{option.description}</small>}</div>
   {selected&&<Check size={13}/>}
  </button>;
 }

 return <div className={'dropdown'+(open?' open':'')+(className?' '+className:'')} ref={root}>
  <button
   ref={trigger}
   type="button"
   className="dropdown-trigger"
   role="combobox"
   aria-haspopup="listbox"
   aria-expanded={open}
   aria-controls={menuId}
   aria-label={label}
   aria-activedescendant={open&&flat.length?optionId(active):undefined}
   disabled={disabled}
   onClick={()=>open?setOpen(false):openAt(selectedIndex())}
   onKeyDown={onKeyDown}>
   <span className="dropdown-value">{current?current.label:placeholder}</span>
   <ChevronDown size={14} className="dropdown-chevron"/>
  </button>
  {open&&<div className={'dropdown-menu'+(placement==='above'?' above':'')} role="listbox" id={menuId} aria-label={label} ref={menu} style={{maxHeight}}>
   {groups
    ?groups.map(group=><div key={group.label}>
      <div className="dropdown-group"><span>{group.label}</span><span>{group.options.length}</span></div>
      {group.options.map(row)}
     </div>)
    :options.map(row)}
   {!flat.length&&<div className="dropdown-empty">Nothing to choose here yet.</div>}
  </div>}
 </div>;
}
