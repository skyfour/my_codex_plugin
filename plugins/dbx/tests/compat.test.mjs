import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { rewriteScript as rewrite, compatScript, CompatibilityError } from '../src/compat.mjs';
import { verifyOfficialWeb } from '../src/preflight.mjs';
const rewriteScript = (source, options = {}) => rewrite(source, { version: '0.6.52', ...options });

test('async confirmations wait for a real decision and preserve cancellation', async () => {
  const source = 'async function remove(){if(!window.confirm("Delete?"))return; writes++;} globalThis.remove=remove;';
  const adapted = rewriteScript(source);
  assert.equal(adapted.changes, 1);
  let answer;
  const scope = { writes: 0, __dbxCompat: { confirm: () => new Promise(resolve => { answer = resolve; }) } };
  vm.runInNewContext(adapted.source, scope);
  const first = scope.remove();
  assert.equal(scope.writes, 0);
  answer(false); await first;
  assert.equal(scope.writes, 0);
  const second = scope.remove(); answer(true); await second;
  assert.equal(scope.writes, 1);
});

test('known event callbacks become async and prompt cancellation remains null', async () => {
  const source = 'function save(){const name=window.prompt(t("diff.saveConfigPrompt"),"initial");if(name===null)return;writes.push(name)}globalThis.save=save;';
  const adapted = rewriteScript(source);
  assert.equal(adapted.asyncCallbacks, 1);
  const scope = { writes: [], t: x => x, __dbxCompat: { prompt: async () => null } };
  vm.runInNewContext(adapted.source, scope);
  await scope.save();
  assert.deepEqual(scope.writes, []);
  scope.__dbxCompat.prompt = async () => 'accepted';
  await scope.save();
  assert.deepEqual(scope.writes, ['accepted']);
});

test('boolean refresh contract is preserved while the dirty refresh waits for consent', async () => {
  const source = 'function refresh(){if(dirty&&!window.confirm(t("objects.refreshDiscardConfirm")))return false;return store.refreshObjectSourceTab(id)}globalThis.refresh=refresh;';
  const adapted = rewriteScript(source);
  let answer;
  const scope = { dirty: true, id: 'tab', calls: 0, t: x => x, __dbxCompat: { confirm: () => new Promise(resolve => { answer = resolve; }) } };
  scope.store = { refreshObjectSourceTab: () => { scope.calls++; return true; } };
  vm.runInNewContext(adapted.source, scope);
  assert.equal(scope.refresh(), true);
  assert.equal(scope.calls, 0);
  answer(false); await Promise.resolve();
  assert.equal(scope.calls, 0);
  assert.equal(scope.refresh(), true); answer(true); await Promise.resolve();
  assert.equal(scope.calls, 1);
  scope.dirty = false;
  assert.equal(scope.refresh(), true);
  assert.equal(scope.calls, 2);
});

test('unknown synchronous helper contracts fail closed, including on new official releases', () => {
  assert.throws(() => rewriteScript('function allow(){return window.confirm("write?")}'), CompatibilityError);
  assert.throws(() => rewriteScript('const permitted=window.confirm("write?")'), CompatibilityError);
  assert.throws(() => rewriteScript('function changed(){window.confirm(t("new.behavior"))}'), CompatibilityError);
  assert.throws(() => rewriteScript('function changed(){return window.confirm(t("diff.saveConfigPrompt"))}', { version: '0.6.53' }), CompatibilityError);
  assert.equal(rewriteScript('function changed(){window.confirm(t("diff.saveConfigPrompt"))}', { version: '0.6.53' }).changes, 1);
  assert.equal(rewriteScript('function changed(){window.confirm(t(`diff.saveConfigPrompt`))}', { version: '0.6.53' }).changes, 1);
  assert.equal(rewrite('function changed(){window.confirm(t("diff.saveConfigPrompt"))}').changes, 1);
});

