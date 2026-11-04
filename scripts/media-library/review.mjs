// Rule-based review of 99_Catalog/asset-records; never modifies asset-records.
// --apply writes only derived files (asset-reviews, approved-selection, review-queue, review-runs).
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PROMPT_SHA } from './vision-prompt.mjs';

export function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function loadPolicy(file = join(dirname(fileURLToPath(import.meta.url)), 'review-policy.json')) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function readRecords(studioRoot) {
  const dir = join(studioRoot, '99_Catalog', 'asset-records');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const bytes = readFileSync(join(dir, name));
      return { record: JSON.parse(bytes.toString('utf8')), recordSha: sha256Bytes(bytes) };
    });
}

function batchMeta(parsed) {
  const { assets, ...batch } = parsed;
  return batch;
}

export function indexCollections(studioRoot) {
  const index = new Map();
  const inbox = join(studioRoot, '00_Inbox');
  if (!existsSync(inbox)) return index;
  for (const scopeDir of readdirSync(inbox, { withFileTypes: true })) {
    if (!scopeDir.isDirectory()) continue;
    const scopePath = join(inbox, scopeDir.name);
    for (const batchDir of readdirSync(scopePath, { withFileTypes: true })) {
      if (!batchDir.isDirectory()) continue;
      const file = join(scopePath, batchDir.name, 'collection-record.json');
      if (!existsSync(file)) continue;
      let parsed;
      try {
        parsed = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        continue;
      }
      if (!parsed || !Array.isArray(parsed.assets)) continue;
      const batch = batchMeta(parsed);
      for (const asset of parsed.assets) {
        if (!asset || typeof asset.source_url !== 'string') continue;
        const list = index.get(asset.source_url) ?? [];
        list.push({ batchDir: batchDir.name, asset, batch });
        index.set(asset.source_url, list);
      }
    }
  }
  return index;
}

export function matchCollection(record, index) {
  const entries = index.get(record.source_url);
  if (!entries || entries.length === 0) return { error: 'no_match' };
  if (entries.length === 1) return entries[0];
  const narrowed = entries.filter((entry) => basename(entry.asset.file_path ?? '') === record.filename);
  if (narrowed.length === 1) return narrowed[0];
  return { error: 'ambiguous' };
}

export function includesAny(text, terms) {
  const haystack = String(text ?? '').toLowerCase();
  return (terms ?? []).some((term) => haystack.includes(String(term).toLowerCase()));
}

function stringify(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function evidenceText(record, asset, batch) {
  const parts = [
    record.license_evidence,
    asset?.license_evidence,
    asset?.license_scope,
    asset?.review_status,
    batch?.review_status,
    batch?.license_scope,
    batch?.license_evidence,
  ];
  return parts
    .filter((part) => part !== null && part !== undefined)
    .map(stringify)
    .join('\n');
}

export function rightsVerdict(record, asset, policy, batch) {
  const reasons = [];
  let url;
  try {
    url = new URL(record.source_url);
  } catch {
    return { rights: 'needs_human', reasons: ['invalid_source_url'] };
  }
  const host = url.hostname.replace(/^www\./, '');
  const rules = policy.rights;
  if (!rules.auto_hosts.includes(host)) reasons.push('host_not_whitelisted');
  if (rules.reject_hosts.includes(host)) reasons.push('host_rejected');
  const lowerUrl = String(record.source_url).toLowerCase();
  if (rules.reject_url_substrings.some((sub) => lowerUrl.includes(String(sub).toLowerCase()))) {
    reasons.push('premium_url');
  }
  if (record.source !== 'stock') reasons.push('source_not_stock');
  if (typeof record.license_evidence !== 'string' || !record.license_evidence.trim()) {
    reasons.push('no_license_evidence');
  }
  const evidence = evidenceText(record, asset, batch);
  if (includesAny(evidence, rules.hold_phrases) || asset?.no_publish === true || batch?.no_publish === true) {
    reasons.push('intake_marked_pending');
  }
  if (includesAny(evidence, rules.search_evidence_phrases)) {
    reasons.push('evidence_from_search_page');
  }
  return { rights: reasons.length === 0 ? 'auto_approved_by_policy' : 'needs_human', reasons };
}

function classifyBrandValue(value, policy) {
  if (value === undefined || value === null) return { state: 'unchecked', text: null };
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return { state: 'unchecked', text: null };
    const normalized = trimmed.toLowerCase().replace(/\.$/, '');
    if (policy.brand_none_values.includes(normalized)) return { state: 'none', text: trimmed };
    return { state: 'present', text: trimmed };
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return { state: 'none', text: null };
    return { state: 'present', text: value.map(stringify).join(', ') };
  }
  return { state: 'present', text: stringify(value) };
}

