import {useState} from 'react';
import {CodeEditor} from './Editor';
export function GraphqlEditor({value,onChange,theme,onIntrospect}:{value:any,onChange:(value:any)=>void,theme:string,onIntrospect:()=>Promise<any>}){
 const [schema,setSchema]=useState<any>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const [type,setType]=useState('');
 const types=(schema?.types||[]).filter((t:any)=>!t.name?.startsWith('__')&&(t.fields?.length||t.inputFields?.length));
 const selected=types.find((t:any)=>t.name===type)||types.find((t:any)=>t.name===schema?.queryType?.name)||types[0];
 const fields=selected?.fields||selected?.inputFields||[];
 async function introspect(){
  if(loading)return;setLoading(true);setError('');
  try{const data=await onIntrospect();if(data.errors?.length)throw Error(data.errors.map((e:any)=>e.message).join('；'));if(!data.data?.__schema)throw Error('响应未包含 data.__schema，请检查服务器 introspection 支持和认证');setSchema(data.data.__schema);setType(data.data.__schema.queryType?.name||'');}
  catch(e){setError(e instanceof Error?e.message:String(e));}finally{setLoading(false);}
 }
 return <div className="graphql-editor">
  <label>Operation name<input aria-label="GraphQL operationName" value={value.operationName||''} onChange={e=>onChange({...value,operationName:e.target.value})}/></label>
  <label>GraphQL 查询（输入字段名或 Ctrl+Space 补全）</label>
  <CodeEditor testId="graphql-query" value={value.query||''} language="graphql" theme={theme} completions={fields.map((f:any)=>f.name)} onChange={query=>onChange({...value,query})}/>
  <label>GraphQL 变量（JSON）</label><CodeEditor testId="graphql-variables" value={typeof value.variables==='object'?JSON.stringify(value.variables,null,2):value.variables||'{}'} language="json" theme={theme} onChange={variables=>onChange({...value,variables})}/>
  <div className="panel-caption"><button disabled={loading} onClick={introspect}>{loading?'正在发送 schema 查询…':'发送 Schema introspection'}</button><p>此按钮会使用当前 URL、环境、继承认证、脚本和网络设置发送请求。页面打开时不会连接。获取 schema 后可选择类型并补全字段。</p></div>
  {error&&<p className="danger-text" role="status">{error}</p>}
  {schema&&<div aria-label="GraphQL schema"><label>补全类型<select aria-label="GraphQL 补全类型" value={selected?.name||''} onChange={e=>setType(e.target.value)}>{types.map((t:any)=><option key={t.name}>{t.name}</option>)}</select></label><p>{fields.map((f:any)=>f.name).join(' · ')||'此类型没有字段'}</p></div>}
 </div>;
}
