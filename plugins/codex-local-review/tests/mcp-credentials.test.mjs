import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
test('host forwards provider environment without review interpreting credentials',async()=>{
 const review=JSON.parse(await readFile(new URL('../.mcp.json',import.meta.url),'utf8')).mcpServers['local-review'];
 const panel=JSON.parse(await readFile(new URL('../../codex-task-panel/.mcp.json',import.meta.url),'utf8')).mcpServers['codex-task-panel'];
 for(const key of ['CODEX_HOME','TASK_PANEL_HOME','TAPD_ACCESS_TOKEN']){assert.ok(review.env_vars.includes(key));assert.ok(panel.env_vars.includes(key));}
 const source=await readFile(new URL('../src/task-context-provider.mjs',import.meta.url),'utf8');assert.doesNotMatch(source,/credentials\.json|board\.sqlite|api\.tapd\.cn|TAPD_ACCESS_TOKEN/);
});
