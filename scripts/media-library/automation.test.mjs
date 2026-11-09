// @vitest-environment node
import { test } from 'vitest';
import {spawnSync} from 'node:child_process';
// register() measures files with ffprobe; skip only where the binary is absent.
const hasFfprobe=spawnSync('ffprobe',['-version']).status===0;
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync,symlinkSync,rmSync,utimesSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {referenceOnly,discover,within,processJob,save,register} from './automation.mjs';
test('Facebook requires explicit reuse permission independent of stock claim',()=>{
 const base={source:'stock',source_url:'https://www.facebook.com/video/1',license_evidence:'public post'};
 assert.equal(referenceOnly(base),true);
 assert.equal(referenceOnly({...base,authorized_for_reuse:true}),true);
 assert.equal(referenceOnly({...base,authorized_for_reuse:true,authorization_evidence:'creator permission file'}),false);
 assert.equal(referenceOnly({source:'stock',source_url:'https://www.pexels.com/video/1',license_evidence:'saved licence'}),false);
});
test('unregistered Dropbox files are discovered as unclassified references',()=>{
 const root=mkdtempSync(join(tmpdir(),'media-watch-'));
 try{writeFileSync(join(root,'new.mp4'),'fixture');const result=discover(root);assert.equal(result.length,1);assert.equal(result[0].metadata.scope,'unclassified');assert.equal(referenceOnly(result[0].metadata),true);}finally{rmSync(root,{recursive:true});}
});
test('outside symlink cannot be submitted to model',()=>{
 const root=mkdtempSync(join(tmpdir(),'media-safe-'));mkdirSync(join(root,'inbox'));writeFileSync(join(root,'outside.mp4'),'data');symlinkSync(join(root,'outside.mp4'),join(root,'inbox','link.mp4'));
 try{assert.throws(()=>within(join(root,'inbox'),join(root,'inbox','link.mp4')));}finally{rmSync(root,{recursive:true});}
});
test('completed duplicate does not invoke provider or approve selection',async()=>{
 const state=mkdtempSync(join(tmpdir(),'media-idempotent-'));const id='a'.repeat(64);save(join(state,id+'.json'),{id,status:'tagged_pending_review',eligible_for_automatic_selection:false});
 try{const result=await processJob(state,state,id,{client:{chat:{completions:{create:()=>{throw Error('must not call');}}}}});assert.equal(result.eligible_for_automatic_selection,false);}finally{rmSync(state,{recursive:true});}
});

test.skipIf(!hasFfprobe)('late source sidecar supersedes provisional receipt without losing history',()=>{
 const root=mkdtempSync(join(tmpdir(),'media-provenance-')),state=join(root,'state');mkdirSync(state);
 const file=join(root,'image.png');
 writeFileSync(file,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC6kAAAAASUVORK5CYII=','base64'));
 const past=new Date(Date.now()-20000);utimesSync(file,past,past);
 try{
  const provisional=register(root,state,{file,metadata:{source:'unknown',scope:'unclassified'}});
  const metadata={source:'stock',scope:'industry-travel',source_url:'https://commons.wikimedia.org/wiki/File:Fixture.png',license_evidence:'CC0 source evidence'};
  const sourced=register(root,state,{file,metadata});
  assert.equal(sourced.status,'tagging_pending');assert.equal(sourced.eligible_for_automatic_selection,false);
  assert.equal(existsSync(join(state,provisional.id+'.json')),false);
  assert.equal(existsSync(join(state,'superseded',provisional.id+'.json')),true);
  assert.equal(register(root,state,{file,metadata}).id,sourced.id);
 }finally{rmSync(root,{recursive:true});}
});
