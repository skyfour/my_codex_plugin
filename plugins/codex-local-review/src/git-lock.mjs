import {realpath} from 'node:fs/promises';
const active=new Set();
export async function withGitWrite(root,fn){
 const key=await realpath(root);if(active.has(key))throw Error('当前仓库正在执行 Git 操作，请等待结果');active.add(key);
 try{return await fn();}finally{active.delete(key);}
}