export function intakeBrand(asset, policy) {
  const fields = [
    classifyBrandValue(asset?.visible_third_party_logos, policy),
    classifyBrandValue(asset?.brand_or_alcohol_flags, policy),
  ];
  const present = fields.filter((f) => f.state === 'present');
  if (present.length > 0) {
    return { state: 'present', text: present.map((f) => f.text).join('; ') };
  }
  const none = fields.find((f) => f.state === 'none');
  if (none) return { state: 'none', text: none.text };
  return { state: 'unchecked', text: null };
}

export function visionValid(vision, recordSha, policy) {
  return Boolean(
    vision && vision.status === 'ok' && vision.record_sha256 === recordSha &&
    vision.prompt_sha256 === PROMPT_SHA &&
    policy.vision.allowed_models.includes(vision.model) &&
    vision.result,
  );
}

export function brandVerdict(intake, vision, valid) {
  if (intake.state === 'present') return 'third_party_brand';
  if (!valid) return 'unknown';
  const v = vision.result.brand;
  if (!v) return 'unknown';
  if (v.verdict === 'yes' || v.verdict === 'unsure') return 'third_party_brand';
  if (v.verdict === 'no' && typeof v.seen_text === 'string' && v.seen_text.trim()) return 'third_party_brand';
  if (v.verdict === 'no') return 'none';
  return 'unknown';
}

export function watermarkVerdict(vision, valid) {
  if (!valid) return 'unknown';
  return vision.result.watermark === 'no' ? 'none' : 'present_or_unsure';
}

export function peopleVerdict(record, asset, vision, valid, policy) {
  const people_present = record.tags?.people_present === false ? false : true;
  const human_reasons = [];
  if (includesAny(JSON.stringify(record.tags?.subject ?? []), policy.child_terms)) {
    human_reasons.push('child_in_tags');
  }
  if (includesAny(String(asset?.people_detail ?? ''), [...policy.child_terms, 'face_visible'])) {
    human_reasons.push('intake_child_or_face');
  }
  if (valid) {
    const result = vision.result;
    if (result.children === 'yes' || result.children === 'unsure') human_reasons.push('vision_child');
    if (result.face === 'yes' || result.face === 'unsure') human_reasons.push('vision_face');
  }
  return { people_present, human_reasons };
}

export function alcoholFlag(record, asset, intake, policy) {
  const text = (intake.text ?? '') + JSON.stringify(record.tags ?? {});
  return includesAny(text, policy.alcohol_terms);
}

export function locationVerdict(asset, policy) {
  const loc = asset?.location;
  if (loc && typeof loc === 'object' && typeof loc.status === 'string') {
    if (policy.location.source_stated.includes(loc.status) &&
        typeof loc.verification_evidence === 'string' && loc.verification_evidence.trim()) {
      return { location: 'source_stated', evidence: loc.verification_evidence };
    }
    if (policy.location.generic.includes(loc.status)) {
      return { location: 'generic', evidence: loc.verification_evidence ?? null };
    }
  }
  return { location: 'unverified', evidence: null };
}

function qualityFor(record, asset, policy) {
  const q = policy.quality;
  const cropText = record.filename + ' ' + (asset?.file_path ?? '');
  if (includesAny(cropText, policy.derived_crop_markers)) {
    return { portrait: 'hold:possible_derived_crop', landscape: 'hold:possible_derived_crop' };
  }
  const mime = String(record.mime_type ?? '');
  if (mime.startsWith('video/') && !(Number(record.duration_seconds) >= q.video_min_seconds)) {
    return { portrait: 'hold:too_short', landscape: 'hold:too_short' };
  }
  const width = Number(record.width);
  const height = Number(record.height);
  const missing = !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0;
  const portrait = record.native_aspect === 'portrait'
    ? (missing ? 'hold:missing_dimensions' : (width >= q.portrait_min_width ? 'ok' : 'hold:low_resolution'))
    : 'hold:not_native_portrait';
  const landscape = record.native_aspect === 'landscape'
    ? (missing ? 'hold:missing_dimensions' : (height >= q.landscape_min_height ? 'ok' : 'hold:low_resolution'))
    : 'hold:not_native_landscape';
  return { portrait, landscape };
}

