import {useMemo,useState,type ReactNode} from 'react';
import {Modal} from './components';
import {CodeEditor} from './Editor';

type Settings=Record<string,any>;
type Props={value:string,onChange:(value:string)=>void,theme:string,onClose:()=>void,onCookies:()=>void,onSave:(settings:Settings)=>Promise<unknown>};
const sections=[{id:'general',name:'常规',icon:'sliders',description:'超时与请求行为'},{id:'proxy',name:'代理',icon:'network',description:'网络连接方式'},{id:'certificates',name:'证书',icon:'shield',description:'CA 与客户端认证'},{id:'advanced',name:'高级 JSON',icon:'code',description:'查看完整配置'}];
function Icon({name}:{name:string}){const paths:Record<string,ReactNode>={
  sliders:<><path d="M4 7h16M4 17h16"/><path d="M9 4v6M15 14v6"/></>,
  network:<><rect x="8" y="3" width="8" height="5" rx="1"/><path d="M12 8v5M5 13h14M5 13v3M19 13v3"/><rect x="2" y="16" width="6" height="5" rx="1"/><rect x="16" y="16" width="6" height="5" rx="1"/></>,
  shield:<><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/></>,
  code:<><path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/></>,
};return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;}
function Toggle({title,description,checked,onChange}:{title:string,description:string,checked:boolean,onChange:(checked:boolean)=>void}){
  return <label className="settings-toggle-row"><span><b>{title}</b><small>{description}</small></span><input type="checkbox" role="switch" aria-label={title} checked={checked} onChange={e=>onChange(e.target.checked)}/></label>;
}
function NumberField({label,description,value,unit,min,max,step=1,onChange}:{label:string,description:string,value:number|string,unit:string,min:number,max:number,step?:number,onChange:(value:number|string)=>void}){
  return <div className="settings-field-row"><div><label htmlFor={'setting-'+label}>{label}</label><p>{description}</p></div><div className="settings-number"><input id={'setting-'+label} aria-label={label} type="number" min={min} max={max} step={step} required value={value} onChange={e=>onChange(e.target.value===''?'':Number(e.target.value))}/><span>{unit}</span></div></div>;
}
export function SettingsPanel({value,onChange,theme,onClose,onCookies,onSave}:Props){
  const [section,setSection]=useState('general'),[initial]=useState(value),[error,setError]=useState(''),[saving,setSaving]=useState(false);
  const parsed=useMemo(()=>{try{const data=JSON.parse(value);if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('JSON 配置必须是一个对象。');if(data.certificates!==undefined&&(!Array.isArray(data.certificates)||data.certificates.some((c:any)=>!c||typeof c!=='object'||(c.name!==undefined&&typeof c.name!=='string')||(c.matches!==undefined&&!Array.isArray(c.matches)))))throw new Error('JSON 中的 certificates 必须是有效证书对象的数组。');return{data:data as Settings,error:''};}catch(e){return{data:{} as Settings,error:e instanceof SyntaxError?'JSON 格式无效，请检查后再保存或切换分类。':e instanceof Error?e.message:'JSON 格式无效。'};}},[value]);
  const s=parsed.data,certificates=Array.isArray(s.certificates)?s.certificates:[];
  const [matchDrafts,setMatchDrafts]=useState<Record<number,string>>({});
  const [proxyDraft,setProxyDraft]=useState(s.proxy||'');
  const patch=(changes:Settings)=>{onChange(JSON.stringify({...s,...changes},null,2));setError('');};
  const patchCertificate=(index:number,changes:Settings)=>patch({certificates:certificates.map((c:Settings,i:number)=>i===index?{...c,...changes}:c)});
  const changed=value!==initial;
  const proxyEnabled=s.proxy!==undefined;
  const number=(key:string,factor=1)=>(v:number|string)=>patch({[key]:v===''?'':Math.round(Number(v)*factor)});
  const active=sections.find(v=>v.id===section)!;
  async function save(){
    setError('');
    if(parsed.error)return;
    const data=structuredClone(s);
    const limits:[string,string,number,number][]=[['requestTimeout','请求超时',1,300000],['scriptTimeout','脚本超时',1,60000],['runTimeout','运行超时',100,600000],['delay','请求间隔',0,60000]];
    for(const [key,label,min,max] of limits)if(data[key]!==undefined&&(!Number.isInteger(data[key])||data[key]<min||data[key]>max)){setSection('general');setError(label+'超出允许范围，请检查输入值。');return;}
    if(data.allowedFiles!==undefined&&(!Array.isArray(data.allowedFiles)||data.allowedFiles.some((p:unknown)=>typeof p!=='string'||!p.startsWith('/')))){setSection('advanced');setError('allowedFiles 必须是本机绝对路径的数组。');return;}
    if(proxyEnabled){try{const url=new URL(String(data.proxy));if(url.protocol!=='http:'||url.username||url.password)throw new Error();}catch{setSection('proxy');setError('请输入以 http:// 开头的代理地址，当前不支持带用户名或密码的代理。');return;}}
    if(data.caFile&&!String(data.caFile).startsWith('/')){setSection('certificates');setError('CA 证书需填写本机文件的绝对路径。');return;}
    if(data.certificates!==undefined&&!Array.isArray(data.certificates)){setSection('advanced');setError('certificates 必须是数组。');return;}
    for(const c of data.certificates||[]){
      if(!Array.isArray(c.matches)||!c.matches.length||c.matches.some((m:unknown)=>typeof m!=='string'||!m.startsWith('https://'))){setSection('certificates');setError('请为每张客户端证书填写 HTTPS 匹配地址。');return;}
      if(!c.pfx?.src&&(!c.cert?.src||!c.key?.src)){setSection('certificates');setError('客户端证书需要证书文件和私钥文件。');return;}
      if([c.cert?.src,c.key?.src,c.pfx?.src].filter(Boolean).some(p=>typeof p!=='string'||!p.startsWith('/'))){setSection('certificates');setError('证书与私钥需填写本机文件的绝对路径。');return;}
    }
    const paths=[data.caFile,...(data.certificates||[]).flatMap((c:Settings)=>[c.cert?.src,c.key?.src,c.pfx?.src])].filter(Boolean);
    if(paths.length)data.allowedFiles=[...new Set([...(data.allowedFiles||[]),...paths])];
    setSaving(true);try{await onSave(data);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setSaving(false);}
  }
  return <Modal title="请求设置" wide className="settings-modal" onClose={onClose}>
    <p className="settings-intro">为每一次请求设定合适的默认行为。</p>
    <form onSubmit={e=>{e.preventDefault();save();}}>
      <div className="settings-layout">
        <aside className="settings-sidebar"><nav role="tablist" aria-label="设置分类">{sections.map(item=><button type="button" role="tab" tabIndex={section===item.id?0:-1} onKeyDown={e=>{if(!['ArrowDown','ArrowRight','ArrowUp','ArrowLeft','Home','End'].includes(e.key)||parsed.error)return;e.preventDefault();const index=sections.findIndex(v=>v.id===section);const next=e.key==='Home'?0:e.key==='End'?sections.length-1:(index+(['ArrowUp','ArrowLeft'].includes(e.key)?-1:1)+sections.length)%sections.length;setSection(sections[next].id);setError('');setMatchDrafts({});document.getElementById('settings-tab-'+sections[next].id)?.focus();}} aria-label={item.name} aria-selected={section===item.id} aria-controls="settings-content" id={'settings-tab-'+item.id} disabled={Boolean(parsed.error)&&item.id!=='advanced'} key={item.id} onClick={()=>{setSection(item.id);setMatchDrafts({});setError('');}} className={section===item.id?'active':''}><Icon name={item.icon}/><span>{item.name}<small>{item.description}</small></span></button>)}</nav><div className="settings-local"><span className="settings-local-dot"/>仅保存在本机</div></aside>
        <section className="settings-content" id="settings-content" role="tabpanel" aria-labelledby={'settings-tab-'+section}>
          <div className="settings-section-heading"><div><h3>{active.name==='常规'?'常规设置':active.name==='高级 JSON'?'完整配置':active.name==='证书'?'证书与信任':'代理设置'}</h3><p>{({general:'控制请求等待时间，以及收到响应后的处理方式。',proxy:'通过指定的 HTTP 代理连接目标服务。',certificates:'添加服务端 CA，或为需要双向认证的接口配置证书。',advanced:'直接编辑配置。切换分类时，表单与 JSON 会同步。'} as Record<string,string>)[section]}</p></div>{section==='general'&&<span className="settings-tag">全局默认</span>}</div>
          {(error||parsed.error)&&<div role="alert" className="settings-error">{error||parsed.error}</div>}
          {section==='general'&&<>
            <div className="settings-group"><h4>超时与等待</h4><NumberField label="请求超时" description="单个 HTTP 请求的最长等待时间" value={s.requestTimeout===''?'':(s.requestTimeout??30000)/1000} unit="秒" min={.001} max={300} step={.001} onChange={number('requestTimeout',1000)}/><NumberField label="脚本超时" description="每段请求前、响应后脚本的最长执行时间" value={s.scriptTimeout===''?'':(s.scriptTimeout??5000)/1000} unit="秒" min={.001} max={60} step={.001} onChange={number('scriptTimeout',1000)}/><NumberField label="运行超时" description="一次请求或集合运行的总时长上限" value={s.runTimeout===''?'':(s.runTimeout??120000)/1000} unit="秒" min={.1} max={600} step={.001} onChange={number('runTimeout',1000)}/><NumberField label="请求间隔" description="集合中两个请求之间的等待时间" value={s.delay??0} unit="毫秒" min={0} max={60000} onChange={number('delay')}/></div>
            <div className="settings-group"><h4>请求行为</h4><Toggle title="自动跟随重定向" description="收到 3xx 响应时，继续请求目标地址" checked={s.followRedirects!==false} onChange={v=>patch({followRedirects:v})}/><Toggle title="验证 TLS 证书" description="检查 HTTPS 服务的证书是否有效" checked={s.strictSSL!==false} onChange={v=>patch({strictSSL:v})}/>{s.strictSSL===false&&<p className="settings-inline-note">已关闭证书验证。建议为本地 HTTPS 服务添加自定义 CA。</p>}</div>
          </>}
          {section==='proxy'&&<div className="settings-group"><Toggle title="使用 HTTP 代理" description="启用后，所有新请求使用下方代理地址" checked={proxyEnabled} onChange={v=>patch({proxy:v?proxyDraft:undefined})}/><div className={'settings-proxy-field '+(!proxyEnabled?'is-disabled':'')}><label htmlFor="setting-proxy">代理地址</label><input id="setting-proxy" aria-label="代理地址" value={proxyEnabled?s.proxy:proxyDraft} disabled={!proxyEnabled} placeholder="http://127.0.0.1:7890" onChange={e=>{setProxyDraft(e.target.value);patch({proxy:e.target.value});}}/><p>支持 HTTP CONNECT 代理，适用于 HTTP 和 HTTPS 请求。</p></div><div className="settings-tip"><Icon name="network"/><p>{proxyEnabled?'代理配置将在下一次发送请求时生效。':'当前由本机直接连接目标服务。'}</p></div></div>}
          {section==='certificates'&&<>
            <div className="settings-group"><h4>自定义 CA</h4><p className="settings-group-description">信任内部或本地 HTTPS 服务使用的证书颁发机构。</p><label htmlFor="setting-ca">CA 证书路径 <small>可选</small></label><input id="setting-ca" aria-label="CA 证书路径" value={s.caFile||''} placeholder="/Users/you/certificates/ca.pem" onChange={e=>patch({caFile:e.target.value||undefined})}/></div>
            <div className="settings-group"><div className="settings-group-title"><div><h4>客户端证书</h4><p className="settings-group-description">用于需要双向 TLS 认证的接口。</p></div><button type="button" className="settings-add" aria-label="添加客户端证书" onClick={()=>patch({certificates:[...certificates,{name:'',matches:[],cert:{src:''},key:{src:''}}]})}>＋ 添加客户端证书</button></div>
              {Array.isArray(certificates)&&certificates.length?certificates.map((c:Settings,i:number)=><div className="settings-certificate" key={i}><div className="settings-certificate-heading"><span><Icon name="shield"/>{c.name||`证书 ${i+1}`}</span><button type="button" className="icon-button" aria-label={'删除证书 '+(i+1)} onClick={()=>{setMatchDrafts({});patch({certificates:certificates.filter((_:Settings,n:number)=>n!==i)});}}>×</button></div><div className="settings-certificate-fields"><label>名称<input aria-label={'证书名称 '+(i+1)} value={c.name||''} placeholder="例如：开发环境 API" onChange={e=>patchCertificate(i,{name:e.target.value})}/></label><label>匹配地址<input aria-label={'匹配地址 '+(i+1)} value={matchDrafts[i]??(c.matches||[]).join(', ')} placeholder="https://localhost:8443/*" onBlur={()=>setMatchDrafts({})} onChange={e=>{setMatchDrafts(v=>({...v,[i]:e.target.value}));patchCertificate(i,{matches:e.target.value.split(/[,，\s]+/).filter(Boolean)});}}/></label>{c.pfx?.src?<label className="settings-full-width">PFX 文件<input aria-label={'PFX 文件 '+(i+1)} value={c.pfx.src} onChange={e=>patchCertificate(i,{pfx:{...c.pfx,src:e.target.value}})}/></label>:<><label>证书文件<input aria-label={'证书文件 '+(i+1)} value={c.cert?.src||''} placeholder="/absolute/path/client.crt" onChange={e=>patchCertificate(i,{cert:{...c.cert,src:e.target.value}})}/></label><label>私钥文件<input aria-label={'私钥文件 '+(i+1)} value={c.key?.src||''} placeholder="/absolute/path/client.key" onChange={e=>patchCertificate(i,{key:{...c.key,src:e.target.value}})}/></label></>}<label className="settings-full-width">私钥口令 <small>可选 · 保存在本地设置中</small><input aria-label={'私钥口令 '+(i+1)} type="password" autoComplete="off" value={c.passphrase||''} placeholder="证书未加密时留空" onChange={e=>patchCertificate(i,{passphrase:e.target.value||undefined})}/></label></div></div>):<div className="settings-empty"><Icon name="shield"/><p>尚未添加客户端证书</p><small>仅在服务要求双向认证时需要配置。</small></div>}
            </div><div className="settings-tip"><Icon name="shield"/><p>使用本机文件的绝对路径。保存时会允许读取上述证书文件，无需重复配置文件权限。</p></div>
          </>}
          {section==='advanced'&&<><div className="settings-advanced-note">适合批量修改或配置其他运行选项。时间值使用毫秒；未在表单中显示的字段会保留。</div><CodeEditor value={value} onChange={v=>{onChange(v);setError('');}} language="json" theme={theme}/></>}
        </section>
      </div>
      <footer className="settings-footer"><button type="button" className="settings-cookie-button" aria-label="管理 Cookie" onClick={onCookies}>管理 Cookie <span>↗</span></button><span className="settings-save-state">{changed?<><i/>有未保存的修改</>:'修改后应用于新请求'}</span><button type="button" onClick={onClose}>取消</button><button type="submit" className="primary" disabled={saving||Boolean(parsed.error)}>{saving?'保存中…':'保存设置'}</button></footer>
    </form>
  </Modal>;
}
