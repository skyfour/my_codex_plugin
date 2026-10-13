// Adapted from Workelta backend/tapd.mjs (2026-10-09). Fixed read-only endpoints and validation retained.
import {normalizeSourceInput} from './source-input.mjs';

const INTERNAL_ERROR_CODES = new Set([
  'INVALID_TAPD_INPUT', 'TAPD_AUTH_REQUIRED', 'TAPD_IDENTITY_MISMATCH', 'TAPD_SCOPE_MISMATCH',
  'TAPD_HTTP_FAILED', 'TAPD_RATE_LIMITED', 'TAPD_RESPONSE_INVALID', 'TAPD_RESPONSE_TOO_LARGE',
  'TAPD_TIMEOUT', 'TAPD_CANCELED', 'TAPD_PAGINATION_INVALID', 'TAPD_LIMIT_EXCEEDED',
  'TAPD_SOURCE_CONFLICT',
]);
export const TAPD_ERROR_CODES = new Set(INTERNAL_ERROR_CODES);

const BASE_URL = 'https://api.tapd.cn';
const FIELDS = 'id,workspace_id,name,description,creator,modified,status,owner';
const PAGE_LIMIT = 200;
const MAX_PAGES = 25;
const RESPONSE_LIMIT = 16 * 1024 * 1024;
const ROUND_LIMIT = 32 * 1024 * 1024;
const REQUEST_TIMEOUT = 20_000;
// ponytail: one round is capped below native preview's 300s deadline; add checkpoints only if real slow scopes demand them.
const ROUND_TIMEOUT = 240_000;
const HOUR = 60 * 60 * 1000;
const CHINA_OFFSET = 8 * HOUR;
const STATUSES = new Set(['open', 'progressing', 'done']);

function failure(code, retryAfterSeconds) {
  const error = new Error(code);
  if (retryAfterSeconds !== undefined) error.retryAfterSeconds = retryAfterSeconds;
  return error;
}

function exactObject(value, keys, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !keys.includes(key)) || required.some(key => !Object.hasOwn(value, key))) {
    throw failure('INVALID_TAPD_INPUT');
  }
}

function decimalId(value) {
  return typeof value === 'string' && /^[0-9]{1,32}$/.test(value);
}

function safeNick(value) {
  return typeof value === 'string' && value.length > 0 && value === value.trim() &&
    Buffer.byteLength(value) <= 256 && !/[|;<>,\x00-\x1f\x7f]/.test(value);
}

function validateIdentityShape(value, input = false) {
  if (input) exactObject(value, ['id', 'nick', 'name'], ['id', 'nick', 'name']);
  if (!value || typeof value !== 'object' || Array.isArray(value) || !decimalId(value.id) ||
      !safeNick(value.nick) || typeof value.name !== 'string' || !value.name.trim() ||
      Buffer.byteLength(value.name) > 256 || value.name.includes('\0')) {
    throw failure(input ? 'INVALID_TAPD_INPUT' : 'TAPD_RESPONSE_INVALID');
  }
}

function validateInput(input) {
  exactObject(input, ['token', 'workspaceId', 'ownerName', 'expectedIdentity', 'cursor', 'knownIds', 'signal'],
    ['token', 'workspaceId', 'ownerName']);
  if (typeof input.token !== 'string' || !/^[!-~]{1,4096}$/.test(input.token) || !decimalId(input.workspaceId) ||
      typeof input.ownerName !== 'string' || !input.ownerName.trim() || input.ownerName.includes('\0') ||
      Buffer.byteLength(input.ownerName) > 256) throw failure('INVALID_TAPD_INPUT');
  const expectedIdentity = input.expectedIdentity ?? null;
  if (expectedIdentity !== null) validateIdentityShape(expectedIdentity, true);
  const cursor = input.cursor ?? null;
  if (cursor !== null && (!Number.isSafeInteger(cursor) || cursor < 0)) throw failure('INVALID_TAPD_INPUT');
  if (cursor !== null) formatChina(Math.max(0, cursor - HOUR));
  const knownIds = input.knownIds ?? [];
  if (!Array.isArray(knownIds) || knownIds.length > 5000 || knownIds.some(id => !decimalId(id)) ||
      new Set(knownIds).size !== knownIds.length) throw failure('INVALID_TAPD_INPUT');
  const signal = input.signal;
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw failure('INVALID_TAPD_INPUT');
  return {...input, expectedIdentity, cursor, knownIds, signal};
}

