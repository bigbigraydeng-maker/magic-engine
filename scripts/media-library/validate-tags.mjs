// Local-only intake preflight: no credentials, network or storage writes.
import {readFileSync} from 'node:fs';
import {intakeTags} from './tagging.mjs';
const file=process.argv[2];
if(!file) throw new Error('Usage: validate-tags.mjs metadata-or-collection.json');
const input=JSON.parse(readFileSync(file,'utf8'));
const assets=input.assets ?? [input];
if(!Array.isArray(assets)||!assets.length) throw new Error('No intake records');
const results=assets.map(asset=>({file:asset.file_path ?? null,...intakeTags(asset)}));
console.log(JSON.stringify({checked:results.length,no_publish:true,results},null,2));
