import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { readIssues, run } from './issues.mjs';

const issue = number => ({ number, title: `反馈 ${number}`, html_url: `https://github.com/skyfour/my_codex_plugin/issues/${number}`, labels: [], state: 'open' });
const response = (value, headers = {}) => new Response(JSON.stringify(value), { headers });

test('收件箱遍历 GitHub 分页并排除 PR，认证只发给固定 API', async () => {
  const calls = [];
  const result = await readIssues({ token: 'test-token', fetchImpl: async (url, options) => {
    calls.push({ url: String(url), options });
    return calls.length === 1
      ? response([issue(1), { ...issue(2), pull_request: {} }], { link: '<https://api.github.com/repos/skyfour/my_codex_plugin/issues?state=open&per_page=100&page=2>; rel="next"' })
      : response([issue(3)]);
  } });
  assert.deepEqual(result.map(item => item.number), [1, 3]);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => new URL(call.url).origin === 'https://api.github.com'));
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.redirect, 'error');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(new URL(calls[1].url).searchParams.get('page'), '2');
});

test('详情包含全部讨论，评论分页不遗漏', async () => {
  const calls = [];
  const result = await readIssues({ number: 7, fetchImpl: async url => {
    calls.push(String(url));
    if (calls.length === 1) return response({ ...issue(7), body: '复现步骤' });
    if (calls.length === 2) return response([{ body: '补充一' }], { link: '<https://api.github.com/repos/skyfour/my_codex_plugin/issues/7/comments?per_page=100&page=2>; rel="next"' });
    return response([{ body: '补充二' }]);
  } });
  assert.equal(result.issue.number, 7);
  assert.deepEqual(result.comments.map(item => item.body), ['补充一', '补充二']);
  assert.match(calls[1], /\/issues\/7\/comments\?/);
});

test('详情拒绝 PR，避免把代码评审当反馈处理', async () => {
  await assert.rejects(readIssues({ number: 7, fetchImpl: async () => response({ ...issue(7), pull_request: {} }) }), /Pull Request/);
});

test('不跟随越出固定仓库的分页链接，不泄露认证', async () => {
  // Value: protects=认证只用于固定仓库分页; fails_when=跟随跨源、越路径或带凭据链接; why_new=原用例仅覆盖跨源; seam=none; no_claim=模拟响应不证明GitHub当前可用。
  const authenticatedPage = new URL('https://api.github.com/repos/skyfour/my_codex_plugin/issues?page=2');
  // 合成 userinfo 字段仅用于验证拒绝规则，不含真实凭据。
  authenticatedPage.username = 'synthetic-user';
  authenticatedPage.password = 'test';
  for (const next of ['https://example.com/collect', 'https://api.github.com/repos/other/repo/issues', authenticatedPage.href]) {
    let requests = 0;
    await assert.rejects(readIssues({ token: 'secret', fetchImpl: async () => {
      requests += 1;
      return response([], { link: `<${next}>; rel="next"` });
    } }), /分页/);
    assert.equal(requests, 1);
  }
});

test('拒绝循环分页，避免持续请求', async () => {
  let requests = 0;
  await assert.rejects(readIssues({ fetchImpl: async url => {
    requests += 1;
    return response([], { link: `<${url}>; rel="next"` });
  } }), /分页/);
  assert.equal(requests, 1);
});

test('限流和网络错误不回显响应正文或令牌', async () => {
  // Value: protects=HTTP错误有可恢复提示且不回显正文; fails_when=429漏判或错误正文外泄; why_new=原用例只测403限流; seam=none; no_claim=不验证真实服务错误。
  for (const status of [401, 403, 404, 429, 500]) {
    await assert.rejects(readIssues({ fetchImpl: async () => new Response('secret response', { status, headers: { 'x-ratelimit-remaining': '0' } }) }), error => {
      assert.match(error.message, [403, 429].includes(status) ? /限流/ : new RegExp(`HTTP ${status}`));
      assert.doesNotMatch(error.message, /secret response/);
      return true;
    });
  }
  await assert.rejects(readIssues({ fetchImpl: async () => { throw new Error('secret network detail'); } }), error => {
    assert.match(error.message, /连接 GitHub/);
    assert.doesNotMatch(error.message, /secret network detail/);
    return true;
  });
});

