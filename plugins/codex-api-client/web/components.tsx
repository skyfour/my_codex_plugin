import {AUTH_FIELDS,AUTH_SECRETS,AUTH_BOOLEANS,AUTH_DEFAULTS,AUTH_REQUIRED} from '../src/auth.mjs';
import {useEffect,useRef,type ReactNode} from 'react';
export type Row={id?:string,key:string,value?:string,type?:string,disabled?:boolean,secretRef?:string,src?:string,description?:string};
export function Rows({rows,onChange,variables=false,files=false,onUpload,onUploaded}:{rows:Row[],onChange:(rows:Row[])=>void,variables?:boolean,files?:boolean,onUpload?:(file:File)=>Promise<string>,onUploaded?:(id:string,path:string)=>void}){
  const latest=useRef({rows,onChange});latest.current={rows,onChange};
  const root=useRef<HTMLDivElement>(null),focusRow=useRef<number|null>(null);
  useEffect(()=>{if(focusRow.current!==null){root.current?.querySelector<HTMLInputElement>(`[aria-label="名称 ${focusRow.current+1}"]`)?.focus();focusRow.current=null;}},[rows.length]);
  const add=()=>{focusRow.current=latest.current.rows.length;latest.current.onChange([...latest.current.rows,{key:'',value:'',type:'text'}]);};
  const change=(index:number,patch:Partial<Row>)=>{const current=latest.current.rows;latest.current.onChange(index<current.length?current.map((v,i)=>i===index?{...v,...patch}:v):[...current,{key:'',value:'',type:'text',...patch}]);};
  return <div ref={root} className={'rows '+(!variables&&!files?'rows-basic':'')}><div className="row-head"><span/><span>名称</span><span>值</span><span>类型</span><span/></div>{[...rows,{key:'',value:'',type:'text'}].map((r,i)=><div className={i<rows.length?'kv-row':'row-draft'} key={i} onKeyDown={e=>{if(e.key==='Enter'&&!e.metaKey&&!e.ctrlKey&&!e.nativeEvent.isComposing&&e.target instanceof HTMLInputElement&&['text','password'].includes(e.target.type)&&i<latest.current.rows.length){e.preventDefault();add();}}}>
    {i<rows.length?<input aria-label={`启用 ${r.key||i+1}`} type="checkbox" checked={!r.disabled} onChange={e=>change(i,{disabled:!e.target.checked})}/>:<span/>}
    <input aria-label={`名称 ${i+1}`} placeholder="Key" value={r.key} onChange={e=>change(i,{key:e.target.value})}/>
    {files&&r.type==='file'?<label className="file-picker">{r.src?.split('/').at(-1)||'选择文件'}<input type="file" aria-label={`上传文件 ${i+1}`} onChange={async e=>{const f=e.target.files?.[0];if(f&&onUpload){const id=r.id||crypto.randomUUID();change(i,{id});const path=await onUpload(f);if(path){if(onUploaded)onUploaded(id,path);else{const index=latest.current.rows.findIndex(row=>row.id===id);if(index>=0)change(index,{src:path});}}}}}/></label>:<input aria-label={`值 ${i+1}`} placeholder={variables?'值或 {{变量}}':'Value / {{variable}}'} type={r.type==='secret'?'password':'text'} value={r.value??''} onChange={e=>change(i,{value:e.target.value})}/>}
    {variables||files?<select aria-label={`类型 ${i+1}`} value={r.type||'text'} onChange={e=>change(i,{type:e.target.value,secretRef:undefined,value:r.value==='••••••••'?'':r.value})}><option value="text">文本</option>{variables&&<option value="secret">敏感</option>}{files&&<option value="file">文件</option>}</select>:<span/>}
    {i<rows.length?<button className="icon-button" aria-label={`删除行 ${i+1}`} onClick={()=>onChange(rows.filter((_,n)=>n!==i))}>×</button>:<span/>}
  </div>)}<button className="text-button" onClick={add}>＋ 添加一行</button></div>;
}
export function Modal({title,children,onClose,wide=false,className=''}:{title:string,children:ReactNode,onClose:()=>void,wide?:boolean,className?:string}){
  const ref=useRef<HTMLElement>(null),close=useRef(onClose);close.current=onClose;
  useEffect(()=>{
    const dialog=ref.current!,previous=document.activeElement as HTMLElement|null;
    (dialog.querySelector<HTMLElement>('[role=tab][aria-selected=true],button')||dialog).focus();
    const key=(e:KeyboardEvent)=>{
      if(Array.from(document.querySelectorAll('[role=dialog]')).at(-1)!==dialog)return;
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close.current();}
      if(e.key==='Tab'){
        const items=Array.from(dialog.querySelectorAll<HTMLElement>('button,input,select,textarea,[tabindex],[contenteditable=true]')).filter(el=>el.tabIndex>=0&&!el.matches(':disabled')&&el.getClientRects().length>0);
        const first=items[0],last=items.at(-1);
        if(e.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){e.preventDefault();last?.focus();}
        else if(!e.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){e.preventDefault();first?.focus();}
      }
    };
    document.addEventListener('keydown',key,true);return()=>{document.removeEventListener('keydown',key,true);if(previous?.isConnected)previous.focus();};
  },[]);
  return <div className="backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={'modal '+(wide?'wide':'')+' '+className}><header><h2>{title}</h2><button aria-label="关闭" onClick={onClose}>×</button></header>{children}</section></div>;
}
export function AuthEditor({auth,onChange}:{auth:any,onChange:(auth:any)=>void}){
  const type=auth?.type||'inherit';
  const keys=AUTH_FIELDS as Record<string,string[]>;
  const labels:Record<string,string>={username:'用户名',password:'密码',token:'Token',key:'参数名',value:'参数值',in:'添加位置'};
  const defaults=AUTH_DEFAULTS as Record<string,Record<string,any>>;
  return <div className="auth-editor"><label>认证方式<select aria-label="认证方式" value={type} onChange={e=>onChange(e.target.value==='inherit'?undefined:{type:e.target.value,[e.target.value]:(keys[e.target.value]||[]).map(key=>({key,value:defaults[e.target.value]?.[key]??''}))})}><option value="inherit">继承上级认证</option>{Object.keys(keys).map(k=><option key={k} value={k}>{({noauth:'No Auth',basic:'Basic Auth',bearer:'Bearer Token',apikey:'API Key',awsv4:'AWS Signature v4'} as Record<string,string>)[k]||k.toUpperCase()}</option>)}</select></label>
  {(keys[type]||[]).map(key=>{const entry=auth[type]?.find((v:Row)=>v.key===key),label=labels[key]||key;return <label key={key}>{label}{key==='in'?<select aria-label={label} value={entry?.value||'header'} onChange={e=>update(key,e.target.value)}><option value="header">Header</option><option value="query">Query</option></select>:AUTH_BOOLEANS.includes(key)?<input aria-label={label} type="checkbox" checked={entry?.value===true} onChange={e=>update(key,e.target.checked)}/>:<input aria-label={label} type={AUTH_SECRETS.includes(key)?'password':'text'} value={entry?.value??''} placeholder="支持 {{环境变量}}" onChange={e=>update(key,e.target.value)}/>}</label>;})}
  {type==='inherit'?<p className="muted">使用最近一级文件夹或集合的认证配置。</p>:<p className="muted">必需字段：{((AUTH_REQUIRED as Record<string,string[]>)[type]||[]).join(', ')||'无'}。{type==='asap'?'ASAP 的 kid、iss、aud 可来自 claims JSON，并优先于同名字段。':''}字段使用已安装 Postman 运行时的名称。密钥保存到系统钥匙串；缺少必需字段时阻止发送。JWT 使用 HS256/384/512 的 secret 或 RS/PS/ES 的 PKCS8 privateKey；OAuth1 使用 consumerKey、签名方法和 secret/privateKey；OAuth2 accessToken 支持变量引用。</p>}</div>;
  function update(key:string,value:any){const entries=auth[type]||[];onChange({...auth,[type]:entries.some((v:Row)=>v.key===key)?entries.map((v:Row)=>v.key===key?{...v,value}:v):[...entries,{key,value}]});}
}
