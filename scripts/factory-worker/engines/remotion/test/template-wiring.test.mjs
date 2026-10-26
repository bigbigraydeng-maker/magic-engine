import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATE_IDS } from '../src/templates.ts';
import { TEXT_WIRED_TEMPLATES } from '../../../remotion-branch.mjs';

test('every engine template is wired for text/red-line rescan', () => {
  const wired = new Set(TEXT_WIRED_TEMPLATES);
  const missing = TEMPLATE_IDS.filter((id) => !wired.has(id));
  assert.deepEqual(
    missing,
    [],
    `这些模板在引擎里注册了，但出片机没有文字/红线复扫接线：${missing.join(', ')}`,
  );
});

test('no stale ids in TEXT_WIRED_TEMPLATES', () => {
  const known = new Set(TEMPLATE_IDS);
  const stale = TEXT_WIRED_TEMPLATES.filter((id) => !known.has(id));
  assert.deepEqual(stale, [], `TEXT_WIRED_TEMPLATES 含有未知模板 id：${stale.join(', ')}`);
});

test('TEXT_WIRED_TEMPLATES has no duplicates', () => {
  const seen = new Set();
  const dupes = TEXT_WIRED_TEMPLATES.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
  assert.deepEqual(dupes, [], `TEXT_WIRED_TEMPLATES 含有重复 id：${dupes.join(', ')}`);
});
