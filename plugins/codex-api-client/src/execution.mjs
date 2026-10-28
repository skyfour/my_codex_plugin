import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function executeCollection(input, { signal, onEvent = () => {} } = {}) {
  return new Promise(resolve => {
    const result = { status: 'running', responses: [], assertions: [], logs: [], errors: [] };
    const child = fork(fileURLToPath(new URL('./worker.mjs', import.meta.url)), [], {
      execArgv: ['--max-old-space-size=256'],
      env: Object.fromEntries(['PATH','HOME','TMPDIR'].filter(k => process.env[k]).map(k => [k,process.env[k]])),
      stdio: ['ignore','ignore','pipe','ipc'],
    });
    let done = false, totalBytes = 0;
    const finish = extra => {
      if (done) return; done = true;
      clearTimeout(timer); signal?.removeEventListener('abort', cancel);
      Object.assign(result, extra); child.once('close',()=>resolve(result)); child.kill('SIGKILL');
    };
    const cancel = () => finish({ status: 'cancelled' });
    const timer = setTimeout(() => {
      result.errors.push({ message: 'RUN_TIMEOUT: 运行超过最大时长' }); finish({ status:'failed' });
    }, input.options?.runTimeout ?? 120000);
    signal?.addEventListener('abort', cancel, { once:true });
    child.stderr.on('data', () => {}); // Never forward worker diagnostics containing user scripts or credentials.
    child.on('error', error => { result.errors.push({ message: error.message }); finish({status:'failed'}); });
    child.on('exit', code => { if (!done) { result.errors.push({ message: `WORKER_EXIT: 请求进程意外退出 (${code})` }); finish({ status:'failed' }); } });
    child.on('message', message => {
      if (done) return;
      totalBytes += Buffer.byteLength(JSON.stringify(message));
      if (totalBytes > 50 * 1024 * 1024 || result.responses.length + result.logs.length + result.assertions.length > 10000) {
        result.errors.push({message:'RUN_LIMIT: 运行结果超过 50 MB 或 10000 条记录'}); return finish({status:'failed'});
      }
      if (message.type === 'done') return finish(message.value);
      if(message.type==='visualizer'){const response=result.responses.findLast(r=>r.itemId===message.value.itemId);if(response)response.visualizer=message.value.html;}
      if (message.type === 'response') result.responses.push(message.value);
      if (message.type === 'assertion') result.assertions.push(message.value);
      if (message.type === 'log') result.logs.push(message.value);
      if (message.type === 'error') result.errors.push(message.value);
      try { onEvent(message); } catch { /* Progress observers cannot crash the execution worker. */ }
    });
    if (signal?.aborted) cancel();
    else child.send(input);
  });
}
