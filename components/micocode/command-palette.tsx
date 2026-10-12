'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {CornerDownLeft,Search} from 'lucide-react';
import {Modal} from './primitives';
import {paletteKeyAction} from '@/lib/mico/interface';

export type PaletteCommand={name:string;shortcut?:string;keywords?:string;action:()=>void};

/** Quick actions: one list, fully reachable from the keyboard. Typing filters,
 *  the arrows and Home/End move the highlight, and Enter runs the highlighted
 *  command. Escape closes through the dialog's own cancel handling. */
export function CommandPalette({commands,locked,onClose}:{commands:PaletteCommand[];locked:boolean;onClose:()=>void}){
 const [query,setQuery]=useState('');
 const [active,setActive]=useState(0);
 const list=useRef<HTMLDivElement>(null);
 const matches=useMemo(()=>{
  const needle=query.trim().toLowerCase();
  if(!needle)return commands;
  return commands.filter(command=>(command.name+' '+(command.keywords??'')).toLowerCase().includes(needle));
 },[commands,query]);
 useEffect(()=>setActive(current=>matches.length?Math.min(current,matches.length-1):-1),[matches]);
 useEffect(()=>{
  const node=list.current?.querySelector<HTMLElement>('[aria-selected="true"]');
  node?.scrollIntoView({block:'nearest'});
 },[active,matches]);
 function run(command:PaletteCommand|undefined){
  if(!command||locked)return;
  onClose();
  command.action();
 }
 return <Modal title="Go somewhere. Make something." onClose={onClose}>
  <div className="palette-search"><Search size={16}/><input autoFocus value={query} role="combobox" aria-expanded="true" aria-controls="mico-command-list" aria-activedescendant={active>=0?'mico-command-'+active:undefined} aria-label="Search actions" placeholder="Search actions or files…" onChange={e=>{setQuery(e.target.value);setActive(0)}} onKeyDown={e=>{
   const result=paletteKeyAction(e.key,active,matches.length);
   if(!result)return;
   e.preventDefault();
   if(result.type==='move')setActive(result.index);
   else run(matches[active]);
  }}/></div>
  <div className="command-list" id="mico-command-list" role="listbox" aria-label="Quick actions" ref={list}>
   {matches.map((command,index)=><button
    key={command.name}
    id={'mico-command-'+index}
    type="button"
    role="option"
    aria-selected={index===active}
    tabIndex={-1}
    className={index===active?'active':''}
    disabled={locked}
    onMouseMove={()=>setActive(index)}
    onClick={()=>run(command)}>{command.name}{command.shortcut&&<kbd>{command.shortcut}</kbd>}<CornerDownLeft size={13}/></button>)}
   {!matches.length&&<p className="command-empty">No action matches “{query.trim()}”. Try “preview”, “export”, or a file name.</p>}
  </div>
 </Modal>;
}
