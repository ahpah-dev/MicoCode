import {useEffect,useSyncExternalStore} from 'react';

export const themes=[
 {id:'forest',name:'Forest',description:'A familiar little green.',background:'#111815',accent:'#a5eac8',dark:true},
 {id:'graphite',name:'Graphite',description:'Quiet charcoal. Warm details.',background:'#151515',accent:'#edc49c',dark:true},
 {id:'midnight',name:'Midnight',description:'Blue skies after hours.',background:'#101624',accent:'#9dc8ff',dark:true},
 {id:'violet',name:'Violet',description:'A softer kind of focus.',background:'#191322',accent:'#cdb1ff',dark:true},
 {id:'paper',name:'Paper',description:'A fresh page. A little daylight.',background:'#f8f6ef',accent:'#24634e',dark:false},
] as const;
export type ThemeId=typeof themes[number]['id'];
const key='mico-appearance:v1';
let current:ThemeId='forest';
const listeners=new Set<()=>void>();
function valid(value:unknown):value is ThemeId{return themes.some(t=>t.id===value)}
function apply(theme:ThemeId){
 const palette=themes.find(t=>t.id===theme)!;
 document.documentElement.dataset.theme=theme;
 document.documentElement.style.colorScheme=palette.dark?'dark':'light';
 document.querySelector('meta[name="theme-color"]')?.setAttribute('content',palette.background);
 void window.micoDesktop?.appearance(theme).catch(()=>{});
}
export function setTheme(theme:ThemeId){
 if(!valid(theme))return;
 current=theme;apply(theme);
 try{localStorage.setItem(key,theme)}catch{/* Still works when storage is unavailable. */}
 listeners.forEach(fn=>fn());
}
function subscribe(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn)}}
export function useTheme(){
 const theme=useSyncExternalStore(subscribe,()=>current,()=> 'forest' as ThemeId);
 useEffect(()=>{
  let saved:unknown;try{saved=localStorage.getItem(key)}catch{}
  if(valid(saved)&&saved!==current){current=saved;listeners.forEach(fn=>fn())}
  apply(current);
  const sync=(e:StorageEvent)=>{if(e.key===key&&valid(e.newValue)){current=e.newValue;apply(current);listeners.forEach(fn=>fn())}};
  window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync);
 },[]);
 return [theme,setTheme] as const;
}
