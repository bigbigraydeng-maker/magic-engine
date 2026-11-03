// Server-side twin of scripts/factory-worker/engines/remotion/src/contentSubstance.ts.
// This file MUST stay in lockstep with the engine file: same behaviour, same Chinese reason strings,
// same kinds, same thresholds. src/lib/factory/content-substance.parity.test.mjs compares both.
// The engine is not part of the Next runtime, so nothing here may import from it.

export type SubstanceKind =
  | 'place_or_tour'
  | 'selling_line'
  | 'brand_card'
  | 'hook_text'
  | 'kinetic_words';

export interface SubstanceElement {
  kind: SubstanceKind;
  text: string;
  startSec: number;
  endSec: number;
}

export interface ContentSubstance {
  verdict: 'pass' | 'fail';
  kinds: SubstanceKind[];
  textSeconds: number;
  reason: string;
  texts: string[];
}

const FPS = 30;

// Removes zero-width / bidi / control characters, collapses whitespace, trims.
const INVISIBLE_RE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u2800\u3164\ufe00-\ufe0f\ufeff\uffa0]/g;

export function cleanText(s: string): string {
  if (typeof s !== 'string') return '';
  // The worker's own clean() invisible/bidi/control set, widened with the Hangul/Khmer/Mongolian fillers that NFKC
  // produces, applied before and after NFKC normalisation, so text that renders as blanks never counts as content.
  return s
    .replace(INVISIBLE_RE, '')
    .normalize('NFKC')
    .replace(INVISIBLE_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const LETTER_RE = /\p{L}/u;
const HAN_LETTER_RE = /\p{Script=Han}/u;

// After cleanText: counts LETTERS (not characters): at least 3 letters, or at least 2 when every letter is Han script.
// Price-like text (currency symbols / digits / punctuation / spaces only) therefore never counts, and neither do
// strings padded with digits, punctuation or combining marks.
export function isSubstantive(s: string): boolean {
  const t = cleanText(s);
  if (t.length === 0) return false;
  const letters = Array.from(t).filter((c) => LETTER_RE.test(c));
  if (letters.length === 0) return false;
  const allHan = letters.every((c) => HAN_LETTER_RE.test(c));
  return allHan ? letters.length >= 2 : letters.length >= 3;
}

// Total length of the union of intervals, rounded to 2 decimals.
export function unionSeconds(intervals: Array<[number, number]>): number {
  const valid = intervals
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
    .map(([a, b]): [number, number] => [a, b])
    .sort((x, y) => x[0] - y[0]);
  if (valid.length === 0) return 0;
  let total = 0;
  let curStart = valid[0][0];
  let curEnd = valid[0][1];
  for (let i = 1; i < valid.length; i++) {
    const [a, b] = valid[i];
    if (a <= curEnd) {
      if (b > curEnd) curEnd = b;
    } else {
      total += curEnd - curStart;
      curStart = a;
      curEnd = b;
    }
  }
  total += curEnd - curStart;
  return Math.round(total * 100) / 100;
}

const MIN_VISIBLE_SEC = 2.0;
const MONTAGE_MIN_SEC = 3.0;

interface Counted {
  kind: SubstanceKind;
  text: string;
  startSec: number;
  endSec: number;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// ---------------------------------------------------------------------------
// Local timing helpers (mirror the engine's timing modules).
// ---------------------------------------------------------------------------

const HOOK_BEATS = 4;
const ITEM_BEATS = 2;
const REVEAL_BEATS = 8;

function fb(beats: number[], i: number): number {
  return Math.round(Math.max(0, beats[i]) * FPS) + 1;
}

interface ListTiming {
  hookFrames: number;
  itemFrom: number[];
  itemDur: number[];
  revealFrom: number;
  totalFrames: number;
}

function computeListTiming(props: Record<string, unknown>): ListTiming {
  const beats = asArray(props.beats).filter((b): b is number => typeof b === 'number');
  const items = asArray(props.items);
  const itemCount = items.length;
  const needed = HOOK_BEATS + ITEM_BEATS * itemCount + REVEAL_BEATS + 1;
  if (beats.length < needed) {
    throw new Error('list timing: not enough beats');
  }
  const hookFrames = fb(beats, HOOK_BEATS);
  const itemFrom: number[] = [];
  const itemDur: number[] = [];
  for (let i = 0; i < itemCount; i++) {
    const from = fb(beats, HOOK_BEATS + ITEM_BEATS * i);
    const to = fb(beats, HOOK_BEATS + ITEM_BEATS * (i + 1));
    const dur = to - from;
    if (dur < 1) throw new Error('list timing: item duration < 1');
    itemFrom.push(from);
    itemDur.push(dur);
  }
  const revealFrom = fb(beats, HOOK_BEATS + ITEM_BEATS * itemCount);
  const totalFrames = fb(beats, HOOK_BEATS + ITEM_BEATS * itemCount + REVEAL_BEATS);
  if (totalFrames - revealFrom < 1) {
    throw new Error('list timing: reveal duration < 1');
  }
  // Same floor as the engine (MIN_TOTAL_FRAMES = 60): a shorter reel is refused there too.
  if (totalFrames < 60) {
    throw new Error('list timing: total frames < 60');
  }
  return { hookFrames, itemFrom, itemDur, revealFrom, totalFrames };
}

interface PostcardTiming {
  hookFrames: number;
  sceneFrom: number[];
  sceneDur: number[];
  priceFrom: number;
  totalFrames: number;
}

function computePostcardTiming(props: Record<string, unknown>): PostcardTiming {
  const timing = asRecord(props.timing);
  if (!timing) throw new Error('postcard timing: missing timing');
  const hookSec = asNumber(timing.hookSec);
  const sceneSec = asNumber(timing.sceneSec);
  const priceSec = asNumber(timing.priceSec);
  if (hookSec === null || sceneSec === null || priceSec === null) {
    throw new Error('postcard timing: missing numbers');
  }
  const scenes = asArray(props.scenes);
  const hookFrames = Math.round(hookSec * FPS);
  const sceneDur: number[] = [];
  const sceneFrom: number[] = [];
  let cursor = hookFrames;
  for (let i = 0; i < scenes.length; i++) {
    const dur = Math.round(sceneSec * FPS);
    sceneFrom.push(cursor);
    sceneDur.push(dur);
    cursor += dur;
  }
  const priceFrom = cursor;
  const totalFrames = priceFrom + Math.round(priceSec * FPS);
  return { hookFrames, sceneFrom, sceneDur, priceFrom, totalFrames };
}

interface DataCardTiming {
  hookFrames: number;
  rowFrom: number[];
  totalFrames: number;
}

function computeDataCardTiming(props: Record<string, unknown>): DataCardTiming {
  const hookSec = asNumber(props.hookSec);
  const rowSec = asNumber(props.rowSec);
  const holdSec = asNumber(props.holdSec);
  if (hookSec === null || rowSec === null || holdSec === null) {
    throw new Error('datacard timing: missing numbers');
  }
  const rows = asArray(props.rows);
  const hookFrames = Math.round(hookSec * FPS);
  const rowFrames = Math.round(rowSec * FPS);
  const rowFrom: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    rowFrom.push(hookFrames + i * rowFrames);
  }
  const totalFrames = hookFrames + rows.length * rowFrames + Math.round(holdSec * FPS);
  return { hookFrames, rowFrom, totalFrames };
}

interface AtmosphereTiming {
  totalFrames: number;
  fadeInFrames: number;
  fadeOutFrames: number;
}

function computeAtmosphereTiming(props: Record<string, unknown>): AtmosphereTiming {
  const durationSec = asNumber(props.durationSec);
  if (durationSec === null) throw new Error('atmosphere timing: missing durationSec');
  const fadeInSec = asNumber(props.fadeInSec) ?? 0.8;
  const fadeOutSec = asNumber(props.fadeOutSec) ?? 1.5;
  const totalFrames = Math.round(durationSec * FPS);
  const fadeInFrames = Math.round(fadeInSec * FPS);
  const fadeOutFrames = Math.round(fadeOutSec * FPS);
  return { totalFrames, fadeInFrames, fadeOutFrames };
}

function montageFrameOf(beats: number[], i: number): number {
  return i === 0 ? 0 : Math.round(Math.max(0, beats[i]) * FPS) + 2;
}

// ---------------------------------------------------------------------------
// Per-template collectors (copied from the engine file).
// ---------------------------------------------------------------------------

function collectList(props: Record<string, unknown>): SubstanceElement[] {
  const out: SubstanceElement[] = [];
  const timing = computeListTiming(props);
  const hook = asRecord(props.hook);
  const hookLines = hook ? asArray(hook.lines) : [];
  const hookEnd = timing.hookFrames / FPS;
  for (const raw of hookLines) {
    const line = asRecord(raw);
    if (!line) continue;
    const text = typeof line.text === 'string' ? line.text : '';
    out.push({ kind: 'hook_text', text, startSec: 0, endSec: hookEnd });
  }
  const items = asArray(props.items);
  for (let i = 0; i < items.length; i++) {
    const item = asRecord(items[i]);
    if (!item) continue;
    const from = timing.itemFrom[i];
    const dur = timing.itemDur[i];
    if (from === undefined || dur === undefined) continue;
    const text = typeof item.text === 'string' ? item.text : '';
    out.push({
      kind: 'place_or_tour',
      text,
      startSec: from / FPS,
      endSec: (from + dur) / FPS,
    });
  }
  const revealTitle = typeof props.revealTitle === 'string' ? props.revealTitle : '';
  out.push({
    kind: 'brand_card',
    text: revealTitle,
    startSec: timing.revealFrom / FPS,
    endSec: timing.totalFrames / FPS,
  });
  return out;
}

function collectPostcard(props: Record<string, unknown>): SubstanceElement[] {
  const out: SubstanceElement[] = [];
  const timing = computePostcardTiming(props);
  const hook = asRecord(props.hook);
  const hookLines = hook ? asArray(hook.lines) : [];
  const hookEnd = timing.hookFrames / FPS;
  for (const raw of hookLines) {
    const text = typeof raw === 'string' ? raw : '';
    out.push({ kind: 'hook_text', text, startSec: 0, endSec: hookEnd });
  }
  const scenes = asArray(props.scenes);
  for (let i = 0; i < scenes.length; i++) {
    const scene = asRecord(scenes[i]);
    if (!scene) continue;
    const from = timing.sceneFrom[i];
    const dur = timing.sceneDur[i];
    if (from === undefined || dur === undefined) continue;
    const startSec = from / FPS;
    const endSec = (from + dur) / FPS;
    const place = typeof scene.place === 'string' ? scene.place : '';
    out.push({ kind: 'place_or_tour', text: place, startSec, endSec });
    const sourced = isNonEmptyString(scene.sourceUrl) && isNonEmptyString(scene.sourceQuote);
    if (sourced) {
      const line = typeof scene.line === 'string' ? scene.line : '';
      out.push({ kind: 'selling_line', text: line, startSec, endSec });
    }
  }
  const end = asRecord(props.end);
  if (end) {
    const title = typeof end.title === 'string' ? end.title : '';
    out.push({
      kind: 'brand_card',
      text: title,
      startSec: timing.priceFrom / FPS,
      endSec: timing.totalFrames / FPS,
    });
  }
  return out;
}

function collectDataCard(props: Record<string, unknown>): SubstanceElement[] {
  const out: SubstanceElement[] = [];
  const timing = computeDataCardTiming(props);
  const hook = asRecord(props.hook);
  const hookLines = hook ? asArray(hook.lines) : [];
  const hookEnd = timing.hookFrames / FPS;
  for (const raw of hookLines) {
    const text = typeof raw === 'string' ? raw : '';
    out.push({ kind: 'hook_text', text, startSec: 0, endSec: hookEnd });
  }
  const rows = asArray(props.rows);
  for (let i = 0; i < rows.length; i++) {
    const row = asRecord(rows[i]);
    if (!row) continue;
    const from = timing.rowFrom[i];
    if (from === undefined) continue;
    // Rows stay on screen from their reveal until the end (DataCardReel keeps every row's Sequence to totalFrames).
    const endFrame = timing.totalFrames;
    const label = typeof row.label === 'string' ? row.label : '';
    out.push({
      kind: 'selling_line',
      text: label,
      startSec: from / FPS,
      endSec: endFrame / FPS,
    });
  }
  return out;
}

function collectAtmosphere(props: Record<string, unknown>): SubstanceElement[] {
  const out: SubstanceElement[] = [];
  const timing = computeAtmosphereTiming(props);
  const line = asRecord(props.line);
  if (!line) return out;
  const sourced = isNonEmptyString(line.sourceUrl) && isNonEmptyString(line.sourceQuote);
  if (!sourced) return out;
  const text = typeof line.text === 'string' ? line.text : '';
  out.push({
    kind: 'selling_line',
    text,
    startSec: (timing.fadeInFrames + 18) / FPS,
    endSec: (timing.totalFrames - timing.fadeOutFrames) / FPS,
  });
  return out;
}

function collectMontage(props: Record<string, unknown>): SubstanceElement[] {
  const out: SubstanceElement[] = [];
  const beats = asArray(props.beats).filter((b): b is number => typeof b === 'number');
  if (beats.length === 0) return out;
  const words = asArray(props.words);
  for (const raw of words) {
    const word = asRecord(raw);
    if (!word) continue;
    const at = asNumber(word.at);
    const wBeats = asNumber(word.beats);
    if (at === null || wBeats === null) continue;
    const text = typeof word.text === 'string' ? word.text : '';
    const startFrame = montageFrameOf(beats, at);
    const endFrame = montageFrameOf(beats, at + wBeats);
    out.push({
      kind: 'kinetic_words',
      text,
      startSec: startFrame / FPS,
      endSec: endFrame / FPS,
    });
  }
  return out;
}

function describeFound(elements: SubstanceElement[]): string {
  if (elements.length === 0) return '未发现任何文字元素';
  const parts: string[] = [];
  for (const el of elements) {
    const cleaned = cleanText(el.text);
    const dur = Math.round((el.endSec - el.startSec) * 100) / 100;
    if (!isSubstantive(el.text)) {
      parts.push(`${el.kind}「${cleaned || '空'}」非有效文字`);
    } else if (dur < MIN_VISIBLE_SEC) {
      parts.push(`${el.kind}「${cleaned}」仅 ${dur} 秒`);
    }
  }
  if (parts.length === 0) return '文字存在但总时长不足';
  return parts.slice(0, 6).join('；');
}

const TIMING_ERROR_REASON = '工单的视频参数无法计算时间轴，内容闸不放行';

export function contentSubstanceOf(template: string, props: unknown): ContentSubstance {
  const record = asRecord(props) ?? {};

  let elements: SubstanceElement[];
  let minSeconds = MIN_VISIBLE_SEC;
  let isMontage = false;

  try {
    switch (template) {
      case 'list':
        elements = collectList(record);
        break;
      case 'postcard':
        elements = collectPostcard(record);
        break;
      case 'datacard':
        elements = collectDataCard(record);
        break;
      case 'atmosphere':
        elements = collectAtmosphere(record);
        break;
      case 'montage':
        elements = collectMontage(record);
        minSeconds = MONTAGE_MIN_SEC;
        isMontage = true;
        break;
      default:
        return {
          verdict: 'fail',
          kinds: [],
          textSeconds: 0,
          reason: '未知模板：内容闸不放行',
          texts: [],
        };
    }
  } catch {
    return {
      verdict: 'fail',
      kinds: [],
      textSeconds: 0,
      reason: TIMING_ERROR_REASON,
      texts: [],
    };
  }

  const counted: Counted[] = [];
  for (const el of elements) {
    // Hook lines are collected for the record but never count: a hook alone is a slogan, not content.
    if (el.kind === 'hook_text') continue;
    if (!isSubstantive(el.text)) continue;
    const dur = el.endSec - el.startSec;
    if (!isMontage && dur < MIN_VISIBLE_SEC) continue;
    if (dur <= 0) continue;
    counted.push({
      kind: el.kind,
      text: cleanText(el.text),
      startSec: el.startSec,
      endSec: el.endSec,
    });
  }

  const intervals: Array<[number, number]> = counted.map((c) => [c.startSec, c.endSec]);
  const textSeconds = unionSeconds(intervals);

  const kinds: SubstanceKind[] = [];
  for (const c of counted) {
    if (!kinds.includes(c.kind)) kinds.push(c.kind);
  }

  const texts: string[] = [];
  for (const c of counted) {
    if (texts.length >= 20) break;
    texts.push(c.text);
  }

  const pass = counted.length > 0 && textSeconds >= minSeconds;

  if (pass) {
    return {
      verdict: 'pass',
      kinds,
      textSeconds,
      reason: '屏幕上有可见文字：' + kinds.join('、'),
      texts,
    };
  }

  return {
    verdict: 'fail',
    kinds,
    textSeconds,
    reason:
      '整条片屏幕上没有连续可见 ≥2 秒的有效文字（团名/地点/卖点/品牌卡）：' +
      describeFound(elements),
    texts,
  };
}

export const CONTENT_SUBSTANCE_CAPABILITY = 'content_substance_v1'

export interface RemotionSubstanceAssessment {
  /** False for non-remotion orders: the gate does not apply. */
  applicable: boolean
  assetOnly: boolean
  server: ContentSubstance | null
  /** What the worker reported (audit only, never trusted for the verdict). */
  reported: { verdict: string; kinds: string[]; textSeconds: number; reason: string } | null
  /** True when the worker receipt advertises the content-substance capability. */
  capable: boolean
  /** Server and worker disagree on pass/fail (asset_only counts as pass). */
  mismatch: boolean
}

function asRec(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/**
 * Server-side recompute for a finished remotion order. The verdict comes from the order's own props (written by the
 * order creator, not by the worker); the worker's report is kept for audit and to detect an old/bypassed worker.
 */
export function assessRemotionContentSubstance(
  brief: unknown,
  evidence: { content_substance?: RemotionSubstanceAssessment['reported']; capabilities?: string[] } | null | undefined,
): RemotionSubstanceAssessment {
  const briefRec = asRec(brief)
  const remotion = asRec(briefRec?.remotion)
  const claimsRemotion = briefRec?.engine === 'remotion' || (briefRec !== null && briefRec.remotion !== undefined && briefRec.remotion !== null)
  if (!claimsRemotion) {
    return { applicable: false, assetOnly: false, server: null, reported: null, capable: false, mismatch: false }
  }
  const reportedEarly = evidence?.content_substance ?? null
  const capableEarly = Array.isArray(evidence?.capabilities) && evidence.capabilities.includes(CONTENT_SUBSTANCE_CAPABILITY)
  if (!remotion || typeof remotion.template !== 'string' || asRec(remotion.props) === null) {
    // A remotion order whose brief.remotion is missing or malformed must never skip the gate.
    return {
      applicable: true,
      assetOnly: false,
      server: { verdict: 'fail', kinds: [], textSeconds: 0, reason: '工单的 brief.remotion 缺失或畸形，内容闸不放行', texts: [] },
      reported: reportedEarly,
      capable: capableEarly,
      mismatch: false,
    }
  }
  const assetOnly = remotion.deliverable === 'asset_only'
  const server = contentSubstanceOf(remotion.template, remotion.props)
  const reported = evidence?.content_substance ?? null
  const capable = Array.isArray(evidence?.capabilities) && evidence.capabilities.includes(CONTENT_SUBSTANCE_CAPABILITY)
  const serverPass = assetOnly || server.verdict === 'pass'
  const reportedPass = reported !== null && (reported.verdict === 'pass' || reported.verdict === 'asset_only')
  return { applicable: true, assetOnly, server, reported, capable, mismatch: reported !== null && serverPass !== reportedPass }
}