test('minified boolean refresh branch retains its boolean contract', async () => {
  const adapted = rewriteScript('function r(){return dirty&&!window.confirm(t("objects.refreshDiscardConfirm"))?!1:s.refreshObjectSourceTab(id)}globalThis.r=r;');
  let answer;
  const scope = { dirty: true, id: 'tab', calls: 0, t: x => x, __dbxCompat: { confirm: () => new Promise(resolve => { answer = resolve; }) } };
  scope.s = { refreshObjectSourceTab: () => { scope.calls++; return true; } };
  vm.runInNewContext(adapted.source, scope);
  assert.equal(scope.r(), true); assert.equal(scope.calls, 0);
  answer(true); await Promise.resolve(); assert.equal(scope.calls, 1);
});

test('deferred refresh keeps the originally approved tab across background state changes', async () => {
  const adapted = rewriteScript('function r(){return dirty&&!window.confirm(t("objects.refreshDiscardConfirm"))?!1:target.refreshObjectSourceTab(active.id)}globalThis.r=r;');
  let answer;
  const ids = [];
  const scope = { dirty: true, active: { id: 'original' }, t: x => x, __dbxCompat: { confirm: () => new Promise(resolve => { answer = resolve; }) }, target: { refreshObjectSourceTab: id => ids.push(id) } };
  vm.runInNewContext(adapted.source, scope);
  assert.equal(scope.r(), true); scope.active.id = 'other'; answer(true); await Promise.resolve();
  assert.deepEqual(ids, ['original']);
});

test('strings, comments, unrelated methods and existing awaits keep their semantics', () => {
  const source = 'const s="window.confirm(unsafe)";/*window.prompt("x")*/const obj={confirm(){return true}};async function run(){return await window["confirm"]("x")}';
  const adapted = rewriteScript(source);
  assert.equal(adapted.changes, 1);
  assert.match(adapted.source, /return await globalThis\.__dbxCompat\.confirm\("x"\)/);
  assert.match(adapted.source, /const s="window.confirm\(unsafe\)"/);
  assert.match(adapted.source, /obj=\{confirm\(\)/);
});

test('nested synchronous functions cannot inherit permission from an outer async function', () => {
  assert.throws(() => rewriteScript('async function outside(){function inside(){return window.confirm("write?")}return inside()}'), CompatibilityError);
});

test('malformed JavaScript is rejected without a partial response', () => {
  assert.throws(() => rewriteScript('async function(){'), CompatibilityError);
});

function browserHarness() {
  const listeners = new Map(), messages = [], elements = [], timers = new Map();
  let timerId = 0;
  const listen = (name, handler) => {
    if (!listeners.has(name)) {
      const dispatch = event => { for (const callback of [...dispatch.callbacks]) callback(event); };
      dispatch.callbacks = new Set(); listeners.set(name, dispatch);
    }
    listeners.get(name).callbacks.add(handler);
  };
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.events = new Map(); this.attributes = new Map(); this.style = {}; this.value = ''; }
    append(...children) { this.children.push(...children); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    addEventListener(name, handler) { this.events.set(name, handler); }
    remove() { this.removed = true; }
    focus() { document.activeElement = this; }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    hasAttribute(name) { return this.attributes.has(name); }
    click() { this.events.get('click')?.({ target: this }); }
  }
  const document = {
    activeElement: null, body: new Element('body'),
    createElement(tag) { const element = new Element(tag); elements.push(element); return element; },
    addEventListener: listen,
    removeEventListener(name, handler) { listeners.get(name)?.callbacks.delete(handler); },
  };
  const parent = { postMessage: message => messages.push(message) };
  class FormElement extends Element {
    constructor() { super('FORM'); this.elements = []; this.reportValidity = () => true; }
    dispatchEvent(event) { this.events.get(event.type)?.(event); return !event.defaultPrevented; }
  }
  const scope = { document, navigator: { clipboard: {} }, parent, HTMLAnchorElement: class extends Element {}, HTMLFormElement: FormElement, SubmitEvent: class extends Event { constructor(type, options) { super(type, options); this.submitter = options.submitter; } }, DOMException, queueMicrotask, URL, location: { href: 'http://127.0.0.1:4567/session/', origin: 'http://127.0.0.1:4567' }, btoa: value => Buffer.from(value, 'binary').toString('base64'), setTimeout(callback) { timers.set(++timerId, callback); return timerId; }, clearTimeout(id) { timers.delete(id); }, addEventListener: listen };
  scope.window = scope;
  vm.runInNewContext(compatScript, scope);
  return { scope, document, parent, listeners, messages, elements, timers, reply(message) { listeners.get('message')({ source: parent, data: { type: 'dbx-compat-result', id: messages.at(-1).id, ...message } }); } };
}

