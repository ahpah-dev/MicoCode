'use client';
import {useEffect,useId,useRef,type ReactNode} from 'react';
import {X} from 'lucide-react';
export function Logo({size=28}:{size?:number}) { return <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true"><rect width="40" height="40" rx="12" fill="currentColor"/><path d="M10 27V14L20 23L30 14V27" stroke="#101b16" strokeWidth="3.3" strokeLinecap="round" strokeLinejoin="round"/><path d="M20 9V12" stroke="#101b16" strokeWidth="2.5" strokeLinecap="round"/></svg>; }
/** The first control a keyboard user should land on: the first field that can
 *  actually be typed into. Close is never the landing spot — a dialog that opens
 *  with Close focused ends on the first Enter — and a read-only field is skipped
 *  because focus there goes nowhere. */
const FOCUSABLE='input:not([type="hidden"]):not([disabled]):not([readonly]),textarea:not([disabled]):not([readonly]),select:not([disabled])';
export function Modal({title,subtitle,children,onClose,wide=false}:{title:string;subtitle?:string;children:ReactNode;onClose:()=>void;wide?:boolean}) {
 const dialog=useRef<HTMLDialogElement>(null);const titleId=useId();
 useEffect(()=>{
  const node=dialog.current;
  if(!node)return;
  const returnTo=document.activeElement instanceof HTMLElement?document.activeElement:null;
  node.showModal();
  // React's autoFocus runs before showModal(), when the dialog is still closed
  // and nothing inside it can take focus, so the landing target is set here.
  const target=node.querySelector<HTMLElement>(FOCUSABLE);
  (target??node).focus({preventScroll:true});
  return()=>{
   node.close();
   // Native dialogs restore focus themselves; this covers the cases where the
   // trigger was re-rendered or replaced while the dialog was open.
   if(returnTo?.isConnected&&document.activeElement!==returnTo)returnTo.focus({preventScroll:true});
  };
 },[]);
 return <dialog ref={dialog} tabIndex={-1} aria-labelledby={titleId} aria-describedby={subtitle?titleId+'-sub':undefined} className={'modal '+(wide?'wide':'')} onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose()}}><div className="modal-heading"><div><h2 id={titleId}>{title}</h2>{subtitle&&<p id={titleId+'-sub'}>{subtitle}</p>}</div><button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20}/></button></div>{children}</dialog>;
}
