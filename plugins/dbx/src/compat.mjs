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

function eventHandlerReference(node, parent) {
  if (parent?.type !== 'Property' || parent.value !== node || parent.computed || parent.method) return false;
  const key = parent.key.name ?? parent.key.value;
  return key === 'action' || /^on[A-Z]/.test(key);
}

function ignoredCallResult(call, ancestry) {
  let child = call;
  for (let i = ancestry.length - 2; i >= 0; i--) {
    const parent = ancestry[i];
    if (parent.type === 'ExpressionStatement' || parent.type === 'AwaitExpression' || (parent.type === 'UnaryExpression' && parent.operator === 'void')) return true;
    if ((parent.type === 'LogicalExpression' && parent.right === child) || (parent.type === 'ConditionalExpression' && parent.test !== child)) { child = parent; continue; }
    if (parent.type === 'SequenceExpression') { if (parent.expressions.at(-1) !== child) return true; child = parent; continue; }
    if (parent.type === 'ArrowFunctionExpression' && parent.body === child) return eventHandlerReference(parent, ancestry[i - 1]);
    return false;
  }
  return false;
}

function safeAsyncCaller(caller, ancestry, scope) {
  const owner = ancestry[ancestry.indexOf(caller) - 1];
  if (caller.type === 'ArrowFunctionExpression') return owner?.type === 'CallExpression' && owner.callee.type === 'Identifier' && owner.arguments.length === 2 && owner.arguments[0].type === 'Identifier' && owner.arguments[1] === caller && caller.params.length === 2 && caller.params.every(node => node.type === 'Identifier');
  if (caller.type !== 'FunctionDeclaration' || !caller.id) return false;
  let valid = true;
  visit(scope, [], (node, parents) => {
    if (node.type !== 'Identifier' || node.name !== caller.id.name || node === caller.id) return;
    const parent = parents.at(-1);
    if (eventHandlerReference(node, parent)) return;
    if (parent?.type !== 'CallExpression' || parent.callee !== node || !ignoredCallResult(parent, parents)) valid = false;
  });
  return valid;
}

function discardHelperCallers(call, fn, parents) {
  const key = translationKey(call);
  if (!['oracleTrigger.discardSourceConfirm', 'objects.refreshDiscardConfirm'].includes(key) || fn.type !== 'FunctionDeclaration' || !fn.id || fn.params.length || fn.generator || fn.body.body.length !== 1 || fn.body.body[0].type !== 'ReturnStatement') return;
  const branches = [];
  const flatten = node => { if (node?.type === 'LogicalExpression' && node.operator === '||') { flatten(node.left); flatten(node.right); } else branches.push(node); };
  flatten(fn.body.body[0].argument);
  const value = node => node?.type === 'MemberExpression' && !node.computed && node.object.type === 'Identifier' && node.property.name === 'value';
  const clean = node => node?.type === 'UnaryExpression' && node.operator === '!' && value(node.argument);
  const oracle = key === 'oracleTrigger.discardSourceConfirm' && branches.length === 5 && branches[4] === call && branches.slice(0, 3).every(clean) && branches[3]?.type === 'BinaryExpression' && branches[3].operator === '===' && value(branches[3].left) && value(branches[3].right);
  const schemaDiff = key === 'objects.refreshDiscardConfirm' && branches.length === 2 && clean(branches[0]) && branches[1] === call;
  if (!oracle && !schemaDiff) return;
  const scope = parents[parents.indexOf(fn) - 1], callers = [], checked = new Set();
  let valid = true;
  visit(scope, [], (node, ancestry) => {
    if (node.type !== 'Identifier' || node.name !== fn.id.name || node === fn.id) return;
    const use = ancestry.at(-1), caller = [...ancestry].reverse().find(parent => functions.has(parent.type));
    if (use?.type !== 'CallExpression' || use.callee !== node || use.optional || use.arguments.length || !caller || caller === fn || caller.generator) { valid = false; return; }
    const owner = ancestry[ancestry.indexOf(caller) - 1];
    if (!caller.async && (caller.body.type !== 'BlockStatement' || owner?.type === 'MethodDefinition' || (owner?.type === 'Property' && owner.method))) { valid = false; return; }
    if (!caller.async) visit(caller.body, [], (statement, enclosing) => {
      if (!enclosing.some(parent => functions.has(parent.type)) && statement.type === 'ReturnStatement' && statement.argument) valid = false;
    });
    if (!caller.async && !checked.has(caller)) { checked.add(caller); if (!safeAsyncCaller(caller, ancestry, scope)) valid = false; }
    callers.push({ call: use, caller, awaited: ancestry.at(-2)?.type === 'AwaitExpression' });
  });
  // The reviewed v0.6.55 helpers have only direct local callers. An escaped
  // reference or a changed boolean contract requires another source review.
  return valid && callers.length ? callers : undefined;
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
      const discardCallers = kind === 'confirm' && discardHelperCallers(node, fn, parents);
      if (discardCallers) {
        for (const { call, caller, awaited } of discardCallers) {
          if (!caller.async) asyncFunctions.add(caller.start);
          if (!awaited) { edits.push({ start: call.start, end: call.start, text: '(await ' }); edits.push({ start: call.end, end: call.end, text: ')' }); }
        }
      } else if (!eventHandlerAllowed(node, fn, source)) throw new CompatibilityError(`${filename} ${version ?? '未知版本'} 同步 ${kind} 的返回值或调用方式需要人工适配`);
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
