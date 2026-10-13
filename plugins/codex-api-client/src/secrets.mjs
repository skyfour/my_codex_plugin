import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

// Interactive security input keeps passwords out of process arguments and shell history.
const quote = value => '"' + String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n').replaceAll('\r', '\\r') + '"';
export class KeychainSecrets {
  constructor(namespace) {
    this.service = 'Codex API Client:' + createHash('sha256').update(namespace).digest('hex').slice(0, 16);
  }
  async command(command) {
    if (process.platform !== 'darwin') throw new Error('KEYCHAIN_UNAVAILABLE: 敏感变量需要 macOS Keychain');
    return new Promise((resolve, reject) => {
      const child = spawn('/usr/bin/security', ['-i'], { stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '', err = '';
      child.stdout.on('data', b => { out += b; });
      child.stderr.on('data', b => { err += b; });
      child.on('error', () => reject(new Error('KEYCHAIN_UNAVAILABLE')));
      child.on('close', code => {
        if (code || /SecKeychain|could not|Error:|error:/i.test(err)) reject(new Error('KEYCHAIN_ERROR: 无法访问系统钥匙串'));
        else resolve(out.replace(/^security>\s*/gm, '').trimEnd());
      });
      child.stdin.end(command + '\n');
    });
  }
  async set(id, value) {
    // Base64 avoids security's interactive parser interpreting control characters.
    await this.command(`add-generic-password -U -s ${quote(this.service)} -a ${quote(id)} -w ${quote(Buffer.from(String(value)).toString('base64'))}`);
  }
  async get(id) {
    const value = await this.command(`find-generic-password -s ${quote(this.service)} -a ${quote(id)} -w`);
    return Buffer.from(value, 'base64').toString();
  }
  async delete(id) { await this.command(`delete-generic-password -s ${quote(this.service)} -a ${quote(id)}`); }
}

export const MASK = '••••••••';
export const isSecret = value => value && typeof value === 'object' && ('key' in value) && (value.type === 'secret' || value.sensitive === true || value.secretRef);

export async function transformSecrets(value, fn) {
  if (Array.isArray(value)) return Promise.all(value.map(v => transformSecrets(v, fn)));
  if (!value || typeof value !== 'object') return value;
  if (isSecret(value)) return fn({ ...value });
  return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([k, v]) => [k, await transformSecrets(v, fn)])));
}

export function redact(value, secrets = []) {
  const needles = [...new Set(secrets.filter(v=>v!==undefined&&v!==null).map(String))].filter(Boolean).sort((a,b)=>b.length-a.length);
  const visit = v => {
    if (typeof v === 'string') { for (const s of needles) v=v.split(s).join(MASK); return v; }
    if (Array.isArray(v)) return v.map(visit);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,visit(x)]));
    return v;
  };
  return visit(value);
}
