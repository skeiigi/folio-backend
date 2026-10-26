import { readFile,writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
try {
  const template=await readFile(new URL('../.env.example',import.meta.url),'utf8');
  await writeFile(new URL('../.env',import.meta.url),template.replace('replace-this-with-at-least-32-random-characters',randomBytes(48).toString('hex')),{flag:'wx'});
  console.log('Local .env created with a random JWT secret.');
}catch(e){if(e.code==='EEXIST')console.log('Existing .env preserved.');else throw e;}
