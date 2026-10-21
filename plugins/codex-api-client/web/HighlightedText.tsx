import {Fragment,useLayoutEffect,useMemo,useRef,useState,useId,type ReactNode} from 'react';
import {jsonLanguage} from '@codemirror/lang-json';
import {classHighlighter,highlightTree} from '@lezer/highlight';

export type VariableValue={value:string,source:string};
export function UrlInput({value,onChange,variables}:{value:string,onChange:(value:string)=>void,variables:Map<string,VariableValue>}){
  const input=useRef<HTMLInputElement>(null),text=useRef<HTMLSpanElement>(null),tooltipId=useId();
  const [hovered,setHovered]=useState<string|null>(null);
  const syncScroll=()=>{if(text.current&&input.current)text.current.style.transform=`translateX(${-input.current.scrollLeft}px)`;};
  useLayoutEffect(()=>{syncScroll();setHovered(null);},[value]);
  const showAtCaret=()=>{
    const position=input.current?.selectionStart??-1;
    const match=Array.from(value.matchAll(/\{\{([^{}\r\n]+)\}\}/g)).find(m=>position>=m.index!&&position<=m.index!+m[0].length);
    setHovered(match?.[1]??null);
  };
  const current=hovered===null?undefined:variables.get(hovered);
  return <div className="url-input">
    <div className="url-input-highlight" aria-hidden="true"><span ref={text}>{value.split(/(\{\{[^{}\r\n]+\}\})/g).map((part,index)=>index%2?<span data-variable={part.slice(2,-2)} className={'url-variable '+(variables.has(part.slice(2,-2))?'is-resolved':'is-unresolved')} key={index}>{part}</span>:part)}</span></div>
    <input ref={input} aria-label="URL" aria-describedby={hovered!==null?tooltipId:undefined} spellCheck={false} placeholder="输入 URL，例如 {{baseUrl}}/users" value={value}
      onScroll={()=>{syncScroll();setHovered(null);}} onChange={event=>onChange(event.target.value)}
      onMouseMove={event=>{
        const hit=Array.from(text.current?.querySelectorAll<HTMLElement>('[data-variable]')||[]).find(element=>{const rect=element.getBoundingClientRect();return event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom;});
        setHovered(hit?.dataset.variable??null);
      }} onMouseLeave={()=>setHovered(null)} onBlur={()=>setHovered(null)} onFocus={showAtCaret} onClick={showAtCaret}
      onKeyUp={event=>{if(event.key==='Escape')setHovered(null);else showAtCaret();}}/>
    {hovered!==null&&<div className="variable-tooltip" id={tooltipId} role="tooltip"><b>{'{{'+hovered+'}}'}</b><small>{current?.source||'未设置'}</small><span>{current?(current.value===''?'（空字符串）':current.value):'当前作用域未设置此变量'}</span></div>}
  </div>;
}

export function ResponseBody({value,search,json}:{value:string,search:string,json:boolean}){
  const tokens=useMemo(()=>{
    const ranges:{from:number,to:number,className:string}[]=[];
    if(json)highlightTree(jsonLanguage.parser.parse(value),classHighlighter,(from,to,className)=>ranges.push({from,to,className}));
    return ranges;
  },[value,json]);
  let tokenIndex=0;
  const renderRange=(from:number,to:number)=>{
    const nodes:ReactNode[]=[];let position=from;
    for(let index=tokenIndex;index<tokens.length;index++){
      const token=tokens[index];
      if(token.to<=from){tokenIndex=index+1;continue;}
      tokenIndex=index;
      if(token.from>=to)break;
      const start=Math.max(from,token.from),end=Math.min(to,token.to);
      if(start>position)nodes.push(value.slice(position,start));
      nodes.push(<span className={token.className} key={start}>{value.slice(start,end)}</span>);
      position=end;
    }
    if(position<to)nodes.push(value.slice(position,to));
    return nodes;
  };
  let offset=0;
  return <pre className="response-body" data-testid="response-body">{!value?'等待响应…':!search?renderRange(0,value.length):value.split(search).map((part,index)=>{
    const start=offset;offset+=part.length+(index?search.length:0);
    return <Fragment key={index}>{index>0&&<mark>{renderRange(start,start+search.length)}</mark>}{renderRange(start+(index?search.length:0),offset)}</Fragment>;
  })}</pre>;
}
