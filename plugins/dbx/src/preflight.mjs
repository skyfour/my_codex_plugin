import { parse } from 'acorn';
import { rewriteScript, CompatibilityError } from './compat.mjs';

const FILE_LIMIT = 2048;
const FILE_BYTES = 32 * 1024 * 1024;
const TOTAL_BYTES = 128 * 1024 * 1024;

async function readBounded(response, limit, label) {
  if (!response.ok) throw new CompatibilityError(`${label} 返回 HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > limit) throw new CompatibilityError(`${label} 超过兼容预检大小上限`);
  if (!response.body) throw new CompatibilityError(`${label} 返回空响应`);
  const reader = response.body.getReader(), chunks = [];
  let size = 0, finished = false;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) { finished = true; break; }
      size += next.value.byteLength;
      if (size > limit) throw new CompatibilityError(`${label} 超过兼容预检大小上限`);
      chunks.push(next.value);
    }
  } finally {
    if (!finished) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return { text: Buffer.concat(chunks).toString('utf8'), size };
}

function each(node, visit, parent) {
  if (!node || typeof node !== 'object' || !node.type) return;
  visit(node, parent);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) for (const child of value) each(child, visit, node);
    else if (value && typeof value === 'object') each(value, visit, node);
  }
}

function staticString(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && !node.expressions.length) return node.quasis[0].value.cooked;
}

/** Check every official same-origin asset, including Vite's lazy dependency
 * arrays, before a new image is accepted. No official image files are changed.
 */
export async function verifyOfficialWeb({ baseUrl, version, fetchImpl = fetch }) {
  const base = new URL(baseUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new CompatibilityError('官方 Web 地址无效');
  const origin = base.origin;
  const pending = [], queued = new Set(), files = [];
  let totalBytes = 0, dialogCalls = 0, asyncCallbacks = 0;
  function enqueue(value, parentUrl, required = false) {
    if (typeof value !== 'string') return;
    if (!/\.(?:m?js)(?:\?[^#]*)?$/.test(value)) return;
    // Package names and prose are not asset references. Absolute asset names,
    // Vite mapDeps entries and relative chunk imports are supported.
    if (!required && !/^(?:\/assets\/|assets\/)/.test(value)) return;
    const url = new URL(value, parentUrl);
    if (url.origin !== origin || !url.pathname.startsWith('/assets/') || url.username || url.password || url.hash) {
      if (required || value.startsWith('/') || value.startsWith('./') || value.startsWith('../')) throw new CompatibilityError(`脚本引用不在官方 /assets/ 范围：${value}`);
      return;
    }
    url.hash = '';
    if (queued.has(url.href)) return;
    if (queued.size >= FILE_LIMIT) throw new CompatibilityError('官方脚本数量超过兼容预检上限');
    queued.add(url.href); pending.push(url);
  }
  async function read(url, limit) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetchImpl(url.href, { signal: controller.signal, redirect: 'error', headers: { 'accept-encoding': 'identity' } });
      return await readBounded(response, limit, url.pathname);
    } finally { clearTimeout(timer); }
  }
  const html = await read(base, 2 * 1024 * 1024);
  totalBytes += html.size;
  for (const match of html.text.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const tag = match[0];
    if (match[1].toLowerCase() === 'link' && !/\brel\s*=\s*["'](?:modulepreload|preload)["']/i.test(tag)) continue;
    const attribute = tag.match(/\b(?:src|href)\s*=\s*["']([^"']+)["']/i)?.[1];
    if (attribute) enqueue(attribute.replaceAll('&amp;', '&'), base, true);
  }
  if (!pending.length) throw new CompatibilityError('官方 Web 页面没有可验收的入口脚本');
  while (pending.length) {
    const url = pending.shift();
    const source = await read(url, Math.min(FILE_BYTES, TOTAL_BYTES - totalBytes));
    totalBytes += source.size;
    const rewritten = rewriteScript(source.text, { version, filename: url.pathname });
    dialogCalls += rewritten.changes; asyncCallbacks += rewritten.asyncCallbacks;
    const ast = parse(source.text, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
    each(ast, (node, parent) => {
      if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.type) && staticString(node.source) !== undefined) {
        enqueue(staticString(node.source), url, true);
      } else if (node.type === 'NewExpression' && node.callee.type === 'Identifier' && node.callee.name === 'URL' && staticString(node.arguments[0]) !== undefined && node.arguments[1]?.type === 'MemberExpression' && node.arguments[1].object.type === 'MetaProperty') {
        enqueue(staticString(node.arguments[0]), url, true);
      } else if (staticString(node) !== undefined) {
        const value = staticString(node);
        // Vite dependency maps use assets/foo.js relative to the root, while
        // Rolldown maps use ./foo.js relative to the current chunk. Restrict
        // relative string collection to arrays, not arbitrary prose/examples.
        enqueue(value, value.startsWith('assets/') ? base : url, parent?.type === 'ArrayExpression' && value.startsWith('./'));
      }
    });
    files.push({ path: url.pathname, bytes: source.size, dialogCalls: rewritten.changes });
  }
  return { version, files, fileCount: files.length, totalBytes, dialogCalls, asyncCallbacks };
}
