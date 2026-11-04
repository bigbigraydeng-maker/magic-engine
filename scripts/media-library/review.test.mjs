// @vitest-environment node
import { test, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import {
  loadPolicy,
  readRecords,
  indexCollections,
  matchCollection,
  reviewAsset,
  buildSelection,
  run,
} from './review.mjs';
import { PROMPT_SHA } from './vision-prompt.mjs';

function makeStudio() {
  const root = mkdtempSync(join(tmpdir(), 'media-review-'));
  mkdirSync(join(root, '99_Catalog', 'asset-records'), { recursive: true });
  mkdirSync(join(root, '00_Inbox', 'industry-x', '2026-11-03_Batch'), { recursive: true });
  return root;
}

function defaultRecord() {
  return {
    asset_id: 'a'.repeat(32),
    scope: 'industry',
    scope_key: 'x',
    bucket: 'me-media-industry',
    object_path: 'x/originals/a.mp4',
    filename: 'clip.mp4',
    mime_type: 'video/mp4',
    sha256: 'f'.repeat(64),
    size_bytes: 10,
    source: 'stock',
    source_url: 'https://www.pexels.com/video/1/',
    license_evidence: 'Pexels License: free commercial use',
    tags: {
      subject: ['harbour'],
      shot_type: 'wide',
      action: 'static',
      season: 'unknown',
      people_present: false,
    },
    width: 1080,
    height: 1920,
    duration_seconds: 8,
    native_aspect: 'portrait',
  };
}

function addRecord(root, overrides = {}) {
  const record = { ...defaultRecord(), ...overrides };
  writeFileSync(
    join(root, '99_Catalog', 'asset-records', record.asset_id + '.json'),
    JSON.stringify(record, null, 2) + '\n',
  );
  return record;
}

function addCollection(root, assets) {
  writeFileSync(
    join(root, '00_Inbox', 'industry-x', '2026-11-03_Batch', 'collection-record.json'),
    JSON.stringify({ assets }, null, 2) + '\n',
  );
}

function addCollectionWithMeta(root, meta, assets) {
  writeFileSync(
    join(root, '00_Inbox', 'industry-x', '2026-11-03_Batch', 'collection-record.json'),
    JSON.stringify({ ...meta, assets }, null, 2) + '\n',
  );
}

function addCollectionInBatch(root, batch, assets) {
  const dir = join(root, '00_Inbox', 'industry-x', batch);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'collection-record.json'), JSON.stringify({ assets }, null, 2) + '\n');
}

function addVision(root, assetId, recordSha, result, status = 'ok') {
  const dir = join(root, '99_Catalog', 'vision-checks');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, assetId + '.json'),
    JSON.stringify({
      asset_id: assetId,
      record_sha256: recordSha,
      status,
      result,
      prompt_sha256: PROMPT_SHA,
      model: 'claude-haiku-5-5',
    }, null, 2) + '\n',
  );
}

function cleanVision() {
  return {
    brand: { verdict: 'no', seen_text: '' },
    children: 'no',
    face: 'no',
    watermark: 'no',
  };
}

function cleanCollectionAsset(overrides = {}) {
  return {
    source_url: 'https://www.pexels.com/video/1/',
    file_path: 'originals/clip.mp4',
    visible_third_party_logos: 'none',
    location: { status: 'source_text_stated', verification_evidence: 'page title says Auckland' },
    ...overrides,
  };
}

function reviewOne(root, policy, overrides = {}) {
  const record = addRecord(root, overrides);
  const records = readRecords(root);
  const entry = records.find((r) => r.record.asset_id === record.asset_id);
  const index = indexCollections(root);
  const match = matchCollection(entry.record, index);
  const visionFile = join(root, '99_Catalog', 'vision-checks', record.asset_id + '.json');
  let vision = null;
  let visionSha = null;
  if (existsSync(visionFile)) {
    const bytes = readFileSync(visionFile);
    vision = JSON.parse(bytes.toString('utf8'));
    visionSha = createHash('sha256').update(bytes).digest('hex');
  }
  const review = reviewAsset({
    record: entry.record,
    recordSha: entry.recordSha,
    match,
    vision,
    visionSha,
    policy,
    runId: 'test-run',
    now: '2026-11-04T00:00:00.000Z',
  });
  return { record: entry.record, recordSha: entry.recordSha, match, review };
}

function walk(root) {
  const lines = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else {
        const hash = createHash('sha256').update(readFileSync(full)).digest('hex');
        lines.push(full + ':' + hash);
      }
    }
  };
  visit(root);
  return lines.sort();
}