export function qualityVerdict(record, asset, policy) {
  return qualityFor(record, asset, policy);
}

export function meSource(source) {
  if (source === 'stock') return 'stock';
  if (source === 'i2v') return 'ai_generated';
  return 'unknown';
}

export function meOwnership(scope) {
  return scope === 'enterprise' ? 'client_exclusive' : 'industry_shared';
}

function collectHumanReasons({ match, rightsResult, brand, watermark, people, quality }) {
  const human_reasons = [];
  if (match.error) human_reasons.push('collection_' + match.error);
  if (rightsResult.rights === 'needs_human') {
    for (const reason of rightsResult.reasons) human_reasons.push('rights:' + reason);
  }
  if (brand === 'third_party_brand') human_reasons.push('brand_present');
  if (brand === 'unknown') human_reasons.push('brand_unknown');
  if (watermark === 'present_or_unsure') human_reasons.push('watermark');
  if (watermark === 'unknown') human_reasons.push('watermark_unknown');
  for (const reason of people.human_reasons) human_reasons.push(reason);
  if (quality.portrait === 'hold:possible_derived_crop' || quality.landscape === 'hold:possible_derived_crop') {
    human_reasons.push('possible_derived_crop');
  }
  return human_reasons;
}

function isEligibleBase({ rightsResult, brand, watermark, people, match }) {
  return rightsResult.rights === 'auto_approved_by_policy' &&
    brand === 'none' && watermark === 'none' &&
    people.human_reasons.length === 0 && !match.error;
}

export function reviewAsset({ record, recordSha, match, vision, visionSha, policy, runId, now }) {
  const asset = match.asset;
  const batch = match.batch;
  const rightsResult = rightsVerdict(record, asset, policy, batch);
  const intake = intakeBrand(asset, policy);
  const valid = visionValid(vision, recordSha, policy);
  const brand = brandVerdict(intake, vision, valid);
  const watermark = watermarkVerdict(vision, valid);
  const people = peopleVerdict(record, asset, vision, valid, policy);
  const alcohol = alcoholFlag(record, asset, intake, policy);
  const loc = locationVerdict(asset, policy);
  const quality = qualityVerdict(record, asset, policy);
  const human_reasons = collectHumanReasons({ match, rightsResult, brand, watermark, people, quality });
  const base = isEligibleBase({ rightsResult, brand, watermark, people, match });

  const restrictions = ['no_resale_as_is'];
  if (people.people_present) restrictions.push('no_endorsement');
  if (alcohol) restrictions.push('alcohol');

  return {
    asset_id: record.asset_id,
    record_sha256: recordSha,
    vision_check_sha256: visionSha ?? null,
    policy_version: policy.policy_version,
    run_id: runId,
    reviewed_at: now,
    reviewer: 'maliang-policy',
    collection_batch: match.batchDir ?? null,
    rights: rightsResult.rights,
    restrictions,
    brand,
    people_present: people.people_present,
    watermark,
    location: loc.location,
    location_evidence: loc.evidence,
    quality_portrait: quality.portrait,
    quality_landscape: quality.landscape,
    eligible_portrait: base && quality.portrait === 'ok',
    eligible_landscape: base && quality.landscape === 'ok',
    me_source: meSource(record.source),
    me_ownership: meOwnership(record.scope),
    author_or_rightsholder: asset?.author_or_rightsholder ?? null,
    human_reasons,
  };
}

function selectionDuration(record) {
  const mime = String(record.mime_type ?? '');
  return mime.startsWith('video/') ? record.duration_seconds : null;
}

export function selectionEntry(record, review) {
  return {
    asset_id: record.asset_id,
    scope: record.scope,
    scope_key: record.scope_key,
    me_ownership: review.me_ownership,
    me_source: review.me_source,
    bucket: record.bucket,
    object_path: record.object_path,
    sha256: record.sha256,
    filename: record.filename,
    mime_type: record.mime_type,
    width: record.width,
    height: record.height,
    duration_seconds: selectionDuration(record),
    native_aspect: record.native_aspect,
    eligible_portrait: review.eligible_portrait,
    eligible_landscape: review.eligible_landscape,
    restrictions: review.restrictions,
    location: review.location,
    location_evidence: review.location_evidence,
    source_url: record.source_url,
    record_sha256: review.record_sha256,
    vision_check_sha256: review.vision_check_sha256,
    tags: record.tags ?? null,
    size_bytes: record.size_bytes ?? null,
    author_or_rightsholder: review.author_or_rightsholder,
  };
}