function abortRace(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener('abort', aborted, {once: true});
    Promise.resolve(promise).then(
      value => { signal.removeEventListener('abort', aborted); resolve(value); },
      error => { signal.removeEventListener('abort', aborted); reject(error); },
    );
  });
}

function retryAfter(response) {
  const value = response.headers.get('retry-after');
  if (!/^[0-9]+$/.test(value ?? '')) return undefined;
  const seconds = Number(value);
  return seconds <= 1800 ? seconds : undefined;
}

async function requestJson(path, search, {token, fetchImpl, signal, externalSignal, deadlineSignal, bytes}) {
  if (path !== '/users/info' && path !== '/tasks') throw failure('TAPD_HTTP_FAILED');
  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(search)) url.searchParams.set(key, String(value));
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT);
  const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
  let reader;
  let phase = 'fetch';
  try {
    if (combined.aborted) throw failure(externalSignal?.aborted ? 'TAPD_CANCELED' : 'TAPD_TIMEOUT');
    const response = await abortRace(fetchImpl(url, {
      method: 'GET', redirect: 'error', headers: {accept: 'application/json', authorization: `Bearer ${token}`}, signal: combined,
    }), combined);
    phase = 'response';
    if (!response || typeof response.status !== 'number' || !response.headers) throw failure('TAPD_RESPONSE_INVALID');
    if (response.status === 401 || response.status === 403) throw failure('TAPD_AUTH_REQUIRED');
    if (response.status === 429) throw failure('TAPD_RATE_LIMITED', retryAfter(response));
    // TAPD reports an invalid OAuth token as HTTP 422, alongside ordinary validation errors.
    const validationError = response.status === 422;
    if (!validationError && (response.status < 200 || response.status >= 300)) throw failure('TAPD_HTTP_FAILED');
    const invalidResponseCode = validationError ? 'TAPD_HTTP_FAILED' : 'TAPD_RESPONSE_INVALID';
    const mediaType = (response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
    if (!/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)$/.test(mediaType)) throw failure(invalidResponseCode);
    if (!response.body || typeof response.body.getReader !== 'function') throw failure(invalidResponseCode);
    reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', {fatal: true});
    const parts = [];
    let responseBytes = 0;
    while (true) {
      const {done, value} = await abortRace(reader.read(), combined);
      if (done) break;
      if (!(value instanceof Uint8Array)) throw failure('TAPD_RESPONSE_INVALID');
      responseBytes += value.byteLength;
      bytes.total += value.byteLength;
      if (responseBytes > RESPONSE_LIMIT || bytes.total > ROUND_LIMIT) throw failure('TAPD_RESPONSE_TOO_LARGE');
      parts.push(decoder.decode(value, {stream: true}));
    }
    parts.push(decoder.decode());
    let envelope;
    try { envelope = JSON.parse(parts.join('')); } catch { throw failure(invalidResponseCode); }
    if (validationError) {
      if (envelope?.status === 422 && envelope.info === 'The access token provided is invalid') throw failure('TAPD_AUTH_REQUIRED');
      throw failure('TAPD_HTTP_FAILED');
    }
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || envelope.status !== 1 ||
        !Object.hasOwn(envelope, 'data')) throw failure('TAPD_RESPONSE_INVALID');
    return envelope.data;
  } catch (error) {
    if (reader) await reader.cancel().catch(() => {});
    if (externalSignal?.aborted) throw failure('TAPD_CANCELED');
    if (deadlineSignal.aborted || timeout.signal.aborted) throw failure('TAPD_TIMEOUT');
    if (INTERNAL_ERROR_CODES.has(error?.message)) throw error;
    throw failure(phase === 'fetch' ? 'TAPD_HTTP_FAILED' : 'TAPD_RESPONSE_INVALID');
  } finally {
    clearTimeout(timer);
    if (reader) {
      try { reader.releaseLock(); } catch {}
    }
  }
}

