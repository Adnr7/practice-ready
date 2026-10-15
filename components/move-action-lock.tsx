"use client";
import {useEffect,useLayoutEffect,useRef,useState,type CSSProperties} from "react";
export type MoveLockAnimation="lock"|"unlock"|undefined;
const seen=new Set<string>();
export function useMoveLockAnimation(scope:string,eligible:boolean,active:boolean):MoveLockAnimation{
 const [animation,setAnimation]=useState<MoveLockAnimation>();
 useEffect(()=>{
  setAnimation(undefined);
  if(!active||!scope)return;
  const key=`practice-ready-move-lock-v2:${scope}:unlock`;
  let remembered=seen.has(key);
  try{remembered=remembered||sessionStorage.getItem(key)==="seen";}catch{}
  if(eligible&&remembered)return;
  setAnimation(eligible?"unlock":"lock");
  const timer=window.setTimeout(()=>{
   if(eligible){seen.add(key);try{sessionStorage.setItem(key,"seen");}catch{}}
   setAnimation(undefined);
  },1600);
  return()=>window.clearTimeout(timer);
 },[scope,eligible,active]);
 return animation;
}
export function MoveActionLock({locked,animation}:{locked:boolean;animation:MoveLockAnimation}){
 const slot=useRef<HTMLSpanElement>(null);
 const [offset,setOffset]=useState(0);
 useLayoutEffect(()=>{
  const node=slot.current,button=node?.closest("button");
  if(!node||!button||!animation)return;
  const a=node.getBoundingClientRect(),b=button.getBoundingClientRect();
  setOffset(b.left+b.width/2-a.left-a.width/2);
 },[animation]);
 if(!locked&&animation!=="unlock")return null;
 return <><style>{`
 @keyframes practice-move-centre{0%,12%{transform:translateX(var(--move-lock-offset)) scale(1.65) rotate(0)}24%{transform:translateX(var(--move-lock-offset)) scale(1.95) rotate(-12deg)}34%{transform:translateX(var(--move-lock-offset)) scale(1.85) rotate(10deg)}44%{transform:translateX(var(--move-lock-offset)) scale(1.8) rotate(-7deg)}54%,65%{transform:translateX(var(--move-lock-offset)) scale(1.7) rotate(0)}100%{transform:translateX(0) scale(1) rotate(0)}}
 @keyframes practice-move-label{0%,65%{opacity:0}100%{opacity:1}}
 @keyframes practice-move-open{0%,38%{transform:rotate(0)}65%,100%{transform:rotate(-35deg)}}
 .practice-move-lock-slot{position:relative;display:inline-flex;width:14px;height:14px;flex-shrink:0}
 .practice-move-lock-slot svg{position:absolute;inset:0;overflow:visible}
 @media(prefers-reduced-motion:no-preference){
 .practice-move-lock-slot[data-animation] svg{animation:practice-move-centre 1.5s cubic-bezier(.22,.7,.3,1) both}
 button:has(.practice-move-lock-slot[data-animation]) .practice-move-action-label{animation:practice-move-label 1.5s ease both}
 .practice-move-lock-slot[data-animation="unlock"] .practice-move-shackle{transform-origin:17px 11px;animation:practice-move-open 1.5s ease both}
 }
 `}</style><span ref={slot} className="practice-move-lock-slot" data-animation={animation} style={{"--move-lock-offset":`${offset}px`} as CSSProperties} aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path className="practice-move-shackle" d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span></>;
}
