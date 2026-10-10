'use client';
import {useEffect,useRef,type ReactNode} from 'react';
import {X} from 'lucide-react';
export function Logo({size=28}:{size?:number}) { return <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true"><rect width="40" height="40" rx="12" fill="currentColor"/><path d="M10 27V14L20 23L30 14V27" stroke="#101b16" strokeWidth="3.3" strokeLinecap="round" strokeLinejoin="round"/><path d="M20 9V12" stroke="#101b16" strokeWidth="2.5" strokeLinecap="round"/></svg>; }
export function Modal({title,subtitle,children,onClose,wide=false}:{title:string;subtitle?:string;children:ReactNode;onClose:()=>void;wide?:boolean}) {
 const dialog=useRef<HTMLDialogElement>(null);useEffect(()=>{const node=dialog.current;node?.showModal();return()=>node?.close()},[]);
 return <dialog ref={dialog} className={'modal '+(wide?'wide':'')} onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose()}}><div className="modal-heading"><div><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div><button autoFocus className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20}/></button></div>{children}</dialog>;
}
