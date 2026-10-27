// Explicit toolbar icons. Keep each button's original name and native tooltip.
const toolIcons={
 folder:'<path d="M3 7V5h6l2 2h10v4M3 7v12h16l3-10H7l-3 10"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',
 sidebar:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M5.5 8h1M5.5 12h1"/>',
 switch:'<path d="M4 8h15l-4-4M20 16H5l4 4"/>',
 settings:'<path d="m10 3-.7 2.2-2 .8-2.1-1-2 3.5L5 10v2L3.2 14l2 3.5 2.1-1 2 .8.7 2.2h4l.7-2.2 2-.8 2.1 1 2-3.5L19 12v-2l1.8-1.5-2-3.5-2.1 1-2-.8L14 3Z"/><circle cx="12" cy="11.5" r="3"/>',
 refresh:'<path d="M20 8a8 8 0 0 0-14-2L3 9m0-5v5h5M4 16a8 8 0 0 0 14 2l3-3m0 5v-5h-5"/>',
 fetch:'<path d="M4 5v6M1 8l3 3 3-3M11 4h8v16H5v-5M11 9h4M9 14h6"/>',
 pull:'<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
 push:'<path d="M12 16V4m-5 5 5-5 5 5M4 17v4h16v-4"/>',
 snapshot:'<path d="M4 5h13l3 3v12H4ZM8 5v6h8V5M8 20v-6h8v6"/>',
 back:'<path d="m10 5-7 7 7 7M3 12h18"/>',
 export:'<path d="M14 3h7v7m0-7L10 14M10 5H4v16h16v-6"/>',
 up:'<path d="m6 14 6-6 6 6"/>',
 down:'<path d="m6 10 6 6 6-6"/>',
 split:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16M6 8h3M6 12h3M15 8h3M15 12h3"/>',
 unified:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h10M7 16h6"/>',
 stage:'<path d="M4 4h16v16H4ZM8 12h8M12 8v8"/>',
 unstage:'<path d="M4 4h16v16H4ZM8 12h8"/>',
 reviewed:'<path d="M4 4h16v16H4ZM8 12l3 3 5-6"/>',
 copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
 copied:'<path d="m5 12 4 4L19 6"/>'
};
function iconTool(node,icon,hint=node.title||node.textContent){
 const label=document.createElement('span');label.className='sr-only';label.textContent=node.textContent;
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.7');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');svg.innerHTML=toolIcons[icon];
 node.replaceChildren(svg,label);node.classList.add('icon-button');node.title=hint;return node;
}
async function writeClipboardText(text){
 try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);return;}}catch{/* Embedded hosts may deny the async Clipboard API. */}
 const active=document.activeElement,selection=window.getSelection(),ranges=selection?[...Array(selection.rangeCount)].map((_,i)=>selection.getRangeAt(i).cloneRange()):[],inputSelection=typeof active?.selectionStart==='number'&&ranges.every(range=>range.collapsed)?{start:active.selectionStart,end:active.selectionEnd,direction:active.selectionDirection}:null,scrolls=new Map(),position={x:window.scrollX,y:window.scrollY};
 const capture=node=>{for(let current=node?.nodeType===1?node:node?.parentElement;current;current=current.parentElement)scrolls.set(current,[current.scrollLeft,current.scrollTop]);};capture(active);for(const range of ranges)capture(range.commonAncestorContainer);capture(document.scrollingElement);
 const field=document.createElement('textarea');field.value=text;field.readOnly=true;field.tabIndex=-1;field.setAttribute('aria-hidden','true');field.style.cssText='position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
 try{(active?.closest('dialog[open]')??document.body).append(field);field.focus({preventScroll:true});field.select();if(document.execCommand?.('copy')!==true)throw Error('无法访问剪贴板');}
 finally{field.remove();if(active?.isConnected)active.focus({preventScroll:true});if(selection){selection.removeAllRanges();for(const range of ranges)selection.addRange(range);}if(inputSelection&&active?.isConnected)active.setSelectionRange(inputSelection.start,inputSelection.end,inputSelection.direction);for(const [node,[left,top]] of scrolls){node.scrollLeft=left;node.scrollTop=top;}window.scrollTo(position.x,position.y);}
}
function copyTextButton(value,label,{menuItem=false}={}){
 let copying=false,timer;
 const paint=(icon,hint)=>{if(menuItem){b.textContent=label.replace(/^复制/,'');b.title=hint;}else iconTool(b,icon,hint);};
 const b=button(label,async()=>{
  if(copying)return;copying=true;clearTimeout(timer);delete b.dataset.copyState;paint('copy',label);b.setAttribute('aria-busy','true');
  try{const text=typeof value==='function'?value():value;if(typeof text!=='string'||!text)throw Error('没有可复制的文本');await writeClipboardText(text);b.dataset.copyState='success';paint('copied',label+' · 已复制');status('已复制'+label.replace(/^复制/,''));}
  catch{b.dataset.copyState='error';b.title=label+' · 复制失败，请手动复制';status('复制失败：无法访问剪贴板，请手动选择文本后复制',true);}
  finally{copying=false;b.removeAttribute('aria-busy');timer=setTimeout(()=>{delete b.dataset.copyState;paint('copy',label);},2000);}
 });
 paint('copy',label);b.classList.add('copy-text-button');b.dataset.copyText='';b.setAttribute('aria-label',label);b.onpointerdown=event=>{if(event.button===0)event.preventDefault();};
 if(menuItem){b.setAttribute('role','menuitem');b.tabIndex=-1;}return b;
}
let copyMenuSequence=0;
function copyTextMenu(items,label){
 const control=el('span',undefined,'copy-control'),trigger=iconTool(button('复制',()=>{}),'copy',label),menu=el('div',undefined,'copy-menu');
 trigger.classList.remove('icon-button');trigger.classList.add('copy-menu-trigger');trigger.querySelector('span').classList.remove('sr-only');trigger.append(el('span','▾','copy-menu-arrow'));trigger.dataset.copyMenuTrigger='';trigger.setAttribute('aria-label',label);trigger.setAttribute('aria-haspopup','menu');trigger.setAttribute('aria-expanded','false');
 menu.id='copy-menu-'+(++copyMenuSequence);menu.popover='auto';menu.setAttribute('role','menu');menu.setAttribute('aria-label',label);trigger.setAttribute('aria-controls',menu.id);menu.append(...items);
 const choices=()=>items.filter(item=>!item.disabled&&!item.hidden);
 const open=keyboard=>{menu.showPopover();const anchor=trigger.getBoundingClientRect(),height=menu.offsetHeight;menu.style.left=Math.max(8,Math.min(anchor.left,innerWidth-menu.offsetWidth-8))+'px';menu.style.top=(anchor.bottom+height+4>innerHeight-8?Math.max(8,anchor.top-height-4):anchor.bottom+4)+'px';if(keyboard)choices()[0]?.focus({preventScroll:true});};
 trigger.onpointerdown=event=>{if(event.button===0)event.preventDefault();};trigger.onclick=event=>{if(menu.matches(':popover-open'))menu.hidePopover();else open(event.detail===0);};
 trigger.onkeydown=event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();open(true);if(event.key==='ArrowUp')choices().at(-1)?.focus({preventScroll:true});}};
 menu.addEventListener('beforetoggle',event=>trigger.setAttribute('aria-expanded',String(event.newState==='open')));
 menu.onkeydown=event=>{event.stopPropagation();const enabled=choices(),index=enabled.indexOf(document.activeElement);let next;if(event.key==='ArrowDown')next=(index+1)%enabled.length;else if(event.key==='ArrowUp')next=(index-1+enabled.length)%enabled.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=enabled.length-1;else if(event.key==='Tab'){menu.hidePopover();trigger.focus({preventScroll:true});return;}else return;event.preventDefault();enabled[next]?.focus({preventScroll:true});};
 for(const item of items)item.addEventListener('click',()=>{if(menu.matches(':popover-open')){const keyboard=menu.contains(document.activeElement);menu.hidePopover();if(keyboard)trigger.focus({preventScroll:true});}});
 control.append(trigger,menu);return control;
}
function closeCopyMenus(){for(const menu of document.querySelectorAll('.copy-menu:popover-open'))menu.hidePopover();}
window.addEventListener('resize',closeCopyMenus);
document.addEventListener('scroll',event=>{if(!event.target.closest?.('.copy-menu'))closeCopyMenus();},true);
document.addEventListener('keydown',event=>{const menu=document.querySelector('.copy-menu:popover-open');if(event.key==='Escape'&&menu){event.preventDefault();event.stopImmediatePropagation();const keyboard=menu.contains(document.activeElement),trigger=menu.parentElement.querySelector('[data-copy-menu-trigger]');menu.hidePopover();if(keyboard)trigger.focus({preventScroll:true});}},true);
for(const [id,icon,hint] of [
 ['openProject','folder','打开项目（⌘O）'],['addProject','plus','打开另一个项目'],
 ['projectMenu','sidebar','显示或隐藏项目管理'],['quickOpen','switch','切换项目（⌘P）'],
 ['settings','settings','预览与快照设置'],['refresh','refresh','刷新当前项目（⌘R）'],
 ['browseProjects','plus','浏览本机文件夹'],['manageProject','settings','管理当前项目'],
 ['gitFetch','fetch','Fetch · 获取远程引用，不合并工作区'],['gitPull','pull','Pull · 从当前跟踪分支拉取，仅快进'],['gitPush','push','Push · 推送当前分支'],
 ['refreshCommit','refresh','刷新暂存区 · 刷新分支和已暂存文件'],['saveReview','snapshot','保存审查快照'],['liveView','back','返回工作区'],['export','export','导出审查记录'],
 ['prevFile','up','上一个文件（Alt+↑ / K）'],['nextFile','down','下一个文件（Alt+↓ / J）'],
 ['splitView','split','并排显示修改前后的代码'],['unifiedView','unified','统一显示代码差异']
])iconTool(document.getElementById(id),icon,hint);
// Its existing label and two SVG states are updated by the fullscreen controller.
const fullscreenTool=document.getElementById('reviewFullscreen');fullscreenTool.classList.add('icon-button');fullscreenTool.querySelector('span').classList.add('sr-only');
