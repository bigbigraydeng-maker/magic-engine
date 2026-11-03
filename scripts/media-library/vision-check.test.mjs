// @vitest-environment node
import { test, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  frameTimes,
  parseResult,
  costUsd,
  reserveUsd,
  checkAsset,
  runVision,
} from './vision-check.mjs';
import { loadPolicy } from './review.mjs';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const policy = loadPolicy();
const v = policy.vision;

const clean = { brand: { verdict: 'no', seen_text: '' }, children: 'no', face: 'no', watermark: 'no' };

function makeStudio() {
  const root = mkdtempSync(join(tmpdir(), 'vision-check-'));
  mkdirSync(join(root, '99_Catalog', 'asset-records'), { recursive: true });
  return root;
}

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function addVideo(root, id, seconds) {
  const dir = join(root, '99_Catalog', 'registered-originals', id);
  mkdirSync(dir, { recursive: true });
  const out = join(dir, 'original.mp4');
  const r = spawnSync('ffmpeg', [
    '-v', 'error',
    '-f', 'lavfi',
    '-i', `color=c=blue:s=320x568:d=${seconds}`,
    '-pix_fmt', 'yuv420p',
    out,
  ]);
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + String(r.stderr));
  const record = {
    asset_id: id,
    object_path: 'x/originals/' + id + '.mp4',
    filename: 'clip.mp4',
    mime_type: 'video/mp4',
    sha256: sha256File(out),
    duration_seconds: seconds,
    width: 320,
    height: 568,
    native_aspect: 'portrait',
    source: 'stock',
    source_url: 'https://www.pexels.com/video/1/',
    license_evidence: 'x',
    tags: { subject: ['sea'], people_present: false },
  };
  writeFileSync(join(root, '99_Catalog', 'asset-records', id + '.json'), JSON.stringify(record, null, 2));
  return record;
}

function fakeClient(responses) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (body) => {
        calls.push(body);
        const r = responses.shift();
        if (r instanceof Error) throw r;
        return r;
      },
    },
  };
}

function okResponse(model = 'claude-haiku-5-5', usage = { input_tokens: 10000, output_tokens: 200 }, payload = clean) {
  return {
    model,
    usage,
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  };
}

test('frameTimes samples short and long videos', () => {
  expect(frameTimes(8, v)).toEqual([1.25, 3.75, 6.25]);
  expect(frameTimes(4, v)).toEqual([0.4, 2, 3.6]);
  const long = frameTimes(60, v);
  expect(long.length).toBe(12);
  expect(long[0]).toBe(2.5);
  expect(frameTimes(NaN, v)).toEqual([0]);
});

test('parseResult validates shape strictly', () => {
  const fenced = '```json\n' + JSON.stringify(clean) + '\n```';
  expect(parseResult(fenced)).toEqual(clean);
  expect(() => parseResult(JSON.stringify({ ...clean, extra: 1 }))).toThrow('invalid_shape');
  expect(() => parseResult(JSON.stringify({ ...clean, children: 'maybe' }))).toThrow('invalid_shape');
  expect(() => parseResult(JSON.stringify({ ...clean, brand: { verdict: 'no', seen_text: 5 } }))).toThrow('invalid_shape');
});

test('costUsd computes haiku cost', () => {
  expect(costUsd('claude-haiku-5-5', { input_tokens: 10000, output_tokens: 200 }, v)).toBe(0.0011);
});

