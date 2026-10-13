import {readFile} from 'node:fs/promises';
export async function loadBoardHtml(){
  const [html,css,script,purify]=await Promise.all([
    readFile(new URL('../ui/index.html',import.meta.url),'utf8'),readFile(new URL('../ui/styles.css',import.meta.url),'utf8'),
    readFile(new URL('../ui/app.mjs',import.meta.url),'utf8'),readFile(new URL('../node_modules/dompurify/dist/purify.min.js',import.meta.url),'utf8')]);
  const safe=s=>s.replaceAll('</script','<\\/script');
  return html.replace('<!-- APP_STYLES -->',`<style>${css}</style>`).replace('<!-- APP_SCRIPT -->',`<script>${safe(purify)}</script><script type="module">${safe(script)}</script>`);
}