test('DOM confirmation waits for explicit choice, defaults focus to cancel and handles Escape', async () => {
  const h = browserHarness();
  const pending = h.scope.__dbxCompat.confirm('Delete database?');
  await Promise.resolve();
  assert.equal(h.document.activeElement.textContent, '取消');
  h.listeners.get('keydown')({ key: 'Escape', preventDefault() {}, stopImmediatePropagation() {} });
  assert.equal(await pending, false);
  const next = h.scope.__dbxCompat.confirm('Delete database?'); await Promise.resolve();
  h.elements.filter(element => element.textContent === '确定').at(-1).click();
  assert.equal(await next, true);
});

test('DOM prompt preserves edited value and cancellation; dialogs are serialized', async () => {
  const h = browserHarness();
  const first = h.scope.__dbxCompat.prompt('Name', 'old');
  const second = h.scope.__dbxCompat.confirm('Second');
  await Promise.resolve();
  assert.equal(h.elements.filter(element => element.tagName === 'input').length, 1);
  h.document.activeElement.value = 'new';
  h.elements.find(element => element.textContent === '确定').click();
  assert.equal(await first, 'new'); await Promise.resolve();
  h.elements.filter(element => element.textContent === '取消').at(-1).click();
  assert.equal(await second, false);
});

test('clipboard only succeeds after the matching parent response and rejects failures', async () => {
  const h = browserHarness();
  let completed = false;
  const first = h.scope.navigator.clipboard.writeText('exact\nvalue').then(() => { completed = true; });
  assert.equal(h.messages[0].action, 'clipboard-write');
  assert.equal(h.messages[0].payload.text, 'exact\nvalue');
  h.listeners.get('message')({ source: {}, data: { type: 'dbx-compat-result', id: h.messages[0].id, result: {} } });
  await Promise.resolve(); assert.equal(completed, false);
  h.reply({ result: {} }); await first; assert.equal(completed, true);
  const failed = h.scope.navigator.clipboard.writeText('next'); h.reply({ error: 'denied' });
  await assert.rejects(failed, /denied/);
});

test('external links use the parent bridge and unsafe protocols are rejected', () => {
  const h = browserHarness();
  assert.equal(h.scope.open('https://example.com/docs'), null);
  assert.equal(h.messages[0].action, 'open-link');
  assert.equal(h.messages[0].payload.url, 'https://example.com/docs');
  h.scope.open('javascript:alert(1)');
  assert.equal(h.messages.length, 1);
  h.reply({ result: {} });
});

async function until(check) {
  for (let n = 0; n < 40; n++) { if (check()) return; await Promise.resolve(); }
  assert.fail('expected async compatibility message');
}

