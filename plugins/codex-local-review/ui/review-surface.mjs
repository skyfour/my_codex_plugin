// Presentation only: repository reads and writes are supplied by the application adapter.
export function createDiffView({value,hunks,layout='split',wrap=true,full=false,expanded=new Set(),page=0,onComment,onExpand,onPage,onFull,onHunk}){
 const host=el('div',undefined,'diff-view');if(!value.before||!value.after)layout='unified';
 if(value.binary){host.append(el('p','二进制文件，不展示文本差异。','empty-list'));return host;}
 const data=alignedRows(value.before,value.after,window.Diff.diffLines),visible=diffEntries(data,{full,expanded}),blocks=new Map();page=Math.min(page,Math.max(0,Math.floor((visible.length-1)/500)*500));
 if(hunks?.hunks?.length){for(const h of hunks.hunks){const index=data.findIndex(r=>(r.old!==null&&r.old>=h.oldStart&&r.old<h.oldStart+h.oldCount)||(r.new!==null&&r.new>=h.newStart&&r.new<h.newStart+h.newCount));if(index>=0)blocks.set(index,h);}}
 else for(const b of changeBlocks(data))blocks.set(b.index,{label:b.label});
 const table=el('table',undefined,`diff-table ${layout}${wrap?' wrap':''}`),group=el('colgroup');
 for(const cls of layout==='split'?['number','','number','']:['number','number','diff-sign','']){const col=el('col');col.className=cls;group.append(col);}table.append(group);
 if(!wrap){let longest=1;for(const r of data)longest=Math.max(longest,r.before?.length??0,r.after?.length??0);table.style.minWidth=`${Math.min(12000,Math.max(500,longest*7.3)*(layout==='split'?2:1)+84)}px`;}
 const body=el('tbody');table.append(body);
 const number=(line,side)=>{const cell=el('td',undefined,'number');if(line!=null){const b=button(String(line),()=>onComment?.(side,line));b.setAttribute('aria-label',`${side==='before'?'旧':'新'}代码第 ${line} 行添加评论`);cell.append(b);}return cell;};
 const code=(text,type='',half=false)=>{const cell=el('td',undefined,'code-cell '+type+(half?' before-half':''));if(text!=null)cell.append(highlight(text,value.path));else cell.classList.add('blank-line');return cell;};
 if(page)host.append(button('上一页代码',()=>onPage?.(Math.max(0,page-500)),'load-more'));
 for(const r of visible.slice(page,page+500)){
  if(r.fold){const row=el('tr',undefined,'fold'),cell=el('td');cell.colSpan=4;cell.append(button(`展开 ${r.count} 行上下文`,()=>onExpand?.(r)));row.append(cell);body.append(row);continue;}
  if(blocks.has(r.index)){const h=blocks.get(r.index),row=el('tr',undefined,'change-location'),cell=el('td');cell.colSpan=4;
   const bar=el('div',undefined,'diff-hunk-header'),toggle=button(full?'收起上下文':'完整上下文',()=>onFull?.(!full),'context-toggle');toggle.title='切换完整文件与精简差异';bar.append(toggle,el('span',h.label||`修改前：第 ${h.oldStart} 行 → 修改后：第 ${h.newStart} 行`,'hunk-location'));
   if(h.id&&onHunk){const actions=el('span',undefined,'hunk-actions');for(const [operation,label] of hunks.mode==='staged'?[['unstage','Unstage Hunk']]:[['discard','Discard Hunk'],['stage','Stage Hunk']]){const b=button(label,()=>onHunk(h,operation));b.dataset.hunkOperation=operation;actions.append(b);}bar.append(actions);}cell.append(bar);row.append(cell);body.append(row);
  }
  if(layout==='split'){const row=el('tr');row.dataset.row=r.index;row.append(number(r.old,'before'),code(r.before,r.type==='change'?'del-line':'',true),number(r.new,'after'),code(r.after,r.type==='change'?'add-line':''));body.append(row);}
  else for(const side of r.type==='context'?['after']:['before','after']){if(r[side==='before'?'old':'new']===null)continue;const row=el('tr',undefined,r.type==='change'?(side==='before'?'del-line':'add-line'):'');row.dataset.row=r.index;row.append(number(side==='before'||r.type==='context'?r.old:null,'before'),number(side==='after'?r.new:null,'after'),el('td',r.type==='context'?' ':side==='before'?'−':'+','diff-sign'),code(r[side]));body.append(row);}
 }
 host.append(table);if(visible.length>page+500)host.append(button('下一页代码',()=>onPage?.(page+500),'load-more'));if(!data.length)host.append(el('p','空文件','empty-list'));return host;
}

