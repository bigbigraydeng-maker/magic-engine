// AI visual check for brand/children/face/watermark on registered originals.
// Writes only 99_Catalog/vision-checks and vision-runs; never edits asset-records.
// Fixed model, budget-capped, no automatic retries or provider fallback.
import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync, readdirSync } from 'node:fs';
import { join, resolve, dirname, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { loadPolicy, readRecords, sha256Bytes, writeJsonAtomic } from './review.mjs';
import { PROMPT, PROMPT_SHA } from './vision-prompt.mjs';

export { PROMPT, PROMPT_SHA };

function round2(n) {
  return Math.round(n * 100) / 100;
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

export function frameTimes(duration, v) {
  const d = Number(duration);
  if (!Number.isFinite(d) || d <= 0) return [0];
  if (d > v.long_video_seconds) {
    const out = [];
    for (let i = 0; i < v.max_frames; i++) out.push(round2(d * (i + 0.5) / v.max_frames));
    return out;
  }
  const out = [];
  for (let k = 0; out.length < v.max_frames; k++) {
    const t = v.frame_step_seconds / 2 + k * v.frame_step_seconds;
    // Seeking within the last half second can yield no decodable frame.
    if (t > d - 0.5) break;
    out.push(round2(t));
  }
  if (out.length < v.min_frames) return [0.1, 0.5, 0.9].map((f) => round2(d * f));
  return out;
}

export function localOriginal(studioRoot, record) {
  const ext = extname(record.object_path ?? record.filename ?? '').toLowerCase();
  return join(studioRoot, '99_Catalog', 'registered-originals', record.asset_id, 'original' + ext);
}

export function extractFrame(file, seconds, maxEdge, isVideo = true) {
  const args = ['-v', 'error'];
  if (isVideo) args.push('-ss', String(seconds));
  args.push(
    '-i', file,
    '-frames:v', '1',
    '-vf', `scale=${maxEdge}:${maxEdge}:force_original_aspect_ratio=decrease`,
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    '-',
  );
  return execFileSync('ffmpeg', args, { timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
}

function stripFence(text) {
  let s = String(text ?? '').trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```[a-zA-Z]*\s*/, '');
    s = s.replace(/```\s*$/, '');
  }
  return s.trim();
}

function exactKeys(obj, keys) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const actual = Object.keys(obj).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length) return false;
  return actual.every((k, i) => k === expected[i]);
}

const VERDICTS = ['yes', 'no', 'unsure'];

export function parseResult(text) {
  const parsed = JSON.parse(stripFence(text));
  if (!exactKeys(parsed, ['brand', 'children', 'face', 'watermark'])) throw new Error('invalid_shape');
  if (!exactKeys(parsed.brand, ['verdict', 'seen_text'])) throw new Error('invalid_shape');
  if (!VERDICTS.includes(parsed.brand.verdict)) throw new Error('invalid_shape');
  if (typeof parsed.brand.seen_text !== 'string') throw new Error('invalid_shape');
  for (const key of ['children', 'face', 'watermark']) {
    if (!VERDICTS.includes(parsed[key])) throw new Error('invalid_shape');
  }
  return parsed;
}

export function costUsd(model, usage, v) {
  const p = v.usd_per_million[model];
  const input = Number(usage?.input_tokens ?? 0);
  const output = Number(usage?.output_tokens ?? 0);
  return round6((input * p.input + output * p.output) / 1e6);
}

export function reserveUsd(model, frames, v) {
  return costUsd(model, {
    input_tokens: frames * v.reserve_tokens_per_frame + v.reserve_prompt_tokens,
    output_tokens: v.max_output_tokens,
  }, v);
}

export function isFatal(error) {
  if (error?.status === 401 || error?.status === 403) return true;
  return /credit balance|billing|quota/i.test(String(error?.message ?? ''));
}

export function modelRank(model, v) {
  return v.allowed_models.indexOf(model);
}

function textOf(response) {
  const blocks = Array.isArray(response?.content) ? response.content : [];
  return blocks.filter((b) => b && b.type === 'text').map((b) => b.text ?? '').join('');
}

function baseResult(record, recordSha, model, now) {
  return {
    schema_version: 1, asset_id: record.asset_id, record_sha256: recordSha,
    prompt_sha256: PROMPT_SHA, model, checked_at: now,
  };
}

function extractFrames(file, times, v, isVideo) {
  return times.map((t) => extractFrame(file, t, v.max_long_edge, isVideo));
}

function buildContent(frames) {
  return [
    ...frames.map((b) => ({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: b.toString('base64') },
    })),
    { type: 'text', text: PROMPT },
  ];
}

async function callProvider(client, model, content, v) {
  return client.messages.create({
    model,
    max_tokens: v.max_output_tokens,
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content }],
  });
}