function chinaDate(value, fetchedAt) {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw failure('TAPD_RESPONSE_INVALID');
  const parts = match.slice(1).map(Number);
  const millis = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]) - CHINA_OFFSET;
  const roundtrip = new Date(millis + CHINA_OFFSET);
  const actual = [roundtrip.getUTCFullYear(), roundtrip.getUTCMonth() + 1, roundtrip.getUTCDate(),
    roundtrip.getUTCHours(), roundtrip.getUTCMinutes(), roundtrip.getUTCSeconds()];
  if (actual.some((part, index) => part !== parts[index]) || millis < 0 || millis > fetchedAt + 5 * 60 * 1000) {
    throw failure('TAPD_RESPONSE_INVALID');
  }
  return millis;
}

function formatChina(millis) {
  const date = new Date(millis + CHINA_OFFSET);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1000 || date.getUTCFullYear() > 9999) {
    throw failure('INVALID_TAPD_INPUT');
  }
  const two = value => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}-${two(date.getUTCMonth() + 1)}-${two(date.getUTCDate())} ` +
    `${two(date.getUTCHours())}:${two(date.getUTCMinutes())}:${two(date.getUTCSeconds())}`;
}

function taskSource(wrapper, {workspaceId, nick, fetchedAt, ownerScope}) {
  if (!wrapper || typeof wrapper !== 'object' || Array.isArray(wrapper) ||
      !wrapper.Task || typeof wrapper.Task !== 'object' || Array.isArray(wrapper.Task)) throw failure('TAPD_RESPONSE_INVALID');
  const task = wrapper.Task;
  const requiredStrings = ['id', 'workspace_id', 'name', 'modified', 'status', 'owner'];
  if (requiredStrings.some(key => typeof task[key] !== 'string') ||
      !Object.hasOwn(task, 'description') || !Object.hasOwn(task, 'creator') ||
      (task.description !== null && typeof task.description !== 'string') ||
      (task.creator !== null && typeof task.creator !== 'string') || !decimalId(task.id)) {
    throw failure('TAPD_RESPONSE_INVALID');
  }
  if (task.workspace_id !== workspaceId) throw failure('TAPD_SCOPE_MISMATCH');
  if (!STATUSES.has(task.status)) throw failure('TAPD_RESPONSE_INVALID');
  if (ownerScope && (task.status === 'done' || !task.owner.split(';').map(value => value.trim()).includes(nick))) {
    throw failure('TAPD_SCOPE_MISMATCH');
  }
  const sourceUpdatedAt = chinaDate(task.modified, fetchedAt);
  try {
    return normalizeSourceInput({
      provider: 'tapd', account: workspaceId, resourceType: 'tasks', sourceId: task.id, sourceUpdatedAt,
      title: task.name, body: task.description ?? '', sender: task.creator ?? '',
      url: `https://www.tapd.cn/${workspaceId}/prong/tasks/view/${task.id}`,
      sourceState: task.status, owner: task.owner,
    });
  } catch (error) {
    if (INTERNAL_ERROR_CODES.has(error?.message)) throw error;
    throw failure('TAPD_RESPONSE_INVALID');
  }
}

function mergeRecord(records, record) {
  const existing = records.get(record.sourceId);
  if (!existing || record.sourceUpdatedAt > existing.sourceUpdatedAt) {
    records.set(record.sourceId, record);
  } else if (record.sourceUpdatedAt === existing.sourceUpdatedAt && JSON.stringify(record) !== JSON.stringify(existing)) {
    throw failure('TAPD_SOURCE_CONFLICT');
  }
}