export function createReviewSurface({state,readFile,select,mutateFile,mutateHunk,markReviewed,stageReviewed,comment,bulk}){
 const container=$('code'),tabs=$('detailTabs'),column=document.querySelector('.detail-column');
 let active={kind:'summary'},signature='',generation=0,observer=null,loadedBytes=0,lastFull=false,activeReads=0,cacheOwner='';
 const readWaiters=[];
 const acquireRead=()=>new Promise(resolve=>{if(activeReads<3){activeReads++;resolve();}else readWaiters.push(resolve);});
 const releaseRead=()=>{const next=readWaiters.shift();if(next)next();else activeReads--;};
 const cards=new Map(),collapsed=new Set(),options=new Map(),cache=new Map();
 const key=c=>`${c.mode}:${c.path}`;
 function groups(s){
  const filter=$('fileSearch').value.toLowerCase(),items=s.files.filter(f=>!f.directory&&!f.symlink&&f.path.toLowerCase().includes(filter));
  if(s.live){return ['unstaged','staged'].filter(mode=>s.scope.mode==='working'||s.scope.mode===mode).map(mode=>({mode,title:mode==='unstaged'?'Working Directory · 未暂存':'Staged Files · 已暂存',items:items.filter(f=>mode==='unstaged'?f.canStage:f.canUnstage)}));}
  return [{mode:s.review?.mode||s.scope.mode,title:s.review?'审查快照':s.scope.mode==='files'?'本地文件':'提交变更',items}];
 }
 function summary(){active={kind:'summary'};render(true);}
 function activate(path,mode){active={kind:'file',path,mode};renderTabs();column.dataset.detailView='file';}
 function reset(toSummary=false){if(toSummary)active={kind:'summary'};signature='';generation++;observer?.disconnect();cache.clear();loadedBytes=0;}
 function renderTabs(){
  const s=state(),sections=groups(s);tabs.hidden=!s.project;tabs.replaceChildren();
  const add=(label,selected,fn,title)=>{const b=button(label,fn);b.setAttribute('role','tab');b.setAttribute('aria-selected',String(selected));b.title=title||label;tabs.append(b);};
  add('Summary',active.kind==='summary',()=>summary(),'连续查看全部文件差异');
  for(const g of sections)for(const f of g.items)add(`${g.mode==='staged'?'S':g.mode==='unstaged'?'M':'·'} ${f.path.split('/').at(-1)}`,active.kind==='file'&&active.path===f.path&&active.mode===g.mode,()=>select(f.path,g.mode),`${g.title} · ${f.path}`);
 }
 function busy(value){container.querySelectorAll('[data-summary-action],[data-hunk-operation],[data-review-file]').forEach(b=>{b.disabled=value||b.dataset.ineligible==='true';});}
 function draw(card,ctx,data){
  const body=card.querySelector('.summary-file-body'),o=options.get(key(ctx))||{full:$('fullContext').checked,expanded:new Set(),page:0};options.set(key(ctx),o);
  body.replaceChildren();if(data.error){body.append(el('p',data.error.message,'summary-error'),button('重试',()=>{cache.delete(key(ctx));void load(card,ctx);}),button('单独查看',()=>select(ctx.path,ctx.mode)));return;}
  if(data.hunks?.notice)body.append(el('p',data.hunks.notice,'hunk-notice'));
  try{body.append(createDiffView({value:data.file,hunks:data.hunks,layout:state().layout,wrap:$('wrapCode').checked,...o,
   onComment:(side,line)=>comment(ctx,side,line),onExpand:r=>{for(let i=r.start;i<r.end;i++)o.expanded.add(i);draw(card,ctx,data);},onPage:page=>{o.page=page;draw(card,ctx,data);},onFull:full=>{o.full=full;draw(card,ctx,data);},onHunk:state().live?(h,operation)=>mutateHunk(ctx,data.hunks,h,operation):undefined
  }));}catch(error){body.append(el('p',error.message,'summary-error'));}busy(state().busy);
 }
 async function load(card,ctx){
  if(card.dataset.loading==='true')return;const token=generation,k=key(ctx);card.dataset.loading='true';
  try{let data=cache.get(k);if(!data){await acquireRead();try{if(token!==generation||!card.isConnected)return;data=await readFile(ctx);}finally{releaseRead();}if(token!==generation)return;const bytes=new Blob([data.file.before||'',data.file.after||'']).size,limit=(state().limits?.totalMiB||50)*1024*1024;
    if(loadedBytes+bytes>limit)throw Error('连续预览已达到本次内存上限，可单独查看这个文件。');loadedBytes+=bytes;cache.set(k,data);}
   if(token===generation&&card.isConnected)draw(card,ctx,data);
  }catch(error){if(token===generation&&card.isConnected)draw(card,ctx,{error});}finally{if(token===generation)delete card.dataset.loading;}
 }
 function render(force=false){
  const s=state(),owner=JSON.stringify([s.project?.id,s.review?.id||'live',s.scope]);
  if(owner!==cacheOwner){cacheOwner=owner;generation++;observer?.disconnect();cache.clear();options.clear();collapsed.clear();loadedBytes=0;signature='';}
  if(lastFull!==$('fullContext').checked){lastFull=$('fullContext').checked;for(const o of options.values())o.full=lastFull;}renderTabs();column.dataset.detailView=active.kind;if(active.kind!=='summary'||!s.project)return;
  const sections=groups(s),next=JSON.stringify([s.project.id,s.review?.id,s.review?.version,s.scope,sections.map(g=>[g.mode,g.items.map(f=>[f.path,f.fingerprint,f.digest,f.reviewed])]),s.layout,$('wrapCode').checked,$('fullContext').checked]);
  if(signature===next&&!force){busy(s.busy);return;}signature=next;generation++;observer?.disconnect();const scroll=column.scrollTop;
  container.replaceChildren();cards.clear();if(s.scope.mode==='commit'){const c=s.repository?.commits?.find(c=>c.sha===s.scope.target);if(c){const meta=el('header',undefined,'summary-commit-meta');meta.append(el('h2',c.title),el('p',`${c.author} · ${localDate(c.date)} · ${c.sha.slice(0,12)}`,'muted'));container.append(meta);}}observer=new IntersectionObserver(changes=>{for(const change of changes)if(change.isIntersecting){const c=cards.get(change.target);if(c&&!collapsed.has(key(c)))void load(change.target,c);observer.unobserve(change.target);}},{root:column,rootMargin:'400px'});
  for(const g of sections){if(!g.items.length)continue;const section=el('section',undefined,'summary-section');section.dataset.summaryMode=g.mode;const head=el('header',undefined,'summary-section-header');head.append(el('h2',`${g.title} (${g.items.length})`));
   if(s.live){const actions=el('span',undefined,'toolbar');for(const [operation,label] of g.mode==='staged'?[['unstage','Unstage All']]:[['discard','Discard All'],['stage','Stage All']]){const b=button(label,()=>bulk(operation));b.dataset.summaryAction=operation+'-all';actions.append(b);}head.append(actions);}section.append(head);
   for(const f of g.items){const ctx={path:f.path,mode:g.mode,record:f},card=el('article',undefined,'summary-file');card.dataset.summaryPath=f.path;const bar=el('header',undefined,'summary-file-header'),toggle=button((collapsed.has(key(ctx))?'▸ ':'▾ ')+f.path,()=>{if(collapsed.has(key(ctx)))collapsed.delete(key(ctx));else collapsed.add(key(ctx));body.hidden=collapsed.has(key(ctx));toggle.textContent=(body.hidden?'▸ ':'▾ ')+f.path;toggle.setAttribute('aria-expanded',String(!body.hidden));if(!body.hidden)void load(card,ctx);},'summary-file-toggle');toggle.dataset.collapseFile='';toggle.title=f.path;toggle.setAttribute('aria-expanded',String(!collapsed.has(key(ctx))));bar.append(toggle);
    const actions=el('span',undefined,'summary-file-actions');if(s.live)for(const [operation,label] of g.mode==='staged'?[['unstage','Unstage']]:[['discard','Discard'],['stage','Stage']]){const b=button(label,()=>mutateFile(ctx,operation));b.dataset.summaryAction=operation;actions.append(b);}
    if(s.review&&s.project.isGit&&['working','unstaged'].includes(s.review.mode)&&f.reviewed){const b=button('Stage 已审阅文件',()=>stageReviewed(ctx));b.dataset.summaryAction='stage-reviewed';actions.append(b);}
    const label=el('label',undefined,'check'),check=el('input');check.type='checkbox';check.checked=Boolean(f.reviewed);check.dataset.reviewFile=f.path;check.setAttribute('aria-label',`标记已审阅 ${f.path}`);check.onchange=()=>markReviewed(ctx,check.checked);label.append(check,el('span','已审阅'));actions.append(label);bar.append(actions);card.append(bar);
    const body=el('div',undefined,'summary-file-body');body.hidden=collapsed.has(key(ctx));body.append(el('p','正在读取差异…','summary-loading'));card.append(body);section.append(card);cards.set(card,ctx);if(!body.hidden)observer.observe(card);
   }container.append(section);
  }
  if(!container.childElementCount){const empty=el('div',undefined,'empty-state');empty.append(el('h2',s.scope.mode==='working'?'工作区干净':'当前范围没有文件差异'),el('p','切换范围或刷新，查看最新内容。'));container.append(empty);}
  column.scrollTop=scroll;busy(s.busy);
 }
 async function reveal(path,mode){if(active.kind!=='summary')return;const entry=[...cards].find(([,ctx])=>ctx.path===path&&ctx.mode===mode)||[...cards].find(([,ctx])=>ctx.path===path);if(!entry)return;const [card,ctx]=entry;card.scrollIntoView({block:'start'});card.querySelector('[data-collapse-file]')?.focus({preventScroll:true});if(!collapsed.has(key(ctx)))await load(card,ctx);}
 return {render,reset,summary,activate,reveal,isSummary:()=>active.kind==='summary',busy};
}
