import { writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
try {
  await writeFile(new URL('../.dev.vars', import.meta.url), `ADMIN_PASSWORD="123"\nSESSION_SECRET="${randomBytes(32).toString('hex')}"\n`, {flag:'wx'});
  console.log('Created .dev.vars for local development. Admin password: 123.');
} catch (error) { if(error.code==='EEXIST') console.log('.dev.vars already exists; kept unchanged.'); else throw error; }