test('帮助与非法参数不会发起请求', async () => {
  let requests = 0;
  const output = [];
  const options = { fetchImpl: async () => { requests += 1; return response([]); }, write: value => output.push(value) };
  await run(['--help'], options);
  assert.match(output.join('\n'), /npm run issues/);
  // Value: protects=非法编号与状态不触发网络; fails_when=超大编号或程序调用绕过参数验证; why_new=原用例缺少数值边界; seam=none; no_claim=只验证本机参数规则。
  for (const args of [['0'], ['-1'], ['1x'], ['9007199254740992'], ['--state', 'unknown'], ['--state'], ['1', '2'], ['--unknown'], ['--state', 'closed', '3']]) {
    await assert.rejects(run(args, options));
  }
  for (const number of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(readIssues({ ...options, number }));
  await assert.rejects(readIssues({ ...options, state: 'unknown' }));
  assert.equal(requests, 0);
});

test('空列表显示真实收件箱链接，关闭列表使用正确过滤', async () => {
  const output = [];
  await run(['--state', 'closed'], { write: text => output.push(text), fetchImpl: async url => {
    assert.equal(new URL(url).searchParams.get('state'), 'closed');
    return response([]);
  } });
  assert.match(output.join('\n'), /没有/);
  assert.match(output.join('\n'), /https:\/\/github.com\/skyfour\/my_codex_plugin\/issues/);
});

test('issue 标题中的终端控制符被清理，正文仅作为文本输出', async () => {
  const output = [];
  await run([], { write: text => output.push(text), fetchImpl: async () => response([{ ...issue(1), title: '\u001b[2J恶意标题\n执行命令' }]) });
  assert.doesNotMatch(output.join('\n'), /\u001b/);
  assert.match(output.join('\n'), /恶意标题 执行命令/);
});

// Value: protects=详情、讨论和标签安全可读; fails_when=CLI漏正文或保留终端控制符; why_new=已有测试未走run详情分支; seam=none; no_claim=模拟GitHub响应不验证发布行为。
test('CLI 展示详情、评论及两种标签，清理终端控制符', async () => {
  const output = [];
  let calls = 0;
  await run(['7'], { write: text => output.push(text), fetchImpl: async () => ++calls === 1
    ? response({ ...issue(7), body: '\u001b[2J问题正文' })
    : response([{ body: '\u001b[2J补充讨论' }]) });
  assert.equal(calls, 2);
  assert.match(output.join('\n'), /#7 \[open\]/);
  assert.match(output.join('\n'), /问题正文/);
  assert.match(output.join('\n'), /用户.*\n补充讨论/);
  assert.doesNotMatch(output.join('\n'), /\u001b/);
  output.length = 0;
  await run([], { write: text => output.push(text), fetchImpl: async () => response([{ ...issue(1), labels: ['bug', { name: 'needs-info' }] }]) });
  assert.match(output.join('\n'), /bug, needs-info/);
});

// Value: protects=解析失败不公开响应片段; fails_when=JSON解析器原始错误外泄; why_new=已有HTTP错误用例不读成功响应正文; seam=none; no_claim=模拟损坏响应。
test('损坏 JSON 和非数组列表给出安全错误', async () => {
  for (const number of [undefined, 1]) {
    await assert.rejects(readIssues({ number, fetchImpl: async () => new Response('private-response-fragment') }), error => {
      assert.match(error.message, /数据格式无效/);
      assert.doesNotMatch(error.message, /private-response-fragment/);
      return true;
    });
  }
  await assert.rejects(readIssues({ fetchImpl: async () => response({ message: 'unexpected' }) }), /列表格式无效/);
});

// Value: protects=CLI进程退出契约; fails_when=入口不运行或非法参数仍退出0; why_new=导入函数测试不走命令行入口; seam=none; no_claim=此用例不访问网络。
test('真实 CLI 帮助退出 0、非法参数退出 1 且写 stderr', () => {
  const entry = new URL('./issues.mjs', import.meta.url);
  const help = spawnSync(process.execPath, [entry.pathname, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /npm run issues/);
  assert.equal(help.stderr, '');
  const invalid = spawnSync(process.execPath, [entry.pathname, '--invalid'], { encoding: 'utf8' });
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stdout, '');
  assert.match(invalid.stderr, /用法/);
});