test('bare official API download anchors stream bounded binary chunks and report the saved path', async () => {
  const h = browserHarness();
  const bytes = new Uint8Array(65540); bytes[65539] = 255;
  let reads = 0, released = false;
  h.scope.fetch = async url => ({ ok: true, headers: new Headers({ 'content-disposition': "attachment; filename*=UTF-8''query%20data.csv", 'content-type': 'text/csv' }), body: { getReader: () => ({ read: async () => ++reads === 1 ? { value: bytes, done: false } : { done: true }, releaseLock() { released = true; } }) } });
  const anchor = new h.scope.HTMLAnchorElement('a');
  anchor.href = 'http://127.0.0.1:4567/session/api/export/database/download/example';
  anchor.setAttribute('href', anchor.href); anchor.click();
  await until(() => h.messages.length === 1);
  assert.equal(h.messages[0].action, 'download-open');
  assert.equal(h.messages[0].payload.name, 'query data.csv');
  h.reply({ result: { id: 'file' } });
  await until(() => h.messages.length === 2);
  assert.equal(h.messages[1].action, 'download-write');
  assert.equal(Buffer.from(h.messages[1].payload.data, 'base64').length, 65536);
  h.reply({ result: {} });
  await until(() => h.messages.length === 3);
  assert.equal(Buffer.from(h.messages[2].payload.data, 'base64').length, 4);
  assert.equal(Buffer.from(h.messages[2].payload.data, 'base64')[3], 255);
  h.reply({ result: {} });
  await until(() => h.messages.length === 4);
  assert.equal(h.messages[3].action, 'download-close');
  h.reply({ result: { path: '/controlled/exports/query data.csv' } });
  await until(() => released);
  assert(h.elements.some(element => element.textContent === '已保存：/controlled/exports/query data.csv'));
});

test('failed download writes cancel the stream and never report a success', async () => {
  const h = browserHarness();
  let cancelled = false;
  h.scope.fetch = async () => ({ ok: true, headers: new Headers(), body: { getReader: () => ({ read: async () => ({ done: false, value: new Uint8Array([1]) }), cancel: async () => { cancelled = true; }, releaseLock() {} }) } });
  const anchor = new h.scope.HTMLAnchorElement('a');
  anchor.href = 'blob:http://127.0.0.1:4567/example'; anchor.download = 'example.bin'; anchor.setAttribute('href', anchor.href); anchor.click();
  await until(() => h.messages.length === 1); h.reply({ result: { id: 'file' } });
  await until(() => h.messages.length === 2); h.reply({ error: 'disk full' });
  await until(() => h.messages.length === 3);
  assert.equal(h.messages[2].action, 'download-cancel'); h.reply({ result: {} });
  await until(() => h.elements.some(element => element.textContent === '导出失败：disk full'));
  assert.equal(cancelled, true);
  assert(!h.elements.some(element => element.textContent?.startsWith('已保存：')));
});

test('official asset preflight visits entry, modulepreload and lazy Vite maps once', async () => {
  const responses = new Map([
    ['/', '<script type="module" src="/assets/main.js"></script><link rel="modulepreload" href="/assets/vendor.js">'],
    ['/assets/main.js', 'import "./vendor.js";const deps=["./lazy.js"];const load=()=>import(`./lazy.js`);async function approve(){return window.confirm("Delete?")}'],
    ['/assets/vendor.js', 'export const vendor=true;'],
    ['/assets/lazy.js', 'function save(){window.prompt(t("diff.saveConfigPrompt"))}'],
  ]), requests = [];
  const result = await verifyOfficialWeb({ baseUrl: 'http://127.0.0.1:4224/', version: '0.6.53', fetchImpl: async url => {
    const path = new URL(url).pathname; requests.push(path);
    return new Response(responses.get(path) ?? 'missing', { status: responses.has(path) ? 200 : 404 });
  } });
  assert.equal(result.fileCount, 3); assert.equal(result.dialogCalls, 2); assert.equal(result.asyncCallbacks, 1);
  assert.equal(requests.length, 4); assert.equal(new Set(requests).size, 4);
});

function formFixture(h) {
  const form = new h.scope.HTMLFormElement();
  const button = { type: 'submit', form, disabled: false };
  const input = { tagName: 'INPUT', type: 'password', form, closest: () => null };
  form.elements.push(input, button);
  return { form, button, input, click: { target: { closest: selector => selector === 'button, input' ? button : null }, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } } };
}

test('sandbox submit click dispatches one cancelable Vue-style submit with the correct submitter', async () => {
  const h = browserHarness(), fixture = formFixture(h);
  let submits = 0;
  fixture.form.addEventListener('submit', event => { submits++; assert.equal(event.submitter, fixture.button); event.preventDefault(); });
  h.listeners.get('click')(fixture.click);
  assert.equal(fixture.click.defaultPrevented, true); assert.equal(submits, 0);
  await Promise.resolve(); assert.equal(submits, 1);
  assert(!h.elements.some(element => element.textContent?.includes('没有可用的嵌入提交')));
});