test.skipIf(!hasFfmpeg)('checkAsset ok path', async () => {
  const root = makeStudio();
  try {
    const record = addVideo(root, 'a1', 8);
    const recordSha = sha256File(join(root, '99_Catalog', 'asset-records', 'a1.json'));
    const client = fakeClient([okResponse()]);
    const result = await checkAsset({
      record, recordSha, studioRoot: root, client, model: 'claude-haiku-5-5', v, now: 'now',
    });
    expect(result.status).toBe('ok');
    expect(result.frame_count).toBe(3);
    expect(client.calls.length).toBe(1);
    const content = client.calls[0].messages[0].content;
    expect(content.filter((b) => b.type === 'image').length).toBe(3);
    expect(content.filter((b) => b.type === 'text').length).toBe(1);
    expect(client.calls[0].model).toBe('claude-haiku-5-5');
    expect(result.cost_usd).toBe(0.0011);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test.skipIf(!hasFfmpeg)('checkAsset model mismatch', async () => {
  const root = makeStudio();
  try {
    const record = addVideo(root, 'a2', 8);
    const recordSha = sha256File(join(root, '99_Catalog', 'asset-records', 'a2.json'));
    const client = fakeClient([okResponse('claude-sonnet-5-5')]);
    const result = await checkAsset({
      record, recordSha, studioRoot: root, client, model: 'claude-haiku-5-5', v, now: 'now',
    });
    expect(result.status).toBe('vision_failed');
    expect(result.error).toBe('model_mismatch');
    expect(typeof result.cost_usd).toBe('number');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test.skipIf(!hasFfmpeg)('checkAsset hash mismatch skips client', async () => {
  const root = makeStudio();
  try {
    const record = addVideo(root, 'a3', 8);
    record.sha256 = 'f'.repeat(64);
    const recordSha = sha256File(join(root, '99_Catalog', 'asset-records', 'a3.json'));
    const client = fakeClient([okResponse()]);
    const result = await checkAsset({
      record, recordSha, studioRoot: root, client, model: 'claude-haiku-5-5', v, now: 'now',
    });
    expect(result.error).toBe('hash_mismatch');
    expect(client.calls.length).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test.skipIf(!hasFfmpeg)('runVision stops on budget', async () => {
  const root = makeStudio();
  try {
    addVideo(root, 'b1', 8);
    addVideo(root, 'b2', 8);
    addVideo(root, 'b3', 8);
    const reserve = reserveUsd('claude-haiku-5-5', 3, v);
    const budget = 0.0011 + reserve + 0.00001;
    const client = fakeClient([okResponse(), okResponse(), okResponse()]);
    const code = await runVision(
      [root, '--budget-usd', String(budget)],
      { clientFactory: () => client },
    );
    expect(code).toBe(0);
    expect(client.calls.length).toBe(2);
    const checks = readdirSync(join(root, '99_Catalog', 'vision-checks'));
    expect(checks.length).toBe(2);
    const runs = readdirSync(join(root, '99_Catalog', 'vision-runs'));
    expect(runs.length).toBe(1);
    const summary = JSON.parse(readFileSync(join(root, '99_Catalog', 'vision-runs', runs[0]), 'utf8'));
    expect(summary.stopped_reason).toBe('budget');
    expect(summary.spent_usd).toBeLessThanOrEqual(summary.budget_usd);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test.skipIf(!hasFfmpeg)('runVision stops on fatal provider error', async () => {
  const root = makeStudio();
  try {
    addVideo(root, 'c1', 8);
    const fatal = Object.assign(new Error('credit balance is too low'), { status: 400 });
    const client = fakeClient([fatal]);
    const code = await runVision(
      [root, '--budget-usd', '10'],
      { clientFactory: () => client },
    );
    expect(code).toBe(1);
    const runs = readdirSync(join(root, '99_Catalog', 'vision-runs'));
    const summary = JSON.parse(readFileSync(join(root, '99_Catalog', 'vision-runs', runs[0]), 'utf8'));
    expect(summary.stopped_reason).toBe('provider_fatal');
    const checksDir = join(root, '99_Catalog', 'vision-checks');
    const checks = existsSync(checksDir) ? readdirSync(checksDir) : [];
    expect(checks.length).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test.skipIf(!hasFfmpeg)('runVision skips existing ok vision file', async () => {
  const root = makeStudio();
  try {
    const record = addVideo(root, 'd1', 8);
    const recordSha = sha256File(join(root, '99_Catalog', 'asset-records', 'd1.json'));
    const checksDir = join(root, '99_Catalog', 'vision-checks');
    mkdirSync(checksDir, { recursive: true });
    writeFileSync(
      join(checksDir, 'd1.json'),
      JSON.stringify({ status: 'ok', record_sha256: recordSha, asset_id: record.asset_id }),
    );
    const client = fakeClient([]);
    const code = await runVision(
      [root, '--budget-usd', '10'],
      { clientFactory: () => client },
    );
    expect(code).toBe(0);
    expect(client.calls.length).toBe(0);
    const runs = readdirSync(join(root, '99_Catalog', 'vision-runs'));
    const summary = JSON.parse(readFileSync(join(root, '99_Catalog', 'vision-runs', runs[0]), 'utf8'));
    expect(summary.skipped_existing).toBe(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runVision rejects disallowed model', async () => {
  const root = makeStudio();
  try {
    const code = await runVision(
      [root, '--budget-usd', '10', '--model', 'gpt-4o'],
      { clientFactory: () => fakeClient([]) },
    );
    expect(code).toBe(2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
