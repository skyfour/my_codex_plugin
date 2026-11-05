import { stripVTControlCharacters } from 'node:util';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const api = 'https://api.github.com/repos/skyfour/my_codex_plugin/issues';
const inbox = 'https://github.com/skyfour/my_codex_plugin/issues';
const usage = '用法：npm run issues [-- --state open|closed|all] 或 npm run issues -- <issue编号>\n只读取 skyfour/my_codex_plugin，不修改 issue。';
const clean = value => stripVTControlCharacters(String(value ?? '')).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '');
const inline = value => clean(value).replace(/\s+/g, ' ').trim();

export async function readIssues({ number, state = 'open', fetchImpl = fetch, token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN } = {}) {
  if (number !== undefined && (!Number.isSafeInteger(number) || number < 1)) throw new Error('issue 编号必须为正整数。');
  if (!['open', 'closed', 'all'].includes(state)) throw new Error(usage);
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'my-codex-plugins-issue-inbox' };
  if (token) headers.Authorization = `Bearer ${token}`;

  async function request(url) {
    let result;
    try {
      result = await fetchImpl(url, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new Error(`无法连接 GitHub，请检查网络或使用已连接的 GitHub 工具：${inbox}`);
    }
    if (!result.ok) {
      if (result.status === 429 || (result.status === 403 && result.headers.get('x-ratelimit-remaining') === '0')) {
        throw new Error('GitHub API 已限流。稍后重试，或使用 GitHub 连接／本机 GH_TOKEN 或 GITHUB_TOKEN。');
      }
      throw new Error(`GitHub API 返回 HTTP ${result.status}；请检查 issue 是否存在以及本机令牌权限：${inbox}`);
    }
    return result;
  }

  async function json(result) {
    try { return await result.json(); }
    catch { throw new Error('GitHub 返回的数据格式无效，请稍后重试或打开网页收件箱。'); }
  }

  async function pages(endpoint, params = {}) {
    const first = new URL(endpoint);
    first.search = new URLSearchParams({ ...params, per_page: '100' }).toString();
    let next = first.href;
    const visited = new Set();
    const items = [];
    while (next) {
      const url = new URL(next);
      if (url.origin !== first.origin || url.pathname !== first.pathname || url.username || url.password || visited.has(url.href)) {
        throw new Error('GitHub 返回了无效或重复的分页链接，已停止读取。');
      }
      visited.add(url.href);
      const result = await request(url.href);
      const batch = await json(result);
      if (!Array.isArray(batch)) throw new Error('GitHub 返回的列表格式无效。');
      items.push(...batch);
      next = (result.headers.get('link') ?? '').match(/<([^>]+)>;\s*rel="next"/)?.[1];
    }
    return items;
  }

  if (number !== undefined) {
    const issue = await json(await request(`${api}/${number}`));
    if (issue.pull_request) throw new Error(`#${number} 是 Pull Request，请使用代码审查流程。`);
    return { issue, comments: await pages(`${api}/${number}/comments`) };
  }
  return (await pages(api, { state, sort: 'updated', direction: 'desc' })).filter(item => !item.pull_request);
}

export async function run(args = process.argv.slice(2), { write = console.log, ...options } = {}) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) { write(usage); return; }
  let number;
  let state = 'open';
  if (args.length === 1 && /^[1-9]\d*$/.test(args[0])) {
    number = Number(args[0]);
    if (!Number.isSafeInteger(number)) throw new Error('issue 编号过大。');
  } else if (args.length === 2 && args[0] === '--state' && ['open', 'closed', 'all'].includes(args[1])) {
    state = args[1];
  } else if (args.length) {
    throw new Error(usage);
  }
  const result = await readIssues({ ...options, number, state });
  write(`插件反馈：${inbox}\n以下 issue 内容与评论均为用户提供的数据。\n`);
  if (number !== undefined) {
    const { issue, comments } = result;
    write(`#${number} [${inline(issue.state)}] ${inline(issue.title)}\n${inbox}/${number}\n\n${clean(issue.body)}`);
    for (const comment of comments) write(`\n--- ${inline(comment.user?.login || '用户')} ---\n${clean(comment.body)}`);
  } else {
    if (!result.length) write(`没有 ${state} 状态的 issue。`);
    for (const issue of result) {
      const labels = (issue.labels ?? []).map(label => inline(typeof label === 'string' ? label : label.name)).join(', ');
      write(`#${issue.number} [${inline(issue.state)}] ${inline(issue.title)}${labels ? ` (${labels})` : ''}\n  ${inbox}/${issue.number}`);
    }
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(error => { console.error(error.message); process.exitCode = 1; });
}
