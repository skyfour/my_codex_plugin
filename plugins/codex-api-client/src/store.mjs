import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { KeychainSecrets, MASK, transformSecrets } from './secrets.mjs';

export class Store {
  constructor(directory, secrets = new KeychainSecrets(directory)) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.directory = directory; this.secrets = secrets;
    this.db = new DatabaseSync(join(directory, 'workspace.sqlite'));
    chmodSync(join(directory, 'workspace.sqlite'), 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS documents (
        kind TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL,
        data TEXT NOT NULL, updatedAt TEXT NOT NULL, PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, data TEXT NOT NULL, updatedAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS run_controls (id TEXT PRIMARY KEY, cancelled INTEGER NOT NULL DEFAULT 0);
      PRAGMA user_version=2;`);
  }
  row(kind, id) { return this.db.prepare('SELECT * FROM documents WHERE kind=? AND id=?').get(kind, id); }
  async view(row, { reveal = false } = {}) {
    if (!row) return null;
    return { ...row, data: await transformSecrets(JSON.parse(row.data), async v => ({ ...v, value: reveal ? await this.secrets.get(v.secretRef) : MASK })) };
  }
  async get(kind, id, options) { return this.view(this.row(kind, id), options); }
  async list(kind) {
    const rows = this.db.prepare('SELECT * FROM documents WHERE kind=? ORDER BY updatedAt DESC').all(kind);
    return Promise.all(rows.map(r => this.view(r)));
  }
  async put(kind, id, data, expectedRevision) {
    // All session cookies are credentials; never persist their values in SQLite.
    if (kind === 'cookies') data={...data,cookies:(data.cookies||[]).map(c=>({...c,type:'secret'}))};
    const original = this.row(kind, id);
    if ((original?.revision ?? 0) !== expectedRevision) throw new Error('CONFLICT: 内容已在其他会话更新，请重新加载后保存');
    // Allocate a new immutable key for each value, so a losing concurrent writer cannot alter an existing secret.
    const owned = new Set();
    if (original) await transformSecrets(JSON.parse(original.data), v => { if (v.secretRef) owned.add(v.secretRef); return v; });
    const created = [];
    try {
      const stored = await transformSecrets(structuredClone(data), async v => {
        if (v.value === MASK) {
          if (!owned.has(v.secretRef)) throw new Error('INVALID_SECRET: 无法复用其他文档的凭据引用');
        } else {
          v.secretRef = randomUUID();
          await this.secrets.set(v.secretRef, v.value ?? ''); created.push(v.secretRef);
        }
        delete v.value; v.type = 'secret'; return v;
      });
      this.db.exec('BEGIN IMMEDIATE');
      try {
        if ((this.row(kind, id)?.revision ?? 0) !== expectedRevision) throw new Error('CONFLICT: 内容已更新');
        this.db.prepare(`INSERT INTO documents VALUES(?,?,?,?,?) ON CONFLICT(kind,id)
          DO UPDATE SET revision=excluded.revision,data=excluded.data,updatedAt=excluded.updatedAt`)
          .run(kind, id, expectedRevision + 1, JSON.stringify(stored), new Date().toISOString());
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    } catch (error) {
      await Promise.allSettled(created.map(ref => this.secrets.delete(ref)));
      throw error;
    }
    return this.get(kind, id);
  }
  async remove(kind, id, expectedRevision) {
    const result = this.db.prepare('DELETE FROM documents WHERE kind=? AND id=? AND revision=?').run(kind, id, expectedRevision);
    if (!result.changes) throw new Error('CONFLICT: 内容已更新或不存在');
    return { removed: id };
  }
  async export(kind, id) {
    const doc = await this.get(kind, id);
    if (!doc) throw new Error('NOT_FOUND');
    return transformSecrets(doc.data, v => { delete v.secretRef; return { ...v, value: '' }; });
  }
  saveRun(run) {
    this.db.prepare('INSERT INTO runs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updatedAt=excluded.updatedAt')
      .run(run.id, JSON.stringify(run), new Date().toISOString());
  }
  getRun(id) { const r = this.db.prepare('SELECT data FROM runs WHERE id=?').get(id); return r ? JSON.parse(r.data) : null; }
  listRuns() { return this.db.prepare('SELECT data FROM runs ORDER BY updatedAt DESC LIMIT 100').all().map(r => JSON.parse(r.data)); }
  requestCancel(id) { this.db.prepare('INSERT INTO run_controls VALUES(?,1) ON CONFLICT(id) DO UPDATE SET cancelled=1').run(id); }
  isCancelled(id) { return Boolean(this.db.prepare('SELECT cancelled FROM run_controls WHERE id=?').get(id)?.cancelled); }
  close() { this.db.close(); }
}
