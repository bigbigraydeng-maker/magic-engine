// @vitest-environment node
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {mergeCatalog} from './catalog-sync.mjs';
const record={relative_path:'inbox/a.mp4',sha256:'hash',scope:'enterprise',company:'cts',rights_status:'approved',review_status:'approved',source_group_id:'real-parent',used_in:['existing'],tags:null};
test('tag enrichment preserves ownership, rights, source grouping and usage',()=>{
 const result=mergeCatalog({assets:[record]},[{...record,rights_status:'pending',source_group_id:'different',used_in:[],tags:{subject:['river']},tagging_status:'tagged_pending_review'}]);
 assert.equal(result.catalog.assets[0].rights_status,'approved');assert.equal(result.catalog.assets[0].source_group_id,'real-parent');assert.deepEqual(result.catalog.assets[0].used_in,['existing']);
 assert.equal(result.added,0);
});
test('changed content or scope never overwrites an existing record',()=>{
 for(const diff of [{sha256:'different'},{scope:'industry'},{company:'other'}])assert.throws(()=>mergeCatalog({assets:[record]},[{...record,...diff}]));
});
test('repeated merging never duplicates a file',()=>{
 const first=mergeCatalog({assets:[]},[record]);const second=mergeCatalog(first.catalog,[record]);assert.equal(second.added,0);assert.equal(second.catalog.assets.length,1);
});
