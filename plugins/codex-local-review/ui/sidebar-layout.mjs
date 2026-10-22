// Layout preferences only; resizing never reloads projects or review contents.
function createProjectSidebarLayout(){
 const workbench=document.querySelector('.workbench'),sidebar=document.getElementById('projectSidebar'),handle=document.getElementById('projectSidebarResize'),menu=document.getElementById('projectMenu');
 const storageKey='codex-local-review.sidebar-layout.v1',mobile=matchMedia('(max-width:800px)'),minimum=136;
 let preferredWidth=null,collapsed=false,narrow=mobile.matches,drag=null,frame=0;
 try{const saved=JSON.parse(localStorage.getItem(storageKey));if(saved&&typeof saved==='object'){if(Number.isFinite(saved.width)&&saved.width>=minimum&&saved.width<=420)preferredWidth=saved.width;collapsed=saved.collapsed===true;}}catch{}
 const defaultWidth=()=>innerWidth>1280?220:innerWidth>1000?190:170;
 const maximum=()=>Math.max(minimum,Math.min(420,workbench.clientWidth-document.querySelector('.files-column').getBoundingClientRect().width-360));
 const clamp=value=>Math.round(Math.max(minimum,Math.min(maximum(),value)));
 function persist(){try{localStorage.setItem(storageKey,JSON.stringify({width:preferredWidth,collapsed}));}catch{}}
 function refresh(){
  if(narrow!==mobile.matches){document.body.classList.remove('project-drawer');narrow=mobile.matches;}
  const drawer=document.body.classList.contains('project-drawer');document.body.classList.toggle('projects-collapsed',!narrow&&collapsed);
  sidebar.inert=narrow?!drawer:collapsed;menu.setAttribute('aria-expanded',String(narrow?drawer:!collapsed));menu.title=(narrow?drawer:!collapsed)?'隐藏项目栏':'显示项目栏';
  if(narrow||document.body.classList.contains('review-fullscreen'))return;
  const width=clamp(preferredWidth??defaultWidth());workbench.style.setProperty('--project-sidebar-width',(collapsed?0:width)+'px');
  handle.setAttribute('aria-valuemin',String(minimum));handle.setAttribute('aria-valuemax',String(Math.floor(maximum())));handle.setAttribute('aria-valuenow',String(width));handle.setAttribute('aria-valuetext',`项目栏宽度 ${width} 像素`);
 }
 function finish(commit=false){
  if(!drag)return;const old=drag;drag=null;if(frame){cancelAnimationFrame(frame);frame=0;}
  preferredWidth=commit?clamp(preferredWidth??defaultWidth()):old.preference;document.body.classList.remove('resizing-sidebar');
  if(handle.hasPointerCapture(old.pointerId))handle.releasePointerCapture(old.pointerId);refresh();if(commit)persist();
 }
 function toggle(){
  finish();if(mobile.matches)document.body.classList.toggle('project-drawer');else{collapsed=!collapsed;persist();}
  refresh();if(sidebar.inert&&(sidebar.contains(document.activeElement)||document.activeElement===handle))menu.focus({preventScroll:true});
 }
 function closeDrawer(){const wasOpen=document.body.classList.contains('project-drawer');document.body.classList.remove('project-drawer');refresh();if(wasOpen&&sidebar.contains(document.activeElement))menu.focus({preventScroll:true});}
 handle.addEventListener('pointerdown',event=>{
  if(event.button!==0||mobile.matches||collapsed||document.body.classList.contains('review-fullscreen'))return;
  event.preventDefault();handle.focus({preventScroll:true});drag={pointerId:event.pointerId,start:event.clientX,width:sidebar.getBoundingClientRect().width,preference:preferredWidth};handle.setPointerCapture(event.pointerId);document.body.classList.add('resizing-sidebar');
 });
 handle.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.pointerId)return;preferredWidth=drag.width+event.clientX-drag.start;if(!frame)frame=requestAnimationFrame(()=>{frame=0;refresh();});});
 handle.addEventListener('pointerup',event=>{if(event.pointerId===drag?.pointerId)finish(true);});
 for(const name of ['pointercancel','lostpointercapture'])handle.addEventListener(name,()=>finish());
 handle.addEventListener('dblclick',()=>{finish();preferredWidth=null;refresh();persist();});
 handle.addEventListener('keydown',event=>{
  if(event.metaKey||event.ctrlKey||event.altKey)return;
  if(event.key==='Escape'&&drag){event.preventDefault();event.stopPropagation();finish();return;}
  if(drag)return;
  if(event.key==='Enter'){event.preventDefault();event.stopPropagation();toggle();return;}
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();event.stopPropagation();const step=event.shiftKey?40:10,current=sidebar.getBoundingClientRect().width;
  preferredWidth=clamp(event.key==='Home'?minimum:event.key==='End'?maximum():current+(event.key==='ArrowRight'?step:-step));refresh();persist();
 });
 window.addEventListener('resize',()=>{finish();refresh();});window.addEventListener('blur',()=>finish());refresh();
 return {toggle,closeDrawer,refresh};
}
const sidebarLayout=createProjectSidebarLayout();
