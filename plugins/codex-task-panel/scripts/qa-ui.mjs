import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const [url,browser]=process.argv.slice(2);
if(!url||!browser||!['127.0.0.1','localhost'].includes(new URL(url).hostname))throw Error('Usage: node scripts/qa-ui.mjs <local demo URL> <browse binary>');
const dir=resolve('docs/qa-2026-10-12');mkdirSync(`${dir}/screenshots`,{recursive:true});
const results=[];
function command(...args){const out=execFileSync(browser,args,{encoding:'utf8',timeout:25000});if(/\bERROR:|operation timed out/i.test(out))throw Error(out);return out.trim();}
function ready(){command('wait','#content[aria-busy=false]');}
function click(sel){command('click',sel);ready();}
function fill(sel,value){if(value)command('fill',sel,value);else{command('click',sel);command('press','Meta+A');command('press','Backspace');}}
function check(name,expr){const result=command('js',`new Promise(resolve=>{let n=0;const tick=()=>{if(Boolean(${expr}))resolve(true);else if(++n>=60)resolve(false);else setTimeout(tick,50);};tick();})`);if(result!=='true')throw Error(`${name}: ${result}`);results.push(name);console.log(`PASS ${name}`);writeFileSync(`${dir}/ui-results.json`,JSON.stringify({url,passed:results},null,2));}
function shot(name){command('screenshot',`${dir}/screenshots/${name}.png`);}
const first='.lane:first-child .card:first-child';
try{
 command('goto',url);ready();
 check('演示库初始 6 项任务',"document.querySelectorAll('[data-card]').length===6");
 fill('[data-filter=search]','消息');check('中文搜索与输入焦点',"document.querySelectorAll('[data-card]').length===1&&document.activeElement.dataset.filter==='search'&&document.activeElement.value==='消息'");
 command('type','列表');check('连续输入不丢字',"document.activeElement.value==='消息列表'");
 fill('[data-filter=search]','不存在');check('搜索空结果',"document.querySelectorAll('[data-card]').length===0");fill('[data-filter=search]','');
 command('select','[data-filter=account]','100');command('select','[data-filter=owner]','demo.nick');check('清空搜索与组合筛选',"document.querySelectorAll('[data-card]').length===6");
 click('[data-act=settings]');fill('#new-lane','   ');click('#add-lane button');check('空白泳道前端校验保留输入',"!document.querySelector('#new-lane').validity.valid&&document.querySelector('#new-lane').value==='   '");
 fill('#new-lane','待处理');click('#add-lane button');check('重复泳道错误保留输入',"document.getElementById('error').textContent.includes('已存在')&&document.querySelector('#new-lane').value==='待处理'");
 fill('#new-lane','待评审 QA');click('#add-lane button');check('创建泳道并清空添加框',"document.querySelectorAll('[data-lane-name]').length===5&&document.querySelector('#new-lane').value===''");
 const laneId=command('js',"[...document.querySelectorAll('[data-lane-name]')].at(-1).dataset.laneName").replace(/^"|"$/g,'');
 fill(`[data-lane-name="${laneId}"]`,'评审 QA');click(`[data-rename="${laneId}"]`);check('重命名泳道',`document.querySelector('[data-lane-name="${laneId}"]').value==='评审 QA'`);
 click(`[data-up="${laneId}"]`);check('泳道排序',`[...document.querySelectorAll('[data-lane-name]')][3].dataset.laneName==='${laneId}'`);
 click('[data-settings-tab=workflow]');check('新泳道默认无路径',`![...document.querySelectorAll('[data-workflow-lane="${laneId}"] input')].some(el=>el.checked)`);
 command('click','[data-workflow-lane]:first-child label:nth-child(2) input');
 const ruleForm=command('js',"document.querySelector('[data-workflow-lane]').dataset.workflowLane").replace(/^"|"$/g,'');
 click(`[data-workflow-lane="${ruleForm}"] button`);check('工作流保存成功',"document.getElementById('notice').textContent.includes('已保存')");
 click('[data-settings-tab=lanes]');click(`[data-delete-lane="${laneId}"]`);check('删除空泳道',"document.querySelectorAll('[data-lane-name]').length===4");
 click('[data-settings-tab=source]');fill('[name=workspaceId]','abc');click('#source-settings button');check('工作空间格式校验',"!document.querySelector('[name=workspaceId]').validity.valid&&document.querySelector('[name=workspaceId]').value==='abc'");
 fill('[name=workspaceId]','100');fill('[name=ownerName]','   ');click('#source-settings button');check('姓名空白校验保留输入',"!document.querySelector('[name=ownerName]').validity.valid&&document.querySelector('[name=ownerName]').value==='   '");
 fill('[name=ownerName]','演示用户');click('#source-settings button');check('数据源保存',"document.getElementById('notice').textContent.includes('已保存')");
 shot('settings');click('.app-header [data-act=board]');click(first);check('任务全文与安全清理',"document.getElementById('original-body').textContent.includes('验收标准')&&!document.querySelector('#original-body script')&&!window.__unsafe");
 check('原始地址',"document.querySelector('.source-link').href.startsWith('https://www.tapd.cn/100/prong/tasks/view/')");
 command('select','[data-move]','进行中');ready();check('详情按工作流前进',"document.querySelector('[data-move] option:checked').textContent==='进行中'");
 click('[data-act=bind-dialog]');check('会话第一页与分页',"document.querySelectorAll('[data-thread-select]').length===25&&!document.querySelector('[data-act=thread-next]').disabled");
 fill('#thread-search input','未提交的搜索');command('click','.thread-option:first-child input');check('勾选保留搜索输入',"document.querySelector('#thread-search input').value==='未提交的搜索'");
 fill('#thread-search input','示例会话 3');click('#thread-search button');check('会话搜索',"document.querySelectorAll('[data-thread-select]').length===4");
 command('click','.thread-option:first-child input');click('[data-act=bind-threads]');check('多选跨搜索绑定并关闭弹窗',"!document.getElementById('session-dialog')&&document.querySelectorAll('.session-row').length===2");
 click('[data-act=bind-dialog]');check('已绑定会话禁止重复选择',"[...document.querySelectorAll('[data-thread-select]')].some(el=>el.disabled&&el.checked)");
 click('[data-act=thread-next]');check('会话下一页',"document.querySelectorAll('[data-thread-select]').length===7");click('[data-act=thread-prev]');check('会话上一页',"document.querySelectorAll('[data-thread-select]').length===25");
 command('press','Escape');check('Escape 关闭弹窗',"!document.getElementById('session-dialog')");
 click('.session-row:first-child [data-thread-unbind]');check('解除仅一个关联',"document.querySelectorAll('.session-row').length===1");
 click('[data-act=new-dialog]');fill('[name=title]','QA 空会话');fill('[name=cwd]','relative/path');click('#new-thread button[type=submit]');check('非法目录错误并保留标题目录',"document.querySelector('[name=title]').value==='QA 空会话'&&document.querySelector('[name=cwd]').value==='relative/path'&&!document.querySelector('[name=cwd]').readOnly&&document.querySelector('#session-dialog [role=alert]').textContent.includes('绝对路径')");
 fill('[name=cwd]','/tmp');click('#new-thread button[type=submit]');check('创建并绑定一次及宿主恢复提示',"document.querySelector('.creation-result').textContent.includes('并绑定')&&document.querySelector('.creation-result').textContent.includes('未发送消息')&&document.getElementById('error').textContent.includes('codex resume')");
 shot('sessions');click('.session-dialog-head [data-act=close-thread-dialog]');click('.app-header [data-act=board]');check('卡片关联数量',"[...document.querySelectorAll('.thread-count')].some(el=>el.textContent.includes('2 个'))");
 click('[data-act=import]');click('[data-act=query]');check('导入默认不勾选',"document.querySelectorAll('[data-select]:checked').length===0&&document.querySelector('[data-act=review]').disabled");
 click('[data-act=next]');check('候选分页',"document.querySelectorAll('[data-select]').length===6");click('[data-act=select-page]');
 fill('[data-import-search]','上传');check('候选搜索与跨页选择保留',"document.querySelector('[data-import-search]').value==='上传'&&[...document.querySelectorAll('.title-button')].every(el=>el.textContent.includes('上传'))&&document.querySelector('.footer').textContent.includes('已选 6 项')");
 fill('[data-import-search]','');check('清空候选搜索恢复列表',"document.querySelectorAll('[data-select]').length===25");click('[data-act=only-selected]');check('仅看已选',"document.querySelectorAll('[data-select]').length===6");
 click('[data-act=review]');check('确认导入前不落库',"document.querySelector('h2').textContent.includes('确认导入 6')");shot('import-review');click('[data-act=review-back]');click('[data-act=review]');click('[data-act=commit]');check('只导入所选任务',"document.querySelectorAll('[data-card]').length===12&&document.getElementById('notice').textContent.includes('新增 6 项')");
 click('[data-act=history]');check('导入记录',"document.querySelectorAll('.reviewrow').length===2");click('.app-header [data-act=board]');command('reload');ready();check('刷新后任务和关联持久化',"document.querySelectorAll('[data-card]').length===12&&[...document.querySelectorAll('.thread-count')].some(el=>el.textContent.includes('2 个'))");
 shot('board');const errors=command('console','--errors');writeFileSync(`${dir}/console.txt`,errors);console.log('CONSOLE_ERRORS='+errors);console.log(`UI checks: ${results.length} passed`);
}catch(error){writeFileSync(`${dir}/ui-failure.txt`,error.stack);console.error(error);process.exitCode=1;}
