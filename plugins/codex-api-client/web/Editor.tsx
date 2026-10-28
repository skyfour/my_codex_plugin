import {autocompletion,completeFromList} from '@codemirror/autocomplete';
import { useEffect,useRef } from 'react';
import { EditorView,basicSetup } from 'codemirror';
import { EditorState,Annotation } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
const externalSync=Annotation.define<boolean>();
export function CodeEditor({value,onChange,language='javascript',theme='light',testId,completions=[]}:{value:string,onChange:(v:string)=>void,language?:string,theme?:string,testId?:string,completions?:string[]}){
  const host=useRef<HTMLDivElement>(null),view=useRef<EditorView|null>(null),change=useRef(onChange);change.current=onChange;
  useEffect(()=>{
    const instance=new EditorView({parent:host.current!,state:EditorState.create({doc:value,extensions:[basicSetup,...(language==='graphql'?[]:[language==='json'?json():javascript()]),...(completions.length?[autocompletion({override:[completeFromList(completions.map(label=>({label,type:'property'}))) ]})]:[]),...(theme==='dark'?[oneDark]:[]),EditorView.lineWrapping,EditorView.updateListener.of(u=>{if(u.docChanged&&!u.transactions.some(t=>t.annotation(externalSync)))change.current(u.state.doc.toString());})]})});
    view.current=instance;return()=>{instance.destroy();view.current=null;};
  },[language,theme,JSON.stringify(completions)]);
  useEffect(()=>{const v=view.current;if(v&&v.state.doc.toString()!==value)v.dispatch({changes:{from:0,to:v.state.doc.length,insert:value},annotations:externalSync.of(true)});},[value]);
  return <div className="code-editor" ref={host} data-testid={testId}/>;
}
