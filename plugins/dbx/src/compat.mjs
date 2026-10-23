import { parse } from 'acorn';
import { readFileSync } from 'node:fs';

export const compatScript = readFileSync(new URL('../ui/compat.js', import.meta.url), 'utf8');

// These synchronous callbacks were checked against the official v0.6.52 source.
// Their callers consume side effects, never a boolean/string return value.
const eventDialogKeys = new Set([
  'settings.mcpDatabaseScopeClearsPermissionExceptions',
  'settings.mcpResourceScopeAllConfirm',
  'objects.refreshDiscardConfirm',
  'objectDependencies.navigateDiscardConfirm',
  'diff.saveConfigPrompt',
  'settings.sqlShortcutsDeleteConfirm',
  'settings.mcpExecutionModeHighRiskConfirm',
  'settings.mcpGroupPolicyHighRiskConfirm',
  'settings.mcpDatabasePolicyHighRiskConfirm',
]);
const functions = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

export class CompatibilityError extends Error {
  constructor(message) { super(`DBX 嵌入兼容检查失败：${message}`); this.name = 'CompatibilityError'; }
}

function visit(node, parents, callback) {
  if (!node || typeof node !== 'object' || !node.type) return;
  callback(node, parents);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) for (const child of value) visit(child, [...parents, node], callback);
    else if (value && typeof value === 'object') visit(value, [...parents, node], callback);
  }
}

function nativeDialog(node) {
  const callee = node.callee;
  if (node.type !== 'CallExpression' || callee?.type !== 'MemberExpression') return;
  const object = callee.object;
  const property = callee.computed ? callee.property.value : callee.property.name;
  if (object?.type === 'Identifier' && ['window', 'globalThis'].includes(object.name) && ['confirm', 'prompt', 'alert'].includes(property)) return property;
}

function translationKey(call) {
  const message = call.arguments[0];
  if (message?.type !== 'CallExpression') return;
  const key = message.arguments[0];
  return key?.type === 'Literal' ? key.value : key?.type === 'TemplateLiteral' && !key.expressions.length ? key.quasis[0].value.cooked : undefined;
}

function eventHandlerAllowed(call, fn, source) {
  // A return-valued helper must keep its synchronous contract. The one known
  // boolean refresh helper has its own deferred-confirm branch below.
  let returnsValue = false;
  visit(fn.body, [], (node, parents) => {
    if (parents.some(parent => functions.has(parent.type))) return;
    if (node.type === 'ReturnStatement' && node.argument) returnsValue = true;
  });
  if (returnsValue) return false;
  const key = translationKey(call);
  if (eventDialogKeys.has(key)) return true;
  const message = call.arguments[0];
  return message?.type === 'TemplateLiteral' && message.quasis[0]?.value.cooked === 'Delete snippet "' && message.quasis.at(-1)?.value.cooked === '"?';
}

