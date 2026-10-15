import {mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
// Host integration registry, separate from task data and credentials.
export async function registerCommitContextProvider({codeHome=process.env.CODEX_HOME??join(homedir(),'.codex'),entrypoint=fileURLToPath(new URL('../servers/commit-context.mjs',import.meta.url))}={}) {
  const directory=join(codeHome,'integrations');await mkdir(directory,{recursive:true,mode:0o700});
  const destination=join(directory,'task-commit-context-v1.json'),temporary=destination+'.'+randomUUID();
  try { await writeFile(temporary,JSON.stringify({contractVersion:1,transport:'mcp-stdio',entrypoint}),{mode:0o600,flag:'wx'});await rename(temporary,destination); }
  finally { await rm(temporary,{force:true}); }
}
