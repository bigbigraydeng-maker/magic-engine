// @vitest-environment node
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {intakeTags} from './tagging.mjs';
const valid = () => ({tags:{subject:['lake'],shot_type:'wide',action:'boat movement',season:'unknown',people_present:false},channels:['youtube'],tagging_evidence:'Sampled video frames; season not established'});
test('explicit unknown is retained without approving production', () => {
  const result=intakeTags(valid());
  assert.equal(result.tags.people_present,false);
  assert.equal(result.tagging_status,'needs_enrichment');
  assert.equal(result.eligible_for_automatic_selection,false);
});
test('all required content fields gate intake', () => {
  for(const field of ['subject','shot_type','action','season','people_present']) {
    const data=valid();delete data.tags[field];assert.throws(()=>intakeTags(data));
  }
  for(const field of ['channels','tagging_evidence']) {
    const data=valid();delete data[field];assert.throws(()=>intakeTags(data));
  }
});
test('malformed tags and channel names are refused', () => {
  for(const tags of [[],null,{...valid().tags,subject:['']},{...valid().tags,people_present:'yes'}]) {
    assert.throws(()=>intakeTags({...valid(),tags}));
  }
  assert.throws(()=>intakeTags({...valid(),channels:['arbitrary']}));
  assert.throws(()=>intakeTags({...valid(),tags:{...valid().tags,subject:['REQUIRED_observed_subject']}}));
});