function deferredRefresh(call, parents, source) {
  let suffix = 0;
  while (source.includes(`__dbxCompatTarget${suffix}`) || source.includes(`__dbxCompatArgs${suffix}`)) suffix++;
  const targetName = `__dbxCompatTarget${suffix}`, argsName = `__dbxCompatArgs${suffix}`;
  const deferred = (test, operation, args) => {
    const receiver = source.slice(operation.callee.object.start, operation.callee.object.end);
    const parameters = operation.arguments.map(argument => source.slice(argument.start, argument.end)).join(',');
    // Capture the tab id before yielding; a background refresh must not switch
    // the target of the user's pending approval to another editor tab.
    return `(${test} ? (() => { const ${targetName} = ${receiver}, ${argsName} = [${parameters}]; void globalThis.__dbxCompat.confirm(${args}).then(confirmed => { if (confirmed) ${targetName}.refreshObjectSourceTab(...${argsName}); }); return true; })() : ${source.slice(operation.start, operation.end)})`;
  };
  // Vite/esbuild folds the same source branch into a conditional expression.
  // Keep that helper's synchronous handled/not-handled boolean intact.
  const conditional = [...parents].reverse().find(node => node.type === 'ConditionalExpression');
  if (conditional && translationKey(call) === 'objects.refreshDiscardConfirm') {
    const condition = conditional.test;
    const result = conditional.consequent;
    const operation = conditional.alternate;
    const falseResult = (result.type === 'Literal' && result.value === false) || (result.type === 'UnaryExpression' && result.operator === '!' && result.argument.type === 'Literal' && result.argument.value === 1);
    if (condition.type === 'LogicalExpression' && condition.operator === '&&' && condition.right.type === 'UnaryExpression' && condition.right.operator === '!' && condition.right.argument === call && falseResult && operation?.type === 'CallExpression' && operation.callee.type === 'MemberExpression' && operation.callee.property.name === 'refreshObjectSourceTab') {
      const test = source.slice(condition.left.start, condition.left.end);
      const args = source.slice(call.arguments[0].start, call.arguments.at(-1).end);
      return { start: conditional.start, end: conditional.end, text: deferred(test, operation, args) };
    }
  }
  const statement = [...parents].reverse().find(node => node.type === 'IfStatement');
  const block = statement && parents[parents.indexOf(statement) - 1];
  if (translationKey(call) !== 'objects.refreshDiscardConfirm' || block?.type !== 'BlockStatement') return;
  const condition = statement.test;
  const result = statement.consequent;
  if (condition.type !== 'LogicalExpression' || condition.operator !== '&&' || condition.right.type !== 'UnaryExpression' || condition.right.operator !== '!' || condition.right.argument !== call || result.type !== 'ReturnStatement' || result.argument?.value !== false) return;
  const next = block.body[block.body.indexOf(statement) + 1];
  const operation = next?.type === 'ReturnStatement' && next.argument;
  if (operation?.type !== 'CallExpression' || operation.callee.type !== 'MemberExpression' || operation.callee.property.name !== 'refreshObjectSourceTab') return;
  const test = source.slice(condition.left.start, condition.left.end);
  const args = source.slice(call.arguments[0].start, call.arguments.at(-1).end);
  return { start: statement.start, end: next.end, text: `return ${deferred(test, operation, args)};` };
}

/** Rewrite actual parsed native-dialog callsites, never strings or regex matches.
 * Unknown synchronous control flow stops loading instead of accepting a Promise
 * as a boolean or bypassing a destructive confirmation. The official image stays
 * untouched; only the locally proxied JavaScript response is adapted.
 */
export function rewriteScript(source, { version, filename = '' } = {}) {
  let ast;
  try { ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }); }
  catch (error) { throw new CompatibilityError(`无法解析官方脚本 ${filename}：${error.message}`); }
  const dialogs = [], edits = [], asyncFunctions = new Set();
  visit(ast, [], (node, parents) => {
    const kind = nativeDialog(node);
    if (!kind) return;
    const fn = [...parents].reverse().find(parent => functions.has(parent.type));
    if (!fn) throw new CompatibilityError(`${filename} 顶层 ${kind} 需要新的兼容适配`);
    const key = translationKey(node);
    dialogs.push({ kind, key: key ?? null, synchronous: !fn.async });
    if (!fn.async) {
      const refresh = deferredRefresh(node, parents, source);
      if (refresh) { edits.push(refresh); return; }
      if (!eventHandlerAllowed(node, fn, source)) throw new CompatibilityError(`${filename} ${version ?? '未知版本'} 同步 ${kind} 的返回值或调用方式需要人工适配`);
      // Object/class shorthand methods cannot be prefixed without accounting
      // for their key syntax. Current official callbacks use plain functions.
      if (parents.some(parent => (parent.type === 'MethodDefinition' || (parent.type === 'Property' && parent.method)) && parent.value === fn)) throw new CompatibilityError(`${filename} 同步方法 ${kind} 需要新的兼容适配`);
      asyncFunctions.add(fn.start);
    }
    edits.push({ start: node.callee.start, end: node.callee.end, text: `globalThis.__dbxCompat.${kind}` });
    if (parents.at(-1)?.type !== 'AwaitExpression') {
      edits.push({ start: node.start, end: node.start, text: '(await ' });
      edits.push({ start: node.end, end: node.end, text: ')' });
    }
  });
  for (const start of asyncFunctions) edits.push({ start, end: start, text: 'async ' });
  // At the same offset, replacing a callee must happen before inserting await.
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let result = source;
  for (const edit of edits) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  try { parse(result, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }); }
  catch (error) { throw new CompatibilityError(`改写后脚本无效 ${filename}：${error.message}`); }
  return { source: result, dialogs, changes: dialogs.length, asyncCallbacks: asyncFunctions.size };
}