function providerFailure(base, times, frames, model, v, err) {
  return {
    ...base,
    frames_at: times,
    status: 'vision_failed',
    error: 'provider_error',
    http_status: err?.status ?? null,
    cost_usd: reserveUsd(model, frames.length, v),
    cost_estimated: true,
  };
}

function responseFailure(withUsage, response, model) {
  if (response?.model !== model) return { ...withUsage, status: 'vision_failed', error: 'model_mismatch' };
  if (response?.stop_reason === 'refusal') return { ...withUsage, status: 'vision_failed', error: 'refusal' };
  if (response?.stop_reason === 'max_tokens') return { ...withUsage, status: 'vision_failed', error: 'truncated' };
  return null;
}

function okResult(base, record, times, frames, result, usageOut, cost) {
  return {
    ...base,
    file_sha256: record.sha256,
    frames_at: times,
    frame_count: frames.length,
    status: 'ok',
    result,
    usage: usageOut,
    cost_usd: cost,
  };
}

export async function checkAsset({ record, recordSha, studioRoot, client, model, v, now }) {
  const base = baseResult(record, recordSha, model, now);
  const file = localOriginal(studioRoot, record);
  if (!existsSync(file)) return { ...base, status: 'vision_failed', error: 'missing_local_file' };
  const bytes = readFileSync(file);
  if (sha256Bytes(bytes) !== record.sha256) {
    return { ...base, status: 'vision_failed', error: 'hash_mismatch' };
  }
  const isVideo = String(record.mime_type ?? '').startsWith('video/');
  const times = isVideo ? frameTimes(Number(record.duration_seconds), v) : [0];
  let frames;
  try {
    frames = extractFrames(file, times, v, isVideo);
  } catch {
    return { ...base, frames_at: times, status: 'vision_failed', error: 'frame_extraction_failed' };
  }
  const content = buildContent(frames);
  let response;
  try {
    response = await callProvider(client, model, content, v);
  } catch (err) {
    if (isFatal(err)) throw err;
    return providerFailure(base, times, frames, model, v, err);
  }
  const usage = response?.usage ?? {};
  const cost = costUsd(model, usage, v);
  const usageOut = { input_tokens: usage.input_tokens ?? 0, output_tokens: usage.output_tokens ?? 0 };
  const withUsage = { ...base, frames_at: times, usage: usageOut, cost_usd: cost };
  const failed = responseFailure(withUsage, response, model);
  if (failed) return failed;
  let result;
  try {
    result = parseResult(textOf(response));
  } catch {
    return { ...withUsage, status: 'vision_failed', error: 'invalid_shape' };
  }
  return okResult(base, record, times, frames, result, usageOut, cost);
}

export function readApiKey(envFile) {
  const text = readFileSync(envFile, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*ANTHROPIC_API_KEY\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let value = m[1].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (value) return value;
  }
  throw new Error('ANTHROPIC_API_KEY not found in env file');
}

function usage() {
  return 'Usage: vision-check.mjs <studio-root> --env-file <path> --budget-usd <n> [--limit <n>] [--model <id>] [--ids-file <path>]';
}

function parseFlags(argv) {
  const flags = { studioRoot: null, envFile: null, budget: null, limit: null, model: null, idsFile: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--env-file') flags.envFile = argv[++i];
    else if (arg === '--budget-usd') flags.budget = Number(argv[++i]);
    else if (arg === '--limit') flags.limit = Number(argv[++i]);
    else if (arg === '--model') flags.model = argv[++i];
    else if (arg === '--ids-file') flags.idsFile = argv[++i];
    else if (!arg.startsWith('--') && flags.studioRoot === null) flags.studioRoot = arg;
  }
  return flags;
}

function readExisting(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// A result is reusable only for the same record, prompt and model; a prompt change re-checks everything.
// A weaker model never re-checks over a stronger model's current result.
export function existingOk(file, recordSha, model, v) {
  const parsed = readExisting(file);
  if (!parsed) return false;
  return parsed.status === 'ok' && parsed.record_sha256 === recordSha &&
    parsed.prompt_sha256 === PROMPT_SHA &&
    modelRank(parsed.model, v) >= modelRank(model, v);
}

// Never overwrite a good result with a failure for the same record and prompt.
function keepExisting(file, recordSha, result) {
  if (result.status === 'ok') return false;
  const parsed = readExisting(file);
  return Boolean(parsed && parsed.status === 'ok' && parsed.record_sha256 === recordSha &&
    parsed.prompt_sha256 === PROMPT_SHA);
}

export function historicalSpendUsd(studioRoot) {
  const dir = join(studioRoot, '99_Catalog', 'vision-runs');
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      const parsed = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      if (Number.isFinite(parsed?.spent_usd)) total += parsed.spent_usd;
    } catch {
      // skip unreadable files
    }
  }
  return total;
}

