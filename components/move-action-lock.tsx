"use client";
import {useEffect,useState} from "react";
import {Lock,LockOpen} from "lucide-react";
export type MoveLockAnimation="lock"|"unlock"|undefined;
const seen=new Set<string>();
export function useMoveLockAnimation(scope:string,eligible:boolean,active:boolean):MoveLockAnimation{
 const [animation,setAnimation]=useState<MoveLockAnimation>();
 useEffect(()=>{
  setAnimation(undefined);
  if(!active||!scope)return;
  const key=`practice-ready-move-lock-v1:${scope}:${eligible?"unlock":"lock"}`;
  let remembered=seen.has(key);
  try{remembered=remembered||sessionStorage.getItem(key)==="seen";}catch{}
  if(remembered)return;
  seen.add(key);try{sessionStorage.setItem(key,"seen");}catch{}
  setAnimation(eligible?"unlock":"lock");
  const timer=window.setTimeout(()=>setAnimation(undefined),650);
  return()=>window.clearTimeout(timer);
 },[scope,eligible,active]);
 return animation;
}
export function MoveActionLock({locked,animation}:{locked:boolean;animation:MoveLockAnimation}){
 if(!locked&&animation!=="unlock")return null;
 const Icon=locked?Lock:LockOpen;
 return <><style>{`@keyframes practice-move-lock{0%{transform:scale(.9) rotate(0)}35%{transform:scale(1.12) rotate(-7deg)}55%{transform:scale(1.05) rotate(6deg)}75%{transform:scale(1.02) rotate(-3deg)}100%{transform:scale(1) rotate(0)}}@media(prefers-reduced-motion:no-preference){.practice-move-lock-animate{animation:practice-move-lock .55s ease-out both}}`}</style><Icon size={14} aria-hidden="true" className={animation?"practice-move-lock-animate shrink-0":"shrink-0"}/></>;
}