test('submit respects HTML validation and later JavaScript click cancellation', async () => {
  const h = browserHarness(), fixture = formFixture(h);
  let submits = 0;
  fixture.form.addEventListener('submit', event => { submits++; event.preventDefault(); });
  fixture.form.reportValidity = () => false;
  h.listeners.get('click')(fixture.click); await Promise.resolve(); assert.equal(submits, 0);
  fixture.form.reportValidity = () => true;
  fixture.click.defaultPrevented = false;
  h.listeners.get('click')(fixture.click); fixture.click.preventDefault();
  await Promise.resolve(); assert.equal(submits, 0);
  fixture.button.formNoValidate = true; fixture.form.reportValidity = () => false;
  fixture.click.defaultPrevented = false;
  h.listeners.get('click')(fixture.click); await Promise.resolve(); assert.equal(submits, 1);
});

test('Enter submits a password form once, but not textareas, composition, or editable widgets', async () => {
  const h = browserHarness(), fixture = formFixture(h);
  let submits = 0;
  fixture.form.addEventListener('submit', event => { submits++; event.preventDefault(); });
  const key = target => ({ key: 'Enter', target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });
  const event = key(fixture.input); h.listeners.get('keydown')(event); await Promise.resolve(); assert.equal(submits, 1);
  for (const event of [key({ ...fixture.input, tagName: 'TEXTAREA' }), key({ ...fixture.input, isContentEditable: true }), { ...key(fixture.input), isComposing: true }, { ...key(fixture.input), ctrlKey: true }]) h.listeners.get('keydown')(event);
  await Promise.resolve(); assert.equal(submits, 1);
});

test('requestSubmit keeps submitter/validation semantics and blocks unhandled native actions', () => {
  const h = browserHarness(), fixture = formFixture(h);
  let submits = 0;
  fixture.form.addEventListener('submit', event => { submits++; assert.equal(event.submitter, fixture.button); event.preventDefault(); });
  fixture.form.requestSubmit(fixture.button); assert.equal(submits, 1);
  assert.throws(() => fixture.form.requestSubmit({ type: 'text', form: fixture.form }), /submit button/);
  assert.throws(() => fixture.form.requestSubmit({ type: 'submit', form: {} }), /not owned/);
  fixture.form.events.delete('submit'); fixture.form.requestSubmit();
  assert(h.elements.some(element => element.textContent?.includes('没有可用的嵌入提交')));
});

test('official asset preflight rejects unknown lazy confirmation contracts before accepting an update', async () => {
  const fetchImpl = async url => new Response(new URL(url).pathname === '/' ? '<script src="/assets/main.js"></script>' : 'function canDelete(){return window.confirm("Delete?")}');
  await assert.rejects(verifyOfficialWeb({ baseUrl: 'http://127.0.0.1:4224/', version: '0.7.0', fetchImpl }), CompatibilityError);
});

test('official asset preflight never fetches foreign or out-of-scope scripts and enforces byte limits', async () => {
  const requests = [];
  await assert.rejects(verifyOfficialWeb({ baseUrl: 'http://127.0.0.1:4224/', fetchImpl: async url => {
    requests.push(url); return new Response('<script src="https://foreign.invalid/assets/main.js"></script>');
  } }), /范围/);
  assert.equal(requests.length, 1);
  await assert.rejects(verifyOfficialWeb({ baseUrl: 'http://127.0.0.1:4224/', fetchImpl: async url => new Response('huge', { headers: { 'content-length': String(33 * 1024 * 1024) } }) }), /大小上限/);
  await assert.rejects(verifyOfficialWeb({ baseUrl: 'http://127.0.0.1:4224/', fetchImpl: async url => new Response('<script src="/outside.js"></script>') }), /范围/);
});
