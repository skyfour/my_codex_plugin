// Presentation only: repository reads and writes are supplied by the application adapter.
export function createDiffView({value,hunks,rows:preparedRows,layout='split',wrap=true,full=false,expanded=new Set(),page=0,onComment,onExpand,onPage,onFull,onHunk}){
 const host=el('div',undefined,'diff-view');host.dataset.diffPath=value.path??'';host.updateAnnotations=()=>false;if(!value.before||!value.after)layout='unified';
 if(value.binary){host.append(el('p','二进制文件，不展示文本差异。','empty-list'));return host;}
 const data=preparedRows??alignedRows(value.before,value.after,window.Diff.diffLines),visible=diffEntries(data,{full,expanded}),blocks=new Map();page=Math.min(page,Math.max(0,Math.floor((visible.length-1)/500)*500));
 if(hunks?.hunks?.length){for(const h of hunks.hunks){const index=data.findIndex(r=>(r.old!==null&&r.old>=h.oldStart&&r.old<h.oldStart+h.oldCount)||(r.new!==null&&r.new>=h.newStart&&r.new<h.newStart+h.newCount));if(index>=0)blocks.set(index,h);}}
 else for(const b of changeBlocks(data))blocks.set(b.index,{label:b.label});
 const table=el('table',undefined,`diff-table ${layout}${wrap?' wrap':''}`),group=el('colgroup');
 for(const cls of layout==='split'?['number','','number','']:['number','number','diff-sign','']){const col=el('col');col.className=cls;group.append(col);}table.append(group);
 if(!wrap){let longest=1;for(const r of data)longest=Math.max(longest,r.before?.length??0,r.after?.length??0);table.style.minWidth=`${Math.min(12000,Math.max(500,longest*7.3)*(layout==='split'?2:1)+84)}px`;}
 const body=el('tbody'),lineButtons=new Map(),annotationRows=new Map();let mountedEditor=null;table.append(body);
 const number=(line,side)=>{const cell=el('td',undefined,'number');if(line!=null){const b=button(String(line),()=>onComment?.(side,line));b.dataset.commentSide=side;b.dataset.commentLine=String(line);b.setAttribute('aria-label',`${side==='before'?'旧':'新'}代码第 ${line} 行添加评论`);b.title=`添加批注 · ${side==='before'?'旧':'新'}代码第 ${line} 行`;lineButtons.set(`${side}:${line}`,b);cell.append(b);}return cell;};
 const code=(text,type='',half=false)=>{const cell=el('td',undefined,'code-cell '+type+(half?' before-half':''));if(text!=null)cell.append(highlight(text,value.path));else cell.classList.add('blank-line');return cell;};
 if(page)host.append(button('上一页代码',()=>onPage?.(Math.max(0,page-500)),'load-more'));
 for(const r of visible.slice(page,page+500)){
  if(r.fold){const row=el('tr',undefined,'fold'),cell=el('td');cell.colSpan=4;cell.append(button(`展开 ${r.count} 行上下文`,()=>onExpand?.(r)));row.append(cell);body.append(row);continue;}
  if(blocks.has(r.index)){const h=blocks.get(r.index),row=el('tr',undefined,'change-location'),cell=el('td');cell.colSpan=4;
   const bar=el('div',undefined,'diff-hunk-header'),toggle=button(full?'收起上下文':'完整上下文',()=>onFull?.(!full),'context-toggle');toggle.title='切换完整文件与精简差异';bar.append(toggle,el('span',h.label||`修改前：第 ${h.oldStart} 行 → 修改后：第 ${h.newStart} 行`,'hunk-location'));
   if(h.id&&onHunk){const actions=el('span',undefined,'hunk-actions');for(const [operation,label] of hunks.mode==='staged'?[['unstage','Unstage Hunk']]:[['discard','Discard Hunk'],['stage','Stage Hunk']]){const b=button(label,()=>onHunk(h,operation));b.dataset.hunkOperation=operation;if(operation!=='discard')iconTool(b,operation,operation==='stage'?'Stage Hunk · 暂存当前改动块':'Unstage Hunk · 取消当前改动块的暂存');actions.append(b);}bar.append(actions);}cell.append(bar);row.append(cell);body.append(row);
  }
  if(layout==='split'){const row=el('tr');row.dataset.row=r.index;row.append(number(r.old,'before'),code(r.before,r.type==='change'?'del-line':'',true),number(r.new,'after'),code(r.after,r.type==='change'?'add-line':''));body.append(row);}
  else for(const side of r.type==='context'?['after']:['before','after']){if(r[side==='before'?'old':'new']===null)continue;const row=el('tr',undefined,r.type==='change'?(side==='before'?'del-line':'add-line'):'');row.dataset.row=r.index;row.append(number(side==='before'||r.type==='context'?r.old:null,'before'),number(side==='after'?r.new:null,'after'),el('td',r.type==='context'?' ':side==='before'?'−':'+','diff-sign'),code(r[side]));body.append(row);}
 }
 host.updateAnnotations=({comments=[],anchor=null,editor=null,onDelete}={})=>{
  const desired=new Map(),add=(side,line,comment)=>{const target=lineButtons.get(`${side}:${line}`);if(!target)return;const row=target.closest('tr');if(!desired.has(row))desired.set(row,{before:[],after:[]});if(comment)desired.get(row)[side].push(comment);return row;};
  for(const comment of comments)if(['before','after'].includes(comment.side)&&(!comment.path||comment.path===value.path))add(comment.side,comment.line,comment);
  const editorRow=editor&&anchor&&['before','after'].includes(anchor.side)?add(anchor.side,anchor.line):null;
  for(const [source,item] of annotationRows)if(!desired.has(source)){if(mountedEditor&&item.row.contains(mountedEditor))mountedEditor.remove();item.row.remove();annotationRows.delete(source);}
  for(const [source,notes] of desired){
   let item=annotationRows.get(source);if(!item){const row=el('tr',undefined,'annotation-row'),cells=layout==='split'?[el('td'),el('td')]:[el('td')];for(const cell of cells){cell.colSpan=layout==='split'?2:4;cell.className='inline-annotations';row.append(cell);}source.after(row);item={row,cells};annotationRows.set(source,item);}
   for(const [index,cell] of item.cells.entries()){
    const sides=layout==='split'?[index===0?'before':'after']:['before','after'],currentEditor=editorRow===source&&sides.includes(anchor.side)?editor:null;
    for(const child of [...cell.children])if(child!==currentEditor)child.remove();
    for(const side of sides)for(const comment of notes[side]){
     const kind={note:'备注',issue:'问题',blocking:'阻塞问题'}[comment.severity]||'备注',location=`${side==='before'?'旧':'新'}代码第 ${comment.line} 行`,note=el('article',undefined,'inline-comment'),heading=el('header',undefined,'inline-comment-heading');
     note.dataset.commentId=String(comment.id??'');note.dataset.commentSide=side;note.dataset.commentLine=String(comment.line);note.dataset.severity=['note','issue','blocking'].includes(comment.severity)?comment.severity:'note';note.setAttribute('aria-label',`${kind} · ${location}`);heading.append(el('strong',kind),el('span',location,'inline-comment-location'));
     if(onDelete){const remove=button('删除',()=>onDelete(comment),'inline-comment-delete');remove.setAttribute('aria-label',`删除${kind} · ${location}`);remove.dataset.deleteComment=String(comment.id??'');heading.append(remove);}
     note.append(heading,el('p',comment.text,'inline-comment-text'));cell.insertBefore(note,currentEditor?.parentNode===cell?currentEditor:null);
    }
    cell.classList.toggle('annotation-empty',!notes[sides[0]].length&&(sides.length===1||!notes[sides[1]].length)&&!currentEditor);
    if(currentEditor){currentEditor.classList.add('inline-comment-editor');if(currentEditor.parentNode!==cell)cell.append(currentEditor);mountedEditor=currentEditor;}
   }
  }
  return Boolean(editorRow&&editor?.isConnected&&host.contains(editor));
 };
 host.append(table);if(visible.length>page+500)host.append(button('下一页代码',()=>onPage?.(page+500),'load-more'));if(!data.length)host.append(el('p','空文件','empty-list'));return host;
}

