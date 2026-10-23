(()=>{
  const $=id=>document.getElementById(id),pending=new Map();let sequence=0,frameOrigin=null,frameUrl=null,loadedVersion=null,polling=false,lastJob=null;
  const request=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('Codex 连接超时，请重新打开 DBX 面板'));},30000);pending.set(id,{resolve,reject,timer});parent.postMessage({jsonrpc:'2.0',id,method,params},'*');});
  const tool=async(name,args={})=>{const result=await request('tools/call',{name,arguments:args});if(result.isError)throw new Error(result.content?.find(x=>x.type==='text')?.text||'DBX 操作失败');return result.structuredContent;};
  const toast=message=>{$('toast').textContent=message;$('toast').hidden=false;setTimeout(()=>$('toast').hidden=true,8000);};
  const state=(heading,detail,retry=false)=>{$('state').hidden=false;$('heading').textContent=heading;$('detail').textContent=detail;$('retry').hidden=!retry;};
  const theme=context=>{if(context?.theme)document.body.dataset.theme=context.theme;};
  window.addEventListener('message',async event=>{
    if(event.source===parent){const message=event.data;if(message?.jsonrpc!=='2.0')return;if(message.method==='ui/notifications/host-context-changed')theme(message.params);const item=pending.get(message.id);if(item){clearTimeout(item.timer);pending.delete(message.id);if(message.error)item.reject(new Error(message.error.message));else item.resolve(message.result);}return;}
    const message=event.data;if(event.source!==$('workbench').contentWindow||event.origin!==frameOrigin||message?.type!=='dbx-compat'||typeof message.id!=='string')return;
    try{
      let result;
      if(message.action==='clipboard-write')result=await tool('dbx_codex_clipboard',{text:message.payload?.text});
      else if(message.action==='open-link'){const url=new URL(message.payload?.url);if(!['http:','https:','mailto:'].includes(url.protocol)||url.username||url.password)throw new Error('不支持此链接');result=await request('ui/open-link',{url:url.href});if(result?.isError)throw new Error('Codex 未能打开链接');}
      else if(['download-open','download-write','download-close','download-cancel'].includes(message.action)){result=await tool('dbx_codex_transfer',{action:message.action,payload:message.payload??{}});if(result.path)toast(`已保存到 ${result.path}`);}
      else throw new Error('未知的工作台操作');
      event.source.postMessage({type:'dbx-compat-result',id:message.id,result},frameOrigin);
    }catch(error){event.source.postMessage({type:'dbx-compat-result',id:message.id,error:error.message},frameOrigin);}
  });
  const render=value=>{
    const running=value.job?.phase==='running';$('check').disabled=running;$('update').disabled=running;
    $('version').textContent=value.currentVersion?`官方 v${value.currentVersion}`:'官方 Docker Web';
    const latest=value.latest?.version??value.latest?.latestVersion;
    $('activity').textContent=running?(value.job.kind==='update'?'正在备份并更新…':'正在启动官方 DBX…'):latest?`官方最新 v${latest}`:'';
    if(value.job?.phase==='failed'&&lastJob!==value.job.startedAt){toast(value.job.error||'操作失败，已保留数据');lastJob=value.job.startedAt;}
    if(value.job?.phase==='complete'&&value.job.kind==='update'&&lastJob!==value.job.startedAt){const version=value.job.result?.currentVersion;toast((version===value.job.fromVersion?`当前已是官方稳定版 v${version}`:`已更新至官方 v${version}`)+(value.job.result?.backupPath?`；备份：${value.job.result.backupPath}`:''));lastJob=value.job.startedAt;}
    if(running){$('workbench').hidden=true;state(value.job.kind==='update'?'正在更新 DBX':'正在启动 DBX','正在准备并验证官方工作台。首次打开会下载官方镜像，请保持 Docker 后台运行。');}
    else if(value.phase==='ready'){
      if(frameUrl!==value.url||loadedVersion!==value.currentVersion){frameUrl=value.url;loadedVersion=value.currentVersion;frameOrigin=new URL(frameUrl).origin;$('workbench').src=frameUrl;}
      $('workbench').hidden=false;$('state').hidden=true;
    }else state('DBX 暂不可用',value.message||value.error||value.job?.error||'请确认 Docker 已安装并启动，然后重试。',true);
  };
  const poll=async()=>{if(polling)return;polling=true;try{render(await tool('dbx_codex_status'));}catch(error){state('无法连接 DBX',error.message,true);}finally{polling=false;}};
  const start=async()=>{try{state('正在启动 DBX','正在连接官方 Docker Web…');await tool('dbx_codex_start');await poll();}catch(error){state('无法启动 DBX',error.message,true);}};
  $('retry').onclick=start;$('refresh').onclick=()=>{if(frameUrl)$('workbench').src=frameUrl;void poll();};
  $('check').onclick=async()=>{try{$('check').disabled=true;render(await tool('dbx_codex_check_update'));toast('已检查官方稳定版');}catch(error){toast(error.message);}finally{$('check').disabled=false;}};
  $('update').onclick=()=>$('confirm-update').showModal();$('cancel').onclick=()=>$('confirm-update').close();
  $('apply').onclick=async()=>{$('confirm-update').close();try{await tool('dbx_codex_update');await poll();}catch(error){toast(error.message);}};
  (async()=>{try{const init=await request('ui/initialize',{appInfo:{name:'dbx-codex',version:'0.6.40'},appCapabilities:{},protocolVersion:'2026-01-26'});theme(init?.hostContext);parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized'},'*');await start();setInterval(poll,2500);}catch(error){state('无法打开 DBX',error.message,true);}})();
})();
