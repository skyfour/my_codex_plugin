import {useEffect,useState} from 'react';
import {call} from './bridge';
export function ImportPreview({text}:{text:string}){
  const [preview,setPreview]=useState<any>(null),[error,setError]=useState('');
  useEffect(()=>{
    let active=true;setPreview(null);setError('');
    if(!text.trim())return;
    const timer=setTimeout(()=>{call('api_import_preview',{text}).then(value=>{if(active)setPreview(value);}).catch(e=>{if(active)setError(e.message);});},200);
    return()=>{active=false;clearTimeout(timer);};
  },[text]);
  if(!text.trim())return null;
  if(error)return <p className="danger-text" role="status">无法预览：{error}</p>;
  if(!preview)return <p className="muted" role="status">正在验证导入内容…</p>;
  return <div className="import-preview" aria-label="导入预览">
    <b>{preview.kind==='workspace'?'工作区备份':'兼容格式'}</b>
    <p>{preview.collectionCount} 个集合 · {preview.environmentCount} 个环境{preview.kind==='workspace'&&` · ${preview.globalCount} 个全局变量 · ${preview.requestCount} 个请求`}</p>
    {preview.collections&&<ul>{preview.collections.map((item:any,index:number)=><li key={index}>{item.name}<span>{item.requestCount} 个请求</span></li>)}</ul>}
    {preview.kind==='workspace'&&<p className="muted">集合、环境和各级 API 脚本一起导入。同名集合与环境新增副本；重名全局变量保留本机值。导入不会运行脚本或发送请求。</p>}
  </div>;
}
