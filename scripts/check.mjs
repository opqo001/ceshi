import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
async function files(folder) {
  const entries = await readdir(folder, {withFileTypes:true});
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(join(folder,entry.name)) : [join(folder,entry.name)]))).flat();
}
const publicRoot=join(root,'public');
for(const folder of ['src','public/js','scripts','tests']) {
  for(const file of await files(join(root,folder))) {
    if(!/\.m?js$/.test(file)) continue;
    const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
    if(result.status!==0) throw new Error(result.stderr);
  }
}
for(const file of await files(publicRoot)) {
  if(!/\.(?:html|css|js|svg)$/.test(file)) continue;
  const source=await readFile(file,'utf8');
  if(/[\u3400-\u9fff]/u.test(source)) throw new Error(`Non-English copy: ${file}`);
  if(file.endsWith('.html')) {
    const ids=[...source.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
    if(new Set(ids).size!==ids.length) throw new Error(`Duplicate ID: ${file}`);
    for(const match of source.matchAll(/(?:src|href)="(\/[^"#?]*)(?:[?#][^"]*)?"/g)) {
      if(match[1]==='/') continue;
      const target=resolve(publicRoot,'.'+match[1]);
      if(!(await stat(target)).isFile()) throw new Error(`Missing asset: ${target}`);
    }
  }
  if(file.endsWith('.css')) for(const match of source.matchAll(/url\("([^"()]+)"\)/g)) {
    if(!match[1].startsWith('http') && !(await stat(resolve(dirname(file),match[1]))).isFile()) throw new Error(`Missing CSS asset: ${match[1]}`);
  }
}
const booking=await readFile(join(publicRoot,'booking.html'),'utf8');
if((booking.match(/<iframe /g)||[]).length!==1 || booking.includes('mapsHelp')) throw new Error('Expected one map and no removed helper text.');
console.log('Checks passed: JavaScript syntax, English UI, local asset paths, unique HTML IDs, one map.');