export function createReviewSurface({state,readFile,select,mutateFile,mutateHunk,markReviewed,stageReviewed,comment,bulk,decorate}){
 const container=$('code'),tabs=$('detailTabs'),header=$('detailHeader'),column=document.querySelector('.detail-column');
 // Keep the existing scroll owner; sticky controls define its readable top edge.
 function topInset(){const height=header.offsetHeight+$('commitWorkspace').offsetHeight,value=height+'px';if(column.style.getPropertyValue('--summary-top-inset')!==value)column.style.setProperty('--summary-top-inset',value);return height;}
 const resize=new ResizeObserver(topInset);for(const node of [column,header,$('commitWorkspace')])resize.observe(node);
 const summaryContainer=el('div'),fileContainer=el('div');summaryContainer.dataset.reviewSummary='';fileContainer.dataset.reviewFileView='';container.replaceChildren(summaryContainer);
 let active={kind:'summary'},signature='',generation=0,observer=null,loadedBytes=0,lastFull=false,activeReads=0,cacheOwner='',summaryScroll=0,interaction=0,positionFollow=null;
 const readWaiters=[],cards=new Map(),cardNodes=new Map(),sectionsByMode=new Map(),collapsed=new Set(),options=new Map(),cache=new Map(),loads=new WeakMap();
 const acquireRead=()=>new Promise(resolve=>{if(activeReads<3){activeReads++;resolve();}else readWaiters.push(resolve);});
 const releaseRead=()=>{const next=readWaiters.shift();if(next)next();else activeReads--;};
 const key=c=>`${c.mode}:${c.path}`;
 function stopFollowing(){positionFollow=null;}
 function userInteraction(){interaction++;stopFollowing();}
 for(const type of ['wheel','touchstart'])column.addEventListener(type,userInteraction,{capture:true,passive:true});
 for(const type of ['pointerdown','keydown'])document.addEventListener(type,userInteraction,true);
 function showActive(){const host=active.kind==='summary'?summaryContainer:fileContainer;if(container.firstElementChild!==host)container.replaceChildren(host);column.dataset.detailView=active.kind;topInset();}
 function groups(s,filtered=true){
  const filter=filtered?$('fileSearch').value.toLowerCase():'',items=s.files.filter(f=>!f.directory&&!f.symlink&&f.path.toLowerCase().includes(filter));
  if(s.live)return ['unstaged','staged'].filter(mode=>s.scope.mode==='working'||s.scope.mode===mode).map(mode=>({mode,title:mode==='unstaged'?'Working Directory · 未暂存':'Staged Files · 已暂存',items:items.filter(f=>mode==='unstaged'?f.canStage:f.canUnstage)}));
  return [{mode:s.review?.mode||s.scope.mode,title:s.review?'审查快照':s.scope.mode==='files'?'本地文件':'提交变更',items}];
 }
 function capturePosition({preferFocus=true}={}){
  if(active.kind!=='summary'||!summaryContainer.childElementCount)return null;
  if(positionFollow?.interaction===interaction&&positionFollow.owner===cacheOwner)return positionFollow;
  const viewport=column.getBoundingClientRect(),inset=topInset(),top=viewport.top+inset;
  const focused=preferFocus?document.activeElement?.closest('[data-summary-path]'):null;
  const visibleCards=[...summaryContainer.querySelectorAll('[data-summary-path]')];
  const card=focused&&cards.has(focused)?focused:visibleCards.find(c=>{const r=c.getBoundingClientRect();return r.bottom>top&&r.top<viewport.bottom;});
  if(!card)return {interaction,owner:cacheOwner,scroll:column.scrollTop};
  const ctx=cards.get(card),siblings=visibleCards.filter(node=>cards.get(node)?.mode===ctx.mode).map(node=>({node,path:cards.get(node).path})),index=siblings.findIndex(c=>c.node===card),rect=card.getBoundingClientRect();
  return {interaction,owner:cacheOwner,mode:ctx.mode,path:ctx.path,offset:rect.top-viewport.top,replacementOffset:Math.max(inset+8,card.querySelector('.summary-file-header').getBoundingClientRect().top-viewport.top),next:siblings.slice(index+1).map(c=>c.path),previous:siblings.slice(0,index).reverse().map(c=>c.path),scroll:column.scrollTop};
 }
 function keepPosition(){
  const token=positionFollow;if(!token||token.interaction!==interaction||token.owner!==cacheOwner||active.kind!=='summary')return;
  const connected=path=>{const card=cardNodes.get(key({mode:token.mode,path}));return card?.isConnected?card:null;},exact=connected(token.path),card=exact||(token.next??[]).map(connected).find(Boolean)||(token.previous??[]).map(connected).find(Boolean);
  if(card?.isConnected){const offset=exact?token.offset:token.replacementOffset;column.scrollTop+=card.getBoundingClientRect().top-column.getBoundingClientRect().top-offset;}else column.scrollTop=token.scroll;
  summaryScroll=column.scrollTop;
 }
 function restorePosition(token,{adoptOwner=false}={}){if(adoptOwner&&token)token={...token,owner:cacheOwner};if(!token||token.interaction!==interaction||token.owner!==cacheOwner||active.kind!=='summary')return;positionFollow=token;keepPosition();}
 function summary(){stopFollowing();const wasFile=active.kind==='file';active={kind:'summary'};showActive();if(wasFile)column.scrollTop=summaryScroll;render(true);}
 function activate(path,mode){if(active.kind==='summary')summaryScroll=column.scrollTop;observer?.disconnect();stopFollowing();active={kind:'file',path,mode};showActive();renderTabs();}
 function reset(toSummary=false,preserveCache=false){stopFollowing();if(toSummary)active={kind:'summary'};showActive();signature='';generation++;observer?.disconnect();if(!preserveCache){cache.clear();loadedBytes=0;}}
 function renderTabs(){
  const s=state(),sections=groups(s);tabs.hidden=!s.project;
  const next=JSON.stringify([active,sections.map(g=>[g.mode,g.items.map(f=>f.path)])]);if(tabs.dataset.signature===next)return;tabs.dataset.signature=next;tabs.replaceChildren();
  const add=(label,selected,fn,title)=>{const b=button(label,fn);b.setAttribute('role','tab');b.setAttribute('aria-selected',String(selected));b.title=title||label;tabs.append(b);};
  add('Summary',active.kind==='summary',()=>summary(),'连续查看全部文件差异');
  for(const g of sections)for(const f of g.items)add(`${g.mode==='staged'?'S':g.mode==='unstaged'?'M':'·'} ${f.path.split('/').at(-1)}`,active.kind==='file'&&active.path===f.path&&active.mode===g.mode,()=>select(f.path,g.mode),`${g.title} · ${f.path}`);
 }
 function busy(value){container.querySelectorAll('[data-summary-action],[data-hunk-operation],[data-review-file]').forEach(b=>{b.disabled=value||b.dataset.ineligible==='true';});}
 function viewOptions(ctx){const k=key(ctx);if(!options.has(k))options.set(k,{full:$('fullContext').checked,expanded:new Set(),page:0});return options.get(k);}
 function viewSignature(ctx){const o=viewOptions(ctx);return JSON.stringify([state().layout,$('wrapCode').checked,o.full,[...o.expanded],o.page]);}
 function views(){return [...cards].flatMap(([card,ctx])=>{const view=card.isConnected&&card.querySelector('.diff-view');return view?[{view,ctx}]:[];});}
 function decorateViews(){for(const {view,ctx} of views())decorate?.(view,ctx);}
 function draw(card,ctx,data,preparedRows){
  const body=card.querySelector('.summary-file-body'),o=viewOptions(ctx),desiredView=viewSignature(ctx);
  if(ctx.drawnData===data&&ctx.viewSignature===desiredView){const view=body.querySelector('.diff-view');if(view)decorate?.(view,ctx);return;}ctx.drawnData=data;ctx.viewSignature=desiredView;
  body.replaceChildren();if(data.error){body.append(el('p',data.error.message,'summary-error'),button('重试',()=>{cache.delete(key(ctx));void load(card,ctx);}),button('单独查看',()=>select(ctx.path,ctx.mode)));keepPosition();return;}
  if(data.hunks?.notice)body.append(el('p',data.hunks.notice,'hunk-notice'));
  try{const view=createDiffView({value:data.file,hunks:data.hunks,rows:preparedRows,layout:state().layout,wrap:$('wrapCode').checked,...o,
   onComment:(side,line)=>comment(ctx,side,line),onExpand:r=>{for(let i=r.start;i<r.end;i++)o.expanded.add(i);draw(card,ctx,data);},onPage:page=>{o.page=page;draw(card,ctx,data);},onFull:full=>{o.full=full;draw(card,ctx,data);},onHunk:state().live?(h,operation)=>mutateHunk(ctx,data.hunks,h,operation):undefined
  });body.append(view);decorate?.(view,ctx);}catch(error){body.append(el('p',error.message,'summary-error'));}busy(state().busy);keepPosition();
 }
 function load(card,ctx){
  const existing=loads.get(card);if(existing?.generation===generation)return existing.promise;
  const promise=loadCard(card,ctx);loads.set(card,{promise,generation});
  void promise.then(()=>{if(loads.get(card)?.promise===promise)loads.delete(card);},()=>{if(loads.get(card)?.promise===promise)loads.delete(card);});return promise;
 }
 async function loadCard(card,ctx){
  const token=generation,k=key(ctx);card.dataset.loading='true';
  try{let data=cache.get(k);if(!data){await acquireRead();try{if(token!==generation||!card.isConnected)return;data=await readFile(ctx);}finally{releaseRead();}if(token!==generation)return;const bytes=new Blob([data.file.before||'',data.file.after||'']).size,limit=(state().limits?.totalMiB||50)*1024*1024;
    if(loadedBytes+bytes>limit)throw Error('连续预览已达到本次内存上限，可单独查看这个文件。');loadedBytes+=bytes;data={...data,bytes,fingerprint:ctx.record.fingerprint};cache.set(k,data);}
   if(token===generation&&card.isConnected)draw(card,ctx,data);
  }catch(error){if(token===generation&&card.isConnected)draw(card,ctx,{error});}finally{if(loads.get(card)?.generation===token||!loads.has(card))delete card.dataset.loading;}
 }
 function makeCard(ctx,s){
  const card=el('article',undefined,'summary-file');card.dataset.summaryPath=ctx.path;const bar=el('header',undefined,'summary-file-header'),body=el('div',undefined,'summary-file-body');
  const toggle=button('',()=>{if(collapsed.has(key(ctx)))collapsed.delete(key(ctx));else collapsed.add(key(ctx));body.hidden=collapsed.has(key(ctx));toggle.textContent=(body.hidden?'▸ ':'▾ ')+ctx.path;toggle.setAttribute('aria-expanded',String(!body.hidden));if(!body.hidden)void load(card,ctx);},'summary-file-toggle');toggle.dataset.collapseFile='';toggle.title=ctx.path;bar.append(toggle);
  const actions=el('span',undefined,'summary-file-actions');if(s.live)for(const [operation,label] of ctx.mode==='staged'?[['unstage','Unstage']]:[['discard','Discard'],['stage','Stage']]){const b=button(label,()=>mutateFile(ctx,operation));b.dataset.summaryAction=operation;if(operation!=='discard')iconTool(b,operation,operation==='stage'?'Stage · 暂存此文件':'Unstage · 取消此文件的暂存');actions.append(b);}
  const label=el('label',undefined,'check'),check=el('input');check.type='checkbox';check.dataset.reviewFile=ctx.path;check.setAttribute('aria-label',`标记已审阅 ${ctx.path}`);check.onchange=()=>markReviewed(ctx,check.checked);label.append(check,el('span','已审阅'));actions.append(label);bar.append(actions);card.append(bar,body);return card;
 }
 function render(force=false){
  const s=state(),owner=JSON.stringify([s.project?.id,s.review?.id||'live',s.scope]);
  if(owner!==cacheOwner){stopFollowing();cacheOwner=owner;generation++;observer?.disconnect();cache.clear();options.clear();collapsed.clear();cards.clear();cardNodes.clear();sectionsByMode.clear();summaryContainer.replaceChildren();loadedBytes=0;signature='';summaryScroll=0;}
  if(lastFull!==$('fullContext').checked){lastFull=$('fullContext').checked;for(const o of options.values())o.full=lastFull;}renderTabs();showActive();if(active.kind!=='summary'||!s.project)return;
  const sections=groups(s),next=JSON.stringify([s.project.id,s.review?.id,s.review?.version,s.scope,sections.map(g=>[g.mode,g.items.map(f=>[f.path,f.fingerprint,f.digest,f.reviewed])]),s.layout,$('wrapCode').checked,$('fullContext').checked]);
  if(signature===next&&!force){decorateViews();busy(s.busy);return;}const position=positionFollow||capturePosition({preferFocus:false}),viewport=column.getBoundingClientRect();
  // Read current bounds together before reconciling or painting. Cached cards
  // outside the nearby viewport retain their DOM until observed on scroll.
  const nearby=new Set([...cards.keys()].filter(card=>{if(!card.isConnected)return false;const rect=card.getBoundingClientRect();return rect.bottom>=viewport.top-400&&rect.top<=viewport.bottom+400;}));
  signature=next;generation++;observer?.disconnect();
  const records=new Map(sections.flatMap(g=>g.items.map(f=>[key({mode:g.mode,path:f.path}),f]))),allSections=groups(s,false),allRecords=new Map(allSections.flatMap(g=>g.items.map(f=>[key({mode:g.mode,path:f.path}),f])));
  for(const [k,data] of cache)if(!allRecords.has(k)||data.fingerprint!==allRecords.get(k).fingerprint){loadedBytes-=data.bytes;cache.delete(k);}
  for(const [k,card] of cardNodes){if(!records.has(k))card.remove();if(!allRecords.has(k)){cards.delete(card);cardNodes.delete(k);options.delete(k);collapsed.delete(k);}}
  for(const [mode,section] of sectionsByMode)if(!sections.some(g=>g.mode===mode&&g.items.length)){section.remove();if(!allSections.some(g=>g.mode===mode&&g.items.length))sectionsByMode.delete(mode);}
  summaryContainer.querySelector('.empty-state')?.remove();
  if(s.scope.mode==='commit'&&!summaryContainer.querySelector('.summary-commit-meta')){const c=s.repository?.commits?.find(c=>c.sha===s.scope.target);if(c){const meta=el('header',undefined,'summary-commit-meta'),actions=el('div',undefined,'summary-commit-actions toolbar'),message=copyTextButton(c.message,'复制完整提交信息'),hash=copyTextButton(c.sha,'复制完整提交哈希');message.dataset.copyCommitMessage='';message.disabled=typeof c.message!=='string'||!c.message;hash.dataset.copyCommitHash='';actions.append(message,hash);meta.append(el('h2',c.title),el('p',`${c.author} · ${localDate(c.date)} · ${c.sha.slice(0,12)}`,'muted'),actions);summaryContainer.prepend(meta);}}
  observer=new IntersectionObserver(changes=>{for(const change of changes)if(change.isIntersecting){const c=cards.get(change.target);if(c&&!collapsed.has(key(c)))void load(change.target,c);observer.unobserve(change.target);}},{root:column,rootMargin:'400px'});
  let sectionIndex=s.scope.mode==='commit'&&summaryContainer.querySelector('.summary-commit-meta')?1:0;
  for(const g of sections){if(!g.items.length)continue;let section=sectionsByMode.get(g.mode);
   if(!section){section=el('section',undefined,'summary-section');section.dataset.summaryMode=g.mode;const head=el('header',undefined,'summary-section-header');head.append(el('h2'));
    if(s.live){const actions=el('span',undefined,'toolbar');for(const [operation,label] of g.mode==='staged'?[['unstage','Unstage All']]:[['discard','Discard All'],['stage','Stage All']]){const b=button(label,()=>bulk(operation));b.dataset.summaryAction=operation+'-all';actions.append(b);}head.append(actions);}section.append(head);sectionsByMode.set(g.mode,section);
   }
   section.querySelector('.summary-section-header h2').textContent=`${g.title} (${g.items.length})`;if(summaryContainer.children[sectionIndex]!==section)summaryContainer.insertBefore(section,summaryContainer.children[sectionIndex]??null);sectionIndex++;
   let cardIndex=1;
   for(const f of g.items){const k=key({mode:g.mode,path:f.path});let card=cardNodes.get(k),ctx=card&&cards.get(card);if(!card){ctx={path:f.path,mode:g.mode,record:f};card=makeCard(ctx,s);cards.set(card,ctx);cardNodes.set(k,card);}else ctx.record=f;
    if(section.children[cardIndex]!==card)section.insertBefore(card,section.children[cardIndex]??null);cardIndex++;
    const body=card.querySelector('.summary-file-body'),toggle=card.querySelector('[data-collapse-file]'),check=card.querySelector('[data-review-file]');body.hidden=collapsed.has(k);toggle.textContent=(body.hidden?'▸ ':'▾ ')+f.path;toggle.setAttribute('aria-expanded',String(!body.hidden));check.checked=Boolean(f.reviewed);
    let stage=card.querySelector('[data-summary-action=stage-reviewed]');const eligible=s.review&&s.project.isGit&&['working','unstaged'].includes(s.review.mode)&&f.reviewed;if(eligible&&!stage){stage=iconTool(button('Stage 已审阅文件',()=>stageReviewed(ctx)),'reviewed','核对审阅快照后暂存此文件');stage.dataset.summaryAction='stage-reviewed';card.querySelector('.summary-file-actions').prepend(stage);}else if(!eligible&&stage)stage.remove();
    if(!body.hidden){const data=cache.get(k);if(data){if(nearby.has(card))draw(card,ctx,data);else if(ctx.drawnData!==data||ctx.viewSignature!==viewSignature(ctx))observer.observe(card);}else{ctx.drawnData=null;ctx.viewSignature='';if(!body.querySelector('.summary-loading'))body.replaceChildren(el('p','正在读取差异…','summary-loading'));observer.observe(card);}}
   }
  }
  if(!summaryContainer.childElementCount){const empty=el('div',undefined,'empty-state');empty.append(el('h2',s.scope.mode==='working'?'工作区干净':'当前范围没有文件差异'),el('p','切换范围或刷新，查看最新内容。'));summaryContainer.append(empty);}
  decorateViews();restorePosition(position);busy(s.busy);
 }
 async function showComment(path,side,line,{offset}={}){
  const requestedInteraction=interaction;
  if(active.kind!=='summary'||!['before','after'].includes(side)||!Number.isInteger(line)||line<1)return null;
  const candidates=[...cards].filter(([card,ctx])=>card.isConnected&&ctx.path===path),mode=state().review?.mode??state().scope.mode,match=candidates.find(([,ctx])=>ctx.mode===mode)||candidates[0];if(!match)return null;
  const [card,ctx]=match;collapsed.delete(key(ctx));card.querySelector('.summary-file-body').hidden=false;const toggle=card.querySelector('[data-collapse-file]');toggle.textContent='▾ '+ctx.path;toggle.setAttribute('aria-expanded','true');
  await load(card,ctx);if(requestedInteraction!==interaction||active.kind!=='summary'||!card.isConnected||cards.get(card)!==ctx)return null;
  const find=()=>card.querySelector(`button[data-comment-side="${side}"][data-comment-line="${line}"]`);let target=find();
  if(!target){
   const data=cache.get(key(ctx));if(!data?.file||data.file.binary)return null;
   const aligned=alignedRows(data.file.before,data.file.after,window.Diff.diffLines),rowIndex=aligned.findIndex(row=>row[side==='before'?'old':'new']===line);if(rowIndex<0)return null;
   const o=viewOptions(ctx);for(let index=Math.max(0,rowIndex-3);index<Math.min(aligned.length,rowIndex+4);index++)o.expanded.add(index);
   const visible=diffEntries(aligned,{full:o.full,expanded:o.expanded}),index=visible.findIndex(entry=>entry.index===rowIndex);if(index<0)return null;o.page=Math.floor(index/500)*500;draw(card,ctx,data,aligned);target=find();
  }
  if(!target)return null;
  if(Number.isFinite(offset))column.scrollTop+=target.getBoundingClientRect().top-offset;
  else{const rect=column.getBoundingClientRect(),bounds=target.getBoundingClientRect(),top=rect.top+topInset()+(matchMedia('(min-width:801px)').matches?card.querySelector('.summary-file-header').offsetHeight:0);if(bounds.top<top)column.scrollTop+=bounds.top-top;else if(bounds.bottom>rect.bottom)column.scrollTop+=bounds.bottom-rect.bottom;}
  restorePosition({interaction,owner:cacheOwner,mode:ctx.mode,path:ctx.path,offset:card.getBoundingClientRect().top-column.getBoundingClientRect().top,scroll:column.scrollTop});return target;
 }
 async function reveal(path,mode,expectedInteraction=interaction){if(active.kind!=='summary'||expectedInteraction!==interaction)return;const card=cardNodes.get(key({path,mode}))||[...cards.keys()].find(c=>cards.get(c).path===path);if(!card)return;const ctx=cards.get(card),token=generation,inset=topInset();restorePosition({interaction,owner:cacheOwner,mode:ctx.mode,path:ctx.path,offset:inset+8,replacementOffset:inset+8,scroll:column.scrollTop});card.querySelector('[data-collapse-file]')?.focus({preventScroll:true});if(!collapsed.has(key(ctx)))await load(card,ctx);if(token===generation&&expectedInteraction===interaction)keepPosition();}
 return {render,reset,summary,activate,reveal,showComment,views,capturePosition,restorePosition,topInset,fileContainer,get activeContainer(){return active.kind==='summary'?summaryContainer:fileContainer;},interactionToken:()=>interaction,isSummary:()=>active.kind==='summary',busy};
}
