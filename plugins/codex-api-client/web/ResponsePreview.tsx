import {useEffect,useMemo,useState} from 'react';
import {ResponseBody} from './HighlightedText';
// Static allowlist excludes navigation, executable elements, SVG and remote resource attributes.
function staticHTML(source:string){
 const doc=new DOMParser().parseFromString(source,'text/html');
 const allowed=new Set('HTML HEAD BODY TITLE STYLE DIV SPAN P BR HR H1 H2 H3 H4 H5 H6 TABLE THEAD TBODY TFOOT TR TH TD UL OL LI PRE CODE STRONG EM B I U S BLOCKQUOTE SECTION ARTICLE HEADER FOOTER MAIN FIGURE FIGCAPTION IMG'.split(' '));
 for(const el of Array.from(doc.querySelectorAll('*'))){if(!allowed.has(el.tagName)){el.remove();continue;}for(const attr of Array.from(el.attributes)){if(['style','class','title','colspan','rowspan','alt','width','height'].includes(attr.name))continue;if(attr.name==='src'&&el.tagName==='IMG'&&/^data:image\/(png|jpeg|gif|webp);base64,/i.test(attr.value))continue;el.removeAttribute(attr.name);}}
 return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"></head><body>${doc.head.innerHTML}${doc.body.innerHTML}</body></html>`;
}
export function ResponsePreview({response,onCopy}:{response:any,onCopy:(value:string)=>void}){
 const [mode,setMode]=useState('格式化'),[search,setSearch]=useState('');
 const body=response?.body||'',mime=(response?.headers||[]).find((h:any)=>h.key?.toLowerCase()==='content-type')?.value?.split(';')[0]?.trim().toLowerCase()||'text/plain';
 const bytes=useMemo(()=>{try{return Uint8Array.from(atob(response?.bodyBase64||''),c=>c.charCodeAt(0));}catch{return new TextEncoder().encode(body);}},[response?.bodyBase64,body]);
 const [url,setUrl]=useState('');useEffect(()=>{const u=URL.createObjectURL(new Blob([bytes],{type:mime}));setUrl(u);return()=>URL.revokeObjectURL(u);},[bytes,mime]);
 let shown=body,json=false;if(mode==='格式化'&&(mime.includes('json')||mime==='text/plain'))try{shown=JSON.stringify(JSON.parse(body),null,2);json=true;}catch{}
 if(mode==='格式化'&&mime.includes('xml')){const xml=new DOMParser().parseFromString(body,'application/xml');if(!xml.querySelector('parsererror'))shown=new XMLSerializer().serializeToString(xml).replace(/></g,'>\n<');}
 const visual=mode==='可视化',preview=mode==='预览',html=visual?response?.visualizer:mime==='text/html'?body:null;
 const srcdoc=useMemo(()=>staticHTML(html&&html.length<=1024*1024?html:''),[html]);
 return <><div className="body-toolbar"><div className="segmented">{['格式化','原始','预览',...(response?.visualizer?['可视化']:[])].map(v=><button key={v} className={mode===v?'active':''} onClick={()=>setMode(v)}>{v}</button>)}</div><input aria-label="搜索响应" placeholder="搜索响应…" value={search} onChange={e=>setSearch(e.target.value)}/>{search&&<small>{shown.split(search).length-1} 处</small>}<button onClick={()=>onCopy(body)}>复制</button><button onClick={()=>{const link=document.createElement('a');link.href=url;link.download='response.bin';link.click();}}>保存响应</button></div>{(preview||visual)&&html&&html.length>1024*1024?<p>HTML 预览超过 1 MiB，请查看原始正文或下载。</p>:(preview||visual)&&html!==null?<><p className="panel-caption">静态隔离预览：脚本、导航和外部网络已禁用。</p><iframe title={visual?'Visualizer 预览':'HTML 预览'} sandbox="" referrerPolicy="no-referrer" srcDoc={srcdoc}/></>:preview&&/^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(mime)?<img className="response-image" alt="响应图片" src={url}/>:preview&&mime==='application/pdf'?<><p>宿主可能不支持 PDF 嵌入；可下载后在本地打开。</p><a href={url} download="response.pdf">下载 PDF</a><iframe title="PDF 预览" sandbox="" src={url}/></>:preview&&mime==='image/svg+xml'?<p>SVG 包含活动内容，请使用「保存响应」下载查看。</p>:<ResponseBody value={shown} search={search} json={json}/>}</>;
}