export async function readTapd(input, {fetchImpl = fetch, now = Date.now} = {}) {
  const validated = validateInput(input);
  if (typeof fetchImpl !== 'function' || typeof now !== 'function') throw failure('INVALID_TAPD_INPUT');
  const fetchedAt = now();
  if (!Number.isSafeInteger(fetchedAt) || fetchedAt < 0) throw failure('INVALID_TAPD_INPUT');
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), ROUND_TIMEOUT);
  const signal = validated.signal ? AbortSignal.any([validated.signal, deadline.signal]) : deadline.signal;
  const context = {...validated, fetchImpl, fetchedAt, signal, externalSignal: validated.signal,
    deadlineSignal: deadline.signal, bytes: {total: 0}};
  try {
    const identityData = await requestJson('/users/info', {}, context);
    validateIdentityShape(identityData);
    const activeOauthUser = identityData.enabled === '1' && identityData.status_id === '1';
    const personalTokenUser = !Object.hasOwn(identityData, 'enabled') && !Object.hasOwn(identityData, 'status_id');
    if ((!activeOauthUser && !personalTokenUser) || identityData.name !== validated.ownerName ||
        validated.expectedIdentity && ['id', 'nick', 'name'].some(key => identityData[key] !== validated.expectedIdentity[key])) {
      throw failure('TAPD_IDENTITY_MISMATCH');
    }
    const identity = {id: identityData.id, nick: identityData.nick, name: identityData.name};
    const records = new Map();
    let lastId = null;
    let pages = 0;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const search = {
        workspace_id: validated.workspaceId, owner: `USER_OR<${identity.nick}>`, status: 'open|progressing',
        order: 'id asc', fields: FIELDS, page, limit: PAGE_LIMIT,
      };
      if (validated.cursor !== null) search.modified = `>${formatChina(Math.max(0, validated.cursor - HOUR))}`;
      const data = await requestJson('/tasks', search, context);
      if (!Array.isArray(data) || data.length > PAGE_LIMIT) throw failure('TAPD_PAGINATION_INVALID');
      pages = page;
      for (const wrapper of data) {
        const record = taskSource(wrapper, {...context, nick: identity.nick, ownerScope: true});
        const id = BigInt(record.sourceId);
        if (lastId !== null && id <= lastId) throw failure('TAPD_PAGINATION_INVALID');
        lastId = id;
        mergeRecord(records, record);
      }
      if (data.length < PAGE_LIMIT) break;
      if (page === MAX_PAGES) throw failure('TAPD_LIMIT_EXCEEDED');
    }

    const missing = new Set(validated.knownIds);
    const seenKnown = new Set();
    for (let offset = 0; offset < validated.knownIds.length; offset += 100) {
      const batch = validated.knownIds.slice(offset, offset + 100);
      const allowed = new Set(batch);
      const data = await requestJson('/tasks', {
        workspace_id: validated.workspaceId, id: batch.join(','), fields: FIELDS, limit: PAGE_LIMIT,
      }, context);
      if (!Array.isArray(data) || data.length > batch.length) throw failure('TAPD_RESPONSE_INVALID');
      for (const wrapper of data) {
        const record = taskSource(wrapper, {...context, nick: identity.nick, ownerScope: false});
        if (!allowed.has(record.sourceId)) throw failure('TAPD_SCOPE_MISMATCH');
        if (seenKnown.has(record.sourceId)) throw failure('TAPD_PAGINATION_INVALID');
        seenKnown.add(record.sourceId);
        missing.delete(record.sourceId);
        mergeRecord(records, record);
      }
    }
    if (validated.signal?.aborted) throw failure('TAPD_CANCELED');
    if (deadline.signal.aborted) throw failure('TAPD_TIMEOUT');
    let cursor = validated.cursor;
    for (const record of records.values()) cursor = Math.max(cursor ?? 0, record.sourceUpdatedAt);
    if (validated.cursor === null && records.size === 0) cursor = null;
    return {
      identity, records: [...records.values()], cursor, fetchedAt, pages, missingIds: validated.knownIds.filter(id => missing.has(id)),
    };
  } finally {
    clearTimeout(timer);
  }
}
