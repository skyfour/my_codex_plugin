import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { KeychainSecrets } from '../src/secrets.mjs';
const keychain=new KeychainSecrets('codex-api-client-install-check');
const id=randomUUID();
try{
  await keychain.set(id,'local-test-only\n"quoted"\\value 中文');
  assert.equal(await keychain.get(id),'local-test-only\n"quoted"\\value 中文');
  console.log('macOS Keychain read/write check passed');
}finally{await keychain.delete(id);}
