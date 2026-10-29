import {useEffect,useId,useRef,type ReactNode} from 'react';
export function NativeDialog({title,children,footer,onClose,busy=false}:{title:string;children:ReactNode;footer?:ReactNode;onClose:()=>void;busy?:boolean}){
 const ref=useRef<HTMLDialogElement>(null),id=useId();useEffect(()=>{const el=ref.current;if(el?.showModal){el.removeAttribute('open');el.showModal();}},[]);
 return <dialog open ref={ref} className="native-dialog" aria-labelledby={id} onCancel={e=>{e.preventDefault();if(!busy)onClose();}}><div className="native-dialog-heading"><div><small>CẤU HÌNH RALLYX</small><h2 id={id}>{title}</h2></div><button disabled={busy} onClick={onClose}>Đóng</button></div><div className="native-dialog-body">{children}</div>{footer&&<div className="native-dialog-footer">{footer}</div>}</dialog>;
}