function validateFlags(flags, v, model) {
  if (!v.allowed_models.includes(model)) {
    console.error('model not allowed: ' + model);
    console.error(usage());
    return 2;
  }
  if (!flags.studioRoot || !existsSync(join(flags.studioRoot, '99_Catalog', 'asset-records'))) {
    console.error(usage());
    return 2;
  }
  if (!Number.isFinite(flags.budget) || flags.budget <= 0) {
    console.error(usage());
    return 2;
  }
  return 0;
}

function makeClient(flags, clientFactory) {
  if (clientFactory) return clientFactory();
  return new Anthropic({ apiKey: readApiKey(flags.envFile), maxRetries: 0, timeout: 60000 });
}

function newRunId() {
  return new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + '-' + randomBytes(3).toString('hex');
}

function selectRecords(studioRoot, idsFile) {
  const only = idsFile ? new Set(readFileSync(idsFile, 'utf8').split(/\s+/).filter(Boolean)) : null;
  return readRecords(studioRoot).filter(({ record }) => !only || only.has(record.asset_id));
}

function frameCountFor(record, v) {
  const isVideo = String(record.mime_type ?? '').startsWith('video/');
  return isVideo ? frameTimes(Number(record.duration_seconds), v).length : 1;
}

function budgetExceeded(state, reserve, v) {
  if (state.spent + reserve > state.budget) return 'budget';
  if (state.history + state.spent + reserve > v.total_budget_usd) return 'total_budget';
  return null;
}

function recordOutcome(state, result) {
  state.spent += result.cost_usd ?? 0;
  if (result.error === 'provider_error') state.consecutiveErrors++;
  else state.consecutiveErrors = 0;
  if (result.status === 'ok') state.counts.ok++;
  else state.counts.failed++;
}

function writeResult(outFile, recordSha, result, state) {
  if (keepExisting(outFile, recordSha, result)) {
    state.counts.kept_existing++;
    return;
  }
  writeJsonAtomic(outFile, result);
}

async function processRecord(ctx, entry) {
  const { record, recordSha } = entry;
  const outFile = join(ctx.studioRoot, '99_Catalog', 'vision-checks', record.asset_id + '.json');
  if (existingOk(outFile, recordSha, ctx.model, ctx.v)) {
    ctx.state.counts.skipped_existing++;
    return null;
  }
  const frames = frameCountFor(record, ctx.v);
  const stop = budgetExceeded(ctx.state, reserveUsd(ctx.model, frames, ctx.v), ctx.v);
  if (stop) return stop;
  ctx.state.processed++;
  let result;
  try {
    result = await checkAsset({
      record, recordSha, studioRoot: ctx.studioRoot, client: ctx.client, model: ctx.model, v: ctx.v, now: ctx.now,
    });
  } catch {
    return 'provider_fatal';
  }
  writeResult(outFile, recordSha, result, ctx.state);
  recordOutcome(ctx.state, result);
  if (ctx.state.consecutiveErrors >= ctx.v.max_consecutive_provider_errors) return 'provider_unstable';
  return null;
}

function buildSummary(runId, model, flags, state, stopped) {
  return {
    event: 'media_library_vision_check',
    run_id: runId,
    model,
    budget_usd: flags.budget,
    spent_usd: round6(state.spent),
    historical_spent_usd: round6(state.history),
    total_budget_usd: state.v.total_budget_usd,
    ...state.counts,
    stopped_reason: stopped,
  };
}

export async function runVision(argv, { clientFactory } = {}) {
  const flags = parseFlags(argv);
  const policy = loadPolicy();
  const v = policy.vision;
  const model = flags.model ?? v.default_model;
  const invalid = validateFlags(flags, v, model);
  if (invalid) return invalid;
  if (!clientFactory && !flags.envFile) {
    console.error(usage());
    return 2;
  }
  const client = makeClient(flags, clientFactory);
  const runId = newRunId();
  const now = new Date().toISOString();
  const records = selectRecords(flags.studioRoot, flags.idsFile);
  const state = {
    counts: { ok: 0, failed: 0, skipped_existing: 0, kept_existing: 0 },
    spent: 0, history: historicalSpendUsd(flags.studioRoot), budget: flags.budget,
    consecutiveErrors: 0, processed: 0, v,
  };
  const ctx = { studioRoot: flags.studioRoot, client, model, v, now, state };
  let stopped = null;
  for (const entry of records) {
    if (flags.limit !== null && Number.isFinite(flags.limit) && state.processed >= flags.limit) break;
    stopped = await processRecord(ctx, entry);
    if (stopped) break;
  }
  const summary = buildSummary(runId, model, flags, state, stopped);
  writeJsonAtomic(join(flags.studioRoot, '99_Catalog', 'vision-runs', runId + '.json'), summary);
  console.log(JSON.stringify(summary));
  return stopped === 'provider_fatal' ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runVision(process.argv.slice(2));
}