test('clean pexels portrait with clean collection + valid vision is eligible', () => {
  const root = makeStudio();
  try {
    const policy = loadPolicy();
    addCollection(root, [cleanCollectionAsset()]);
    const record = addRecord(root);
    const records = readRecords(root);
    const entry = records.find((r) => r.record.asset_id === record.asset_id);
    addVision(root, record.asset_id, entry.recordSha, cleanVision());
    const { review } = reviewOne(root, policy);
    expect(review.eligible_portrait).toBe(true);
    expect(review.eligible_landscape).toBe(false);
    expect(review.rights).toBe('auto_approved_by_policy');
    expect(review.location).toBe('source_stated');
    expect(review.human_reasons).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('host not whitelisted is needs_human and not eligible', () => {
  const root = makeStudio();
  try {
    const policy = loadPolicy();
    addCollection(root, [cleanCollectionAsset({ source_url: 'https://example.com/x' })]);
    const { review } = reviewOne(root, policy, { source_url: 'https://example.com/x' });
    expect(review.rights).toBe('needs_human');
    expect(review.eligible_portrait).toBe(false);
    expect(review.eligible_landscape).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('plus.unsplash premium url is rejected', () => {
  const root = makeStudio();
  try {
    const policy = loadPolicy();
    const url = 'https://plus.unsplash.com/premium_photo-1';
    addCollection(root, [cleanCollectionAsset({ source_url: url })]);
    const { review } = reviewOne(root, policy, { source_url: url });
    expect(review.rights).toBe('needs_human');
    const reasons = review.human_reasons;
    expect(reasons.some((r) => r === 'rights:host_rejected' || r === 'rights:host_not_whitelisted')).toBe(true);
    expect(reasons).toContain('rights:premium_url');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('hold phrase and no_publish both force needs_human', () => {
  const root = makeStudio();
  try {
    const policy = loadPolicy();
    addCollection(root, [cleanCollectionAsset()]);
    const { review } = reviewOne(root, policy, { license_evidence: 'Pexels License 另需确认' });
    expect(review.rights).toBe('needs_human');
    expect(review.human_reasons).toContain('rights:intake_marked_pending');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  const root2 = makeStudio();
  try {
    const policy = loadPolicy();
    addCollection(root2, [cleanCollectionAsset({ no_publish: true })]);
    const { review } = reviewOne(root2, policy);
    expect(review.rights).toBe('needs_human');
    expect(review.human_reasons).toContain('rights:intake_marked_pending');
  } finally {
    rmSync(root2, { recursive: true, force: true });
  }
});

test('search page evidence is flagged', () => {
  const root = makeStudio();
  try {
    const policy = loadPolicy();
    addCollection(root, [cleanCollectionAsset()]);
    const { review } = reviewOne(root, policy, { license_evidence: 'Pexels 搜索页 result' });
    expect(review.human_reasons).toContain('rights:evidence_from_search_page');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('intake brand present is third_party_brand and never selected', () => {
  const root = makeStudio();
  try {
    const policy = loadPolicy();
    addCollection(root, [cleanCollectionAsset({ visible_third_party_logos: 'Maersk, ZIM' })]);
    const { record, recordSha, review } = reviewOne(root, policy);
    expect(review.brand).toBe('third_party_brand');
    expect(review.eligible_portrait).toBe(false);
    const selection = buildSelection([{ record, recordSha, review }]);
    expect(selection.assets).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('null brand field with no vision is unknown and not eligible', () => {
  const root = makeStudio();
  try {
    const policy = loadPolicy();
    addCollection(root, [cleanCollectionAsset({ visible_third_party_logos: null, brand_or_alcohol_flags: null })]);
    const { review } = reviewOne(root, policy);
    expect(review.brand).toBe('unknown');
    expect(review.eligible_portrait).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('vision brand no with seen_text is third_party_brand', () => {
  const root = makeStudio();
  try {
    const policy = loadPolicy();
    addCollection(root, [cleanCollectionAsset()]);
    const record = addRecord(root);
    const records = readRecords(root);
    const entry = records.find((r) => r.record.asset_id === record.asset_id);
    addVision(root, record.asset_id, entry.recordSha, {
      ...cleanVision(),
      brand: { verdict: 'no', seen_text: 'ZIM' },
    });
    const { review } = reviewOne(root, policy);
    expect(review.brand).toBe('third_party_brand');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('vision record_sha256 mismatch invalidates vision', () => {
  const root = makeStudio();
  try {
    const policy = loadPolicy();
    addCollection(root, [cleanCollectionAsset()]);
    const record = addRecord(root);
    addVision(root, record.asset_id, '0'.repeat(64), cleanVision());
    const { review } = reviewOne(root, policy);
    expect(review.brand).toBe('unknown');
    expect(review.watermark).toBe('unknown');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('unknown people_present adds no_endorsement; child in tags blocks', () => {
  const root = makeStudio();
  try {
    const policy = loadPolicy();
    addCollection(root, [cleanCollectionAsset()]);
    const { review } = reviewOne(root, policy, {
      tags: {
        subject: ['Child playing'],
        shot_type: 'wide',
        action: 'static',
        season: 'unknown',
        people_present: 'unknown',
      },
    });
    expect(review.restrictions).toContain('no_endorsement');
    expect(review.human_reasons).toContain('child_in_tags');
    expect(review.eligible_portrait).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('vision face unsure blocks eligibility', () => {
  const root = makeStudio();
  try {
    const policy = loadPolicy();
    addCollection(root, [cleanCollectionAsset()]);
    const record = addRecord(root);
    const records = readRecords(root);
    const entry = records.find((r) => r.record.asset_id === record.asset_id);
    addVision(root, record.asset_id, entry.recordSha, { ...cleanVision(), face: 'unsure' });
    const { review } = reviewOne(root, policy);
    expect(review.human_reasons).toContain('vision_face');
    expect(review.eligible_portrait).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('derived crop marker in filename holds both orientations', () => {
  const root = makeStudio();
  try {
    const policy = loadPolicy();
    addCollection(root, [cleanCollectionAsset({ file_path: 'originals/clip_横版.mp4' })]);
    const { review } = reviewOne(root, policy, { filename: 'clip_横版.mp4' });
    expect(review.quality_portrait).toBe('hold:possible_derived_crop');
    expect(review.quality_landscape).toBe('hold:possible_derived_crop');
    expect(review.human_reasons).toContain('possible_derived_crop');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('short video holds; landscape image is ok', () => {
  const root = makeStudio();
  try {
    const policy = loadPolicy();
    addCollection(root, [cleanCollectionAsset()]);
    const { review } = reviewOne(root, policy, { duration_seconds: 2 });
    expect(review.quality_portrait).toBe('hold:too_short');
    expect(review.quality_landscape).toBe('hold:too_short');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  const root2 = makeStudio();
  try {
    const policy = loadPolicy();
    addCollection(root2, [cleanCollectionAsset({ file_path: 'originals/clip.jpg' })]);
    const { review } = reviewOne(root2, policy, {
      filename: 'clip.jpg', mime_type: 'image/jpeg', duration_seconds: undefined,
      width: 1920, height: 1080, native_aspect: 'landscape',
    });
    expect(review.quality_landscape).toBe('ok');
  } finally {
    rmSync(root2, { recursive: true, force: true });
  }
});

test('location statuses map to unverified and generic', () => {
  const root = makeStudio();
  try {
    const policy = loadPolicy();
    addCollection(root, [cleanCollectionAsset({ location: { status: 'stock_description_only' } })]);
    const { review } = reviewOne(root, policy);
    expect(review.location).toBe('unverified');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  const root2 = makeStudio();
  try {
    const policy = loadPolicy();
    addCollection(root2, [cleanCollectionAsset({ location: { status: 'non_specific' } })]);
    const { review } = reviewOne(root2, policy);
    expect(review.location).toBe('generic');
  } finally {
    rmSync(root2, { recursive: true, force: true });
  }
});

test('ambiguous collection entries resolve by basename or report ambiguous', () => {
  const root = makeStudio();
  try {
    addCollectionInBatch(root, '2026-11-03_Batch', [cleanCollectionAsset()]);
    addCollectionInBatch(root, '2026-11-04_Batch', [
      cleanCollectionAsset({ file_path: 'originals/other.mp4' }),
    ]);
    const record = addRecord(root);
    const index = indexCollections(root);
    const match = matchCollection(record, index);
    expect(match.error).toBeUndefined();
    expect(match.asset.file_path).toBe('originals/clip.mp4');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  const root2 = makeStudio();
  try {
    addCollectionInBatch(root2, '2026-11-03_Batch', [cleanCollectionAsset({ file_path: 'originals/a.mp4' })]);
    addCollectionInBatch(root2, '2026-11-04_Batch', [cleanCollectionAsset({ file_path: 'originals/b.mp4' })]);
    const record = addRecord(root2);
    const index = indexCollections(root2);
    const match = matchCollection(record, index);
    expect(match.error).toBe('ambiguous');
  } finally {
    rmSync(root2, { recursive: true, force: true });
  }
});

test('run without --apply writes nothing', async () => {
  const root = makeStudio();
  try {
    addCollection(root, [cleanCollectionAsset()]);
    addRecord(root);
    const before = walk(root);
    const code = await run([root]);
    expect(code).toBe(0);
    const after = walk(root);
    expect(after).toEqual(before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('run with --apply writes derived files only', async () => {
  const root = makeStudio();
  try {
    addCollection(root, [cleanCollectionAsset()]);
    const clean = addRecord(root);
    const cleanSha = createHash('sha256')
      .update(readFileSync(join(root, '99_Catalog', 'asset-records', clean.asset_id + '.json')))
      .digest('hex');
    addVision(root, clean.asset_id, cleanSha, cleanVision());
    const dirty = addRecord(root, {
      asset_id: 'b'.repeat(32),
      source_url: 'https://example.com/x',
      filename: 'other.mp4',
    });
    const recordsBefore = readdirSync(join(root, '99_Catalog', 'asset-records'))
      .map((n) => n + ':' + createHash('sha256').update(readFileSync(join(root, '99_Catalog', 'asset-records', n))).digest('hex'))
      .sort();
    const code = await run([root, '--apply']);
    expect(code).toBe(0);
    const recordsAfter = readdirSync(join(root, '99_Catalog', 'asset-records'))
      .map((n) => n + ':' + createHash('sha256').update(readFileSync(join(root, '99_Catalog', 'asset-records', n))).digest('hex'))
      .sort();
    expect(recordsAfter).toEqual(recordsBefore);
    expect(existsSync(join(root, '99_Catalog', 'asset-reviews', clean.asset_id + '.json'))).toBe(true);
    const selection = JSON.parse(readFileSync(join(root, '99_Catalog', 'approved-selection.json'), 'utf8'));
    const ids = selection.assets.map((a) => a.asset_id);
    expect(ids).toContain(clean.asset_id);
    expect(ids).not.toContain(dirty.asset_id);
    expect(selection.assets.find((a) => a.asset_id === clean.asset_id).record_sha256).toBe(cleanSha);
    const queue = JSON.parse(readFileSync(join(root, '99_Catalog', 'review-queue.json'), 'utf8'));
    expect(queue.items.map((i) => i.asset_id)).toContain(dirty.asset_id);
    const runs = readdirSync(join(root, '99_Catalog', 'review-runs'));
    expect(runs.length).toBe(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('buildSelection drops pairs whose recordSha differs from review', () => {
  const root = makeStudio();
  try {
    const policy = loadPolicy();
    addCollection(root, [cleanCollectionAsset()]);
    const record = addRecord(root);
    const records = readRecords(root);
    const entry = records.find((r) => r.record.asset_id === record.asset_id);
    addVision(root, record.asset_id, entry.recordSha, cleanVision());
    const { review } = reviewOne(root, policy);
    const selection = buildSelection([{ record: entry.record, recordSha: '0'.repeat(64), review }]);
    expect(selection.assets).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('vision watermark yes or unsure is present_or_unsure and not eligible', () => {
  for (const verdict of ['yes', 'unsure']) {
    const root = makeStudio();
    try {
      const policy = loadPolicy();
      addCollection(root, [cleanCollectionAsset()]);
      const record = addRecord(root);
      const records = readRecords(root);
      const entry = records.find((r) => r.record.asset_id === record.asset_id);
      addVision(root, record.asset_id, entry.recordSha, { ...cleanVision(), watermark: verdict });
      const { review } = reviewOne(root, policy);
      expect(review.watermark).toBe('present_or_unsure');
      expect(review.eligible_portrait).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('vision children yes blocks eligibility', () => {
  const root = makeStudio();
  try {
    const policy = loadPolicy();
    addCollection(root, [cleanCollectionAsset()]);
    const record = addRecord(root);
    const records = readRecords(root);
    const entry = records.find((r) => r.record.asset_id === record.asset_id);
    addVision(root, record.asset_id, entry.recordSha, { ...cleanVision(), children: 'yes' });
    const { review } = reviewOne(root, policy);
    expect(review.human_reasons).toContain('vision_child');
    expect(review.eligible_portrait).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('vision brand unsure is third_party_brand and not eligible', () => {
  const root = makeStudio();
  try {
    const policy = loadPolicy();
    addCollection(root, [cleanCollectionAsset()]);
    const record = addRecord(root);
    const records = readRecords(root);
    const entry = records.find((r) => r.record.asset_id === record.asset_id);
    addVision(root, record.asset_id, entry.recordSha, {
      ...cleanVision(),
      brand: { verdict: 'unsure', seen_text: '' },
    });
    const { review } = reviewOne(root, policy);
    expect(review.brand).toBe('third_party_brand');
    expect(review.eligible_portrait).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('vision file with old prompt_sha256 is invalid', () => {
  const root = makeStudio();
  try {
    const policy = loadPolicy();
    addCollection(root, [cleanCollectionAsset()]);
    const record = addRecord(root);
    const records = readRecords(root);
    const entry = records.find((r) => r.record.asset_id === record.asset_id);
    addVision(root, record.asset_id, entry.recordSha, cleanVision());
    const file = join(root, '99_Catalog', 'vision-checks', record.asset_id + '.json');
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(file, JSON.stringify({ ...parsed, prompt_sha256: 'old' }, null, 2) + '\n');
    const { review } = reviewOne(root, policy);
    expect(review.brand).toBe('unknown');
    expect(review.watermark).toBe('unknown');
    expect(review.eligible_portrait).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('vision file with disallowed model is invalid', () => {
  const root = makeStudio();
  try {
    const policy = loadPolicy();
    addCollection(root, [cleanCollectionAsset()]);
    const record = addRecord(root);
    const records = readRecords(root);
    const entry = records.find((r) => r.record.asset_id === record.asset_id);
    addVision(root, record.asset_id, entry.recordSha, cleanVision());
    const file = join(root, '99_Catalog', 'vision-checks', record.asset_id + '.json');
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(file, JSON.stringify({ ...parsed, model: 'gpt-4o' }, null, 2) + '\n');
    const { review } = reviewOne(root, policy);
    expect(review.brand).toBe('unknown');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('batch-level review_status hold phrase forces needs_human', () => {
  const root = makeStudio();
  try {
    const policy = loadPolicy();
    addCollectionWithMeta(root, { review_status: '待审核' }, [cleanCollectionAsset()]);
    const { review } = reviewOne(root, policy);
    expect(review.rights).toBe('needs_human');
    expect(review.human_reasons).toContain('rights:intake_marked_pending');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('batch-level no_publish forces needs_human', () => {
  const root = makeStudio();
  try {
    const policy = loadPolicy();
    addCollectionWithMeta(root, { no_publish: true }, [cleanCollectionAsset()]);
    const { review } = reviewOne(root, policy);
    expect(review.rights).toBe('needs_human');
    expect(review.human_reasons).toContain('rights:intake_marked_pending');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('brand_or_alcohol_flags present is third_party_brand', () => {
  const root = makeStudio();
  try {
    const policy = loadPolicy();
    addCollection(root, [cleanCollectionAsset({
      visible_third_party_logos: 'none',
      brand_or_alcohol_flags: 'ZIM container',
    })]);
    const { review } = reviewOne(root, policy);
    expect(review.brand).toBe('third_party_brand');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('selection entry for an image has null duration and new fields', () => {
  const root = makeStudio();
  try {
    const policy = loadPolicy();
    addCollection(root, [cleanCollectionAsset({ file_path: 'originals/clip.jpg' })]);
    const record = addRecord(root, {
      filename: 'clip.jpg', mime_type: 'image/jpeg', duration_seconds: undefined,
      width: 1920, height: 1080, native_aspect: 'landscape',
    });
    const records = readRecords(root);
    const entry = records.find((r) => r.record.asset_id === record.asset_id);
    addVision(root, record.asset_id, entry.recordSha, cleanVision());
    const { review } = reviewOne(root, policy, {
      filename: 'clip.jpg', mime_type: 'image/jpeg', duration_seconds: undefined,
      width: 1920, height: 1080, native_aspect: 'landscape',
    });
    const selection = buildSelection([{ record: entry.record, recordSha: entry.recordSha, review }]);
    expect(selection.assets.length).toBe(1);
    const asset = selection.assets[0];
    expect(asset.duration_seconds).toBeNull();
    expect(asset.vision_check_sha256).toBe(review.vision_check_sha256);
    expect(asset.tags).toEqual(entry.record.tags);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