export function buildSelection(pairs) {
  const first = pairs[0]?.review ?? null;
  const assets = [];
  for (const pair of pairs) {
    const { record, recordSha, review } = pair;
    if (!(review.eligible_portrait || review.eligible_landscape)) continue;
    if (review.record_sha256 !== recordSha) continue;
    assets.push(selectionEntry(record, review));
  }
  return {
    schema_version: 1,
    policy_version: first?.policy_version ?? null,
    generated_at: first?.reviewed_at ?? null,
    note: 'eligible for automatic selection is not publish authorization',
    assets,
  };
}

export function queueEntry(record, review, studioRoot) {
  return {
    asset_id: record.asset_id,
    problem: review.human_reasons.join(', '),
    how: 'Open the local file and the source page; decide rights/brand/people/watermark/crop; record the decision in a reviewed collection-record entry',
    source_url: record.source_url,
    local_file: join(studioRoot, '99_Catalog', 'registered-originals', record.asset_id),
    collection_batch: review.collection_batch,
  };
}

export function summarize(reviews) {
  const by_reason = {};
  let eligible_any = 0;
  let eligible_portrait = 0;
  let eligible_landscape = 0;
  let needs_human = 0;
  for (const review of reviews) {
    if (review.eligible_portrait || review.eligible_landscape) eligible_any++;
    if (review.eligible_portrait) eligible_portrait++;
    if (review.eligible_landscape) eligible_landscape++;
    if (review.human_reasons.length > 0) needs_human++;
    for (const reason of review.human_reasons) {
      by_reason[reason] = (by_reason[reason] ?? 0) + 1;
    }
  }
  return { total: reviews.length, eligible_any, eligible_portrait, eligible_landscape, needs_human, by_reason };
}

export function writeJsonAtomic(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  renameSync(tmp, file);
}

function readVision(studioRoot, assetId, recordSha) {
  const file = join(studioRoot, '99_Catalog', 'vision-checks', assetId + '.json');
  if (!existsSync(file)) return { vision: null, visionSha: null };
  const bytes = readFileSync(file);
  let vision = null;
  try {
    vision = JSON.parse(bytes.toString('utf8'));
  } catch {
    vision = null;
  }
  return { vision, visionSha: sha256Bytes(bytes) };
}

function usage() {
  return 'Usage: review.mjs <studio-root> [--apply]';
}

export async function run(argv) {
  const apply = argv.includes('--apply');
  const studioRoot = argv.find((arg) => !arg.startsWith('--'));
  if (!studioRoot || !existsSync(join(studioRoot, '99_Catalog', 'asset-records'))) {
    console.error(usage());
    return 2;
  }
  const policy = loadPolicy();
  const runId = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + '-' + randomBytes(3).toString('hex');
  const now = new Date().toISOString();
  const index = indexCollections(studioRoot);
  const records = readRecords(studioRoot);
  const pairs = [];
  for (const { record, recordSha } of records) {
    const match = matchCollection(record, index);
    const { vision, visionSha } = readVision(studioRoot, record.asset_id, recordSha);
    const review = reviewAsset({ record, recordSha, match, vision, visionSha, policy, runId, now });
    pairs.push({ record, recordSha, review });
  }
  const reviews = pairs.map((pair) => pair.review);
  const summary = summarize(reviews);
  const inputSha = sha256Bytes(records.map((r) => r.recordSha).sort().join('\n'));
  const report = {
    run_id: runId,
    policy_version: policy.policy_version,
    apply,
    input_sha256: inputSha,
    records: records.length,
    ...summary,
  };
  if (apply) {
    for (const pair of pairs) {
      writeJsonAtomic(join(studioRoot, '99_Catalog', 'asset-reviews', pair.record.asset_id + '.json'), pair.review);
    }
    writeJsonAtomic(join(studioRoot, '99_Catalog', 'approved-selection.json'), buildSelection(pairs));
    const items = pairs
      .filter((pair) => pair.review.human_reasons.length > 0)
      .map((pair) => queueEntry(pair.record, pair.review, studioRoot));
    writeJsonAtomic(join(studioRoot, '99_Catalog', 'review-queue.json'), { run_id: runId, items });
    writeJsonAtomic(join(studioRoot, '99_Catalog', 'review-runs', runId + '.json'), report);
  }
  console.log(JSON.stringify({ event: 'media_library_review', ...report }));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await run(process.argv.slice(2));
}
