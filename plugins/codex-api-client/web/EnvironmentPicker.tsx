import {useEffect,useRef,useState} from 'react';

type Environment={id:string,data:{name?:string,values?:any[]}};
type Props={environments:Environment[],globals:Environment|null,value:string,onSelect:(id:string)=>void,onEdit:(doc:Environment)=>void,onCreate:()=>void,onImport:()=>void,onGlobals:()=>void};
export function EnvironmentPicker({environments,globals,value,onSelect,onEdit,onCreate,onImport,onGlobals}:Props){
  const [panel,setPanel]=useState<'select'|'variables'|null>(null),[search,setSearch]=useState('');
  const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),variablesTrigger=useRef<HTMLButtonElement>(null),searchInput=useRef<HTMLInputElement>(null);
  const current=environments.find(e=>e.id===value);
  const close=(restore=false)=>{if(restore)(panel==='variables'?variablesTrigger:trigger).current?.focus();setPanel(null);};
  useEffect(()=>{
    if(!panel)return;
    if(panel==='select')searchInput.current?.focus();
    const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setPanel(null);};
    const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);}};
    const element=root.current;document.addEventListener('pointerdown',outside);element?.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);element?.removeEventListener('keydown',escape);};
  },[panel]);
  const select=(id:string)=>{onSelect(id);close(true);};
  const edit=(doc:Environment)=>{onEdit(doc);close();};
  const filtered=environments.filter(e=>(e.data.name||'').toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const sections=[{title:current?.data.name||'当前环境',doc:current},{title:'全局变量',doc:globals}];
  return <div className="environment-control" ref={root}>
    <span className="environment-label">环境</span>
    <button ref={trigger} className={'environment-trigger '+(current?'has-environment':'')} aria-label="选择环境" aria-haspopup="dialog" aria-expanded={panel==='select'} onClick={()=>{setSearch('');setPanel(panel==='select'?null:'select');}}>
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m10 2 7 4v8l-7 4-7-4V6zM3 6l7 4 7-4M10 10v8"/></svg>
      <span>{current?.data.name||'无环境'}</span><svg className="environment-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>
    </button>
    <button ref={variablesTrigger} className="environment-variables-button" aria-label="查看环境变量" aria-haspopup="dialog" aria-expanded={panel==='variables'} onClick={()=>setPanel(panel==='variables'?null:'variables')}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M8 4H5v12h3m4-12h3v12h-3M8 8l4 4m0-4-4 4"/></svg><span>变量</span></button>
    {panel==='select'&&<section role="dialog" aria-label="环境选择" className="environment-popover">
      <header><b>切换环境</b><small>应用于请求与脚本</small></header>
      <input ref={searchInput} className="environment-search" aria-label="搜索环境" placeholder="搜索环境…" value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();root.current?.querySelector<HTMLButtonElement>('[role=option]')?.focus();}}}/>
      <div className="environment-options" role="listbox" aria-label="可用环境" onKeyDown={e=>{if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const options=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role=option]'));const index=options.indexOf(document.activeElement as HTMLButtonElement);const next=e.key==='Home'?0:e.key==='End'?options.length-1:(index+(e.key==='ArrowDown'?1:-1)+options.length)%options.length;options[next]?.focus();}}}>
        <div className="environment-option-row"><button role="option" aria-selected={!current} onClick={()=>select('')}><span className="environment-dot empty"/><span>无环境</span>{!current&&<span className="environment-check">✓</span>}</button></div>
        {filtered.map(doc=><div className={'environment-option-row '+(doc.id===value?'selected':'')} key={doc.id}><button role="option" aria-selected={doc.id===value} onClick={()=>select(doc.id)}><span className="environment-dot"/><span>{doc.data.name||'未命名环境'}<small>{(doc.data.values||[]).filter(v=>!v.disabled).length} 个变量</small></span>{doc.id===value&&<span className="environment-check">✓</span>}</button><button className="environment-edit" aria-label={'编辑环境 '+doc.data.name} onClick={()=>edit(doc)}>编辑</button></div>)}
      </div>
      {!filtered.length&&<p className="environment-empty">{search?'没有匹配的环境':'还没有环境，先创建或导入一个。'}</p>}
      <footer><button onClick={()=>{onCreate();close();}}>＋ 新建环境</button><button onClick={()=>{onImport();close();}}>导入环境</button><button onClick={()=>{onGlobals();close();}}>全局变量 <span>↗</span></button></footer>
    </section>}
    {panel==='variables'&&<section role="dialog" aria-label="变量预览" className="environment-popover environment-preview">
      <header><b>变量预览</b><button className="icon-button" aria-label="关闭变量预览" onClick={()=>close(true)}>×</button></header>
      <p className="environment-hint">环境变量优先于同名全局变量。修改保存后用于后续请求。</p>
      <div className="environment-preview-scroll">{sections.map(({title,doc},i)=><section className="environment-variable-section" key={i}>
        <header><b>{title}</b><button disabled={i===0&&!doc} onClick={()=>{if(i===1){onGlobals();close();}else if(doc)edit(doc);}}>编辑</button></header>
        {doc?.data.values?.length?<table><thead><tr><th>变量</th><th>本地值</th></tr></thead><tbody>{doc.data.values.map((v,j)=><tr key={j} className={v.disabled?'disabled-variable':''}><td>{v.key||'未命名'}{v.type==='secret'&&<small>敏感</small>}{v.disabled&&<small>已停用</small>}</td><td>{v.type==='secret'?'••••••••':String(v.value??'')}</td></tr>)}</tbody></table>:<p className="environment-empty">{i===0&&!current?'选择环境以查看变量。':'暂无变量'}</p>}
      </section>)}</div>
      <footer><small>值仅保存在本机 · 敏感值已隐藏</small></footer>
    </section>}
  </div>;
}
