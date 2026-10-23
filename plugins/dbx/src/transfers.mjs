import {mkdir,open,unlink,lstat} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';

export class Transfers {
  #active=new Map();
  #opening=0;
  #timer;#now;#ttl;
  constructor(home,{now=Date.now,ttlMs=10*60*1000}={}){this.directory=join(home,'exports');this.#now=now;this.#ttl=ttlMs;this.#timer=setInterval(()=>void this.expire().catch(()=>{}),60000);this.#timer.unref();}
  async expire(){for(const [id,item] of this.#active)if(this.#now()-item.lastActivity>this.#ttl)await this.action('download-cancel',{id});}
  async action(action,payload={}){
    if(action==='download-open'){
      if(this.#active.size+this.#opening>=4)throw new Error('最多同时导出 4 个文件');
      this.#opening++;
      try{
      const name=basename(String(payload.name??'export')).replace(/[\x00-\x1f<>:"|?*\\]/g,'_').slice(0,180)||'export';
      await mkdir(this.directory,{recursive:true,mode:0o700});
      const directory=await lstat(this.directory);if(!directory.isDirectory()||directory.isSymbolicLink())throw new Error('导出目录不能是符号链接');
      const id=randomUUID(),path=join(this.directory,`${id.slice(0,8)}-${name}`),file=await open(path,'wx',0o600);
      this.#active.set(id,{file,path,size:0,lastActivity:this.#now()});return {id};
      }finally{this.#opening--;}
    }
    const item=this.#active.get(payload.id);if(!item)throw new Error('导出已结束或不存在');
    item.lastActivity=this.#now();
    if(action==='download-write'){
      if(typeof payload.data!=='string'||payload.data.length>90000||!/^[A-Za-z0-9+/]*={0,2}$/.test(payload.data))throw new Error('无效的导出分块');
      const bytes=Buffer.from(payload.data,'base64');item.size+=bytes.length;
      if(item.size>256*1024*1024){await this.action('download-cancel',payload);throw new Error('嵌入导出上限为 256 MiB');}
      await item.file.write(bytes);return {written:bytes.length};
    }
    if(action==='download-close'){await item.file.close();this.#active.delete(payload.id);return {path:item.path};}
    if(action==='download-cancel'){await item.file.close();this.#active.delete(payload.id);await unlink(item.path).catch(()=>{});return {};}
    throw new Error('未知导出操作');
  }
  async close(){clearInterval(this.#timer);for(const id of this.#active.keys())await this.action('download-cancel',{id});}
}

export async function writeClipboard(text){
  if(typeof text!=='string'||Buffer.byteLength(text)>4*1024*1024)throw new Error('复制内容过大');
  if(process.platform!=='darwin')throw new Error('此系统请使用面板复制提示中的手动复制');
  await new Promise((resolve,reject)=>{
    const child=spawn('/usr/bin/pbcopy',[],{stdio:['pipe','ignore','ignore']});
    child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('系统剪贴板不可用')));child.stdin.on('error',reject);child.stdin.end(text);
  });
  return {copied:true};
}
