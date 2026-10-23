(() => {
  'use strict';
  if (globalThis.__dbxCompat) return;
  const waiting = new Map();
  let sequence = 0;
  function bridge(action, payload) {
    return new Promise((resolve, reject) => {
      const id = `dbx-${Date.now()}-${++sequence}`;
      const timer = setTimeout(() => { waiting.delete(id); reject(new Error('Codex 操作未响应，请重试')); }, 60000);
      waiting.set(id, { resolve, reject, timer });
      parent.postMessage({ type: 'dbx-compat', id, action, payload }, '*');
    });
  }
  addEventListener('message', event => {
    const message = event.data;
    if (event.source !== parent || message?.type !== 'dbx-compat-result' || typeof message.id !== 'string') return;
    const request = waiting.get(message.id);
    if (!request) return;
    waiting.delete(message.id);
    clearTimeout(request.timer);
    if (typeof message.error === 'string') request.reject(new Error(message.error));
    else request.resolve(message.result);
  });
  function status(message, error = false) {
    const box = document.createElement('div');
    box.setAttribute('role', error ? 'alert' : 'status');
    box.textContent = message;
    box.style.cssText = 'position:fixed;bottom:16px;left:16px;right:16px;z-index:2147483647;padding:12px 16px;border:1px solid #718096;border-radius:8px;background:#20242c;color:#f7fafc;white-space:pre-wrap;overflow-wrap:anywhere';
    document.body.append(box);
    setTimeout(() => box.remove(), error ? 20000 : 12000);
  }
  // Serialize confirmations so a second action cannot hide a pending approval.
  let dialogQueue = Promise.resolve();
  function dialog(kind, message, initial = '') {
    const run = () => new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#0008;display:flex;align-items:center;justify-content:center;padding:24px';
      const box = document.createElement('div');
      box.setAttribute('role', kind === 'alert' ? 'alertdialog' : 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.setAttribute('aria-label', String(message));
      box.style.cssText = 'width:100%;max-width:560px;max-height:85vh;overflow:auto;border:1px solid #718096;border-radius:10px;padding:24px;background:#20242c;color:#f7fafc;box-shadow:0 16px 70px #0008';
      const label = document.createElement('p');
      label.textContent = String(message);
      label.style.cssText = 'margin:0 0 18px;white-space:pre-wrap;overflow-wrap:anywhere';
      box.append(label);
      let input;
      if (kind === 'prompt') {
        input = document.createElement('input');
        input.value = String(initial ?? '');
        input.setAttribute('aria-label', String(message));
        input.style.cssText = 'width:100%;box-sizing:border-box;padding:9px 12px;background:#10141c;color:inherit;border:1px solid #718096;border-radius:5px';
        box.append(input);
      }
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:flex-end;gap:12px;margin-top:20px';
      const previousFocus = document.activeElement;
      const finish = accepted => {
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        previousFocus?.focus?.({ preventScroll: true });
        resolve(kind === 'prompt' ? (accepted ? input.value : null) : kind === 'confirm' ? accepted : undefined);
      };
      const cancel = document.createElement('button');
      cancel.type = 'button'; cancel.textContent = '取消'; cancel.addEventListener('click', () => finish(false));
      const ok = document.createElement('button');
      ok.type = 'button'; ok.textContent = '确定'; ok.addEventListener('click', () => finish(true));
      for (const button of [cancel, ok]) button.style.cssText = 'padding:7px 18px;background:#283345;color:inherit;border:1px solid #718096;border-radius:5px;cursor:pointer';
      if (kind !== 'alert') row.append(cancel);
      row.append(ok); box.append(row); overlay.append(box); document.body.append(overlay);
      function onKey(event) {
        // Keep application/global hotkeys from changing the reviewed target
        // behind an asynchronous confirmation. Text editing remains native.
        event.stopImmediatePropagation();
        if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); finish(false); }
        else if (event.key === 'Enter' && (event.target === input || event.target === ok || event.target === cancel)) {
          event.preventDefault(); event.stopImmediatePropagation(); finish(event.target !== cancel);
        } else if (event.key === 'Tab') {
          const controls = [input, kind !== 'alert' ? cancel : null, ok].filter(Boolean);
          const index = controls.indexOf(document.activeElement);
          event.preventDefault(); event.stopImmediatePropagation(); controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length].focus();
        }
      }
      document.addEventListener('keydown', onKey, true);
      (input ?? (kind === 'alert' ? ok : cancel)).focus();
    });
    const result = dialogQueue.then(run, run);
    dialogQueue = result.catch(() => {});
    return result;
  }
  const api = Object.freeze({
    confirm: message => dialog('confirm', message),
    prompt: (message, initial) => dialog('prompt', message, initial),
    alert: message => dialog('alert', message),
  });
  Object.defineProperty(globalThis, '__dbxCompat', { value: api });
  const writeText = text => bridge('clipboard-write', { text: String(text) }).catch(error => { status(`复制失败：${error.message}`, true); throw error; });
  try {
    const clipboard = navigator.clipboard;
    if (clipboard) Object.defineProperty(clipboard, 'writeText', { value: writeText, configurable: true });
    else Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  } catch { status('此环境无法启用剪贴板兼容，请手动选中文字复制。', true); }
  function openLink(url) {
    const target = new URL(String(url), location.href);
    if (!['http:', 'https:', 'mailto:'].includes(target.protocol)) { status('此链接无法在 Codex 中打开。', true); return; }
    void bridge('open-link', { url: target.href }).catch(error => status(`打开链接失败：${error.message}`, true));
  }
  window.open = url => { if (url) openLink(url); return null; };
  // A sandbox without allow-forms blocks the browser submission algorithm
  // before Vue's @submit.prevent runs. Dispatch the DOM event ourselves and
  // require a JavaScript handler to cancel it; never navigate a native action.
  function submitForm(form, submitter, skipValidation = false) {
    if (!skipValidation && !form.noValidate && !submitter?.formNoValidate && form.reportValidity && !form.reportValidity()) return;
    const event = new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: submitter ?? null });
    if (form.dispatchEvent(event)) {
      event.preventDefault();
      status('此表单没有可用的嵌入提交处理器，已阻止页面跳转。', true);
    }
  }
  function scheduleSubmit(event, form, submitter) {
    if (event.defaultPrevented || !form || submitter?.disabled) return;
    const prevent = event.preventDefault, descriptor = Object.getOwnPropertyDescriptor(event, 'preventDefault');
    let cancelled = false;
    prevent.call(event);
    try {
      Object.defineProperty(event, 'preventDefault', { configurable: true, value() { cancelled = true; prevent.call(this); } });
    } catch { status('此环境无法处理表单提交，请重新打开 DBX 面板。', true); return; }
    queueMicrotask(() => {
      if (descriptor) Object.defineProperty(event, 'preventDefault', descriptor);
      else delete event.preventDefault;
      // The click/keydown handler may itself have cancelled the action.
      if (!cancelled && form.isConnected !== false) submitForm(form, submitter);
    });
  }
  function submitterFor(form) {
    return Array.from(form.elements ?? []).find(control => !control.disabled && ['submit', 'image'].includes(control.type));
  }
  if (globalThis.HTMLFormElement) {
    HTMLFormElement.prototype.requestSubmit = function (submitter) {
      if (submitter != null && !['submit', 'image'].includes(submitter.type)) throw new TypeError('The submitter is not a submit button');
      if (submitter != null && submitter.form !== this) throw new DOMException('The submitter is not owned by this form', 'NotFoundError');
      submitForm(this, submitter);
    };
    document.addEventListener('click', event => {
      const control = event.target?.closest?.('button, input');
      if (control && ['submit', 'image'].includes(control.type)) scheduleSubmit(event, control.form, control);
    }, true);
    document.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target;
      if (!target || target.tagName !== 'INPUT' || target.isContentEditable || target.closest?.('[contenteditable="true"]') || !['text', 'password', 'search', 'email', 'tel', 'url', 'number', 'date', 'datetime-local', 'month', 'time', 'week'].includes(target.type)) return;
      const form = target.form;
      if (form) scheduleSubmit(event, form, submitterFor(form));
    }, true);
  }
  function encode(bytes) {
    let result = '';
    for (let index = 0; index < bytes.length; index++) result += String.fromCharCode(bytes[index]);
    return btoa(result);
  }
  async function download(anchor) {
    let exportId, reader;
    try {
      const response = await fetch(anchor.href);
      if (!response.ok || !response.body) throw new Error(`导出请求失败 (${response.status})`);
      const disposition = response.headers.get('content-disposition') ?? '';
      let name = anchor.download || disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      if (name) { try { name = decodeURIComponent(name); } catch {} }
      name ||= disposition.match(/filename="?([^";]+)/i)?.[1] || 'dbx-export.bin';
      const opened = await bridge('download-open', { name, mimeType: response.headers.get('content-type') ?? 'application/octet-stream' });
      exportId = opened?.id;
      if (!exportId) throw new Error('Codex 未创建导出文件');
      reader = response.body.getReader();
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        for (let offset = 0; offset < next.value.length; offset += 65536) await bridge('download-write', { id: exportId, data: encode(next.value.subarray(offset, offset + 65536)) });
      }
      const saved = await bridge('download-close', { id: exportId });
      if (!saved?.path) throw new Error('Codex 未返回导出文件位置');
      exportId = undefined;
      status(`已保存：${saved.path}`);
    } catch (error) {
      await reader?.cancel().catch(() => {});
      if (exportId) await bridge('download-cancel', { id: exportId }).catch(() => {});
      status(`导出失败：${error.message}`, true);
    } finally { reader?.releaseLock(); }
  }
  function handleAnchor(anchor) {
    const href = anchor.getAttribute('href');
    if (!href) return false;
    const url = new URL(href, location.href);
    // Official Web uses bare API anchors (without a download attribute) for
    // backup, SQL failure-log, MongoDB and database/table/query exports.
    if (anchor.hasAttribute('download') || url.protocol === 'blob:' || (url.origin === location.origin && url.pathname.includes('/api/'))) {
      void download(anchor); return true;
    }
    if (anchor.target === '_blank' || (['http:', 'https:', 'mailto:'].includes(url.protocol) && url.origin !== location.origin)) {
      openLink(url.href); return true;
    }
    return false;
  }
  const originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (!handleAnchor(this)) originalClick.call(this); };
  document.addEventListener('click', event => {
    const anchor = event.target?.closest?.('a');
    if (anchor && handleAnchor(anchor)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
})();
