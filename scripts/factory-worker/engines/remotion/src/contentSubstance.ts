import { FPS } from './timing.ts';
import { computeTimingFromProps } from './timing.ts';
import { computePostcardTiming } from './postcard.ts';
import { computeDataCardTiming } from './datacard.ts';
import { computeAtmosphereTiming } from './atmosphere.ts';
import { computeCompareTiming } from './compare.ts';
import { montageFrameOf } from './montage.ts';
import { overlayWindows, resolveFramePlan, type ResolvedHook } from './frame.ts';
import { styledPostcardTiming } from './styles/rules.ts';
import { styledDataCardTiming, styledListTiming, styledMontageTiming, type CraftLook } from './styles/template-craft.ts';

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

function craftLook(props: Record<string, unknown>): CraftLook | null {
  const look = asRecord(props.look);
  const craft = look ? asRecord(look.craft) : null;
  const rules = look ? asRecord(look.rules) : null;
  if (!look || !craft || !rules || typeof craft.shotSec !== 'number') return null;
  return look as unknown as CraftLook;
}

function collectList(props: Record<string, unknown>): SubstanceElement[] {
  const out: SubstanceElement[] = [];
  const look = craftLook(props);
  const items = asArray(props.items);
  const timing = look
    ? styledListTiming(items.length, look, FPS, props.logoMode === 'always' ? 'always' : 'last_beats')
    : computeTimingFromProps(props as never);
  const hook = asRecord(props.hook);
  const hookLines = hook ? asArray(hook.lines) : [];
  const hookEnd = timing.hookFrames / FPS;
  for (const raw of hookLines) {
    const line = asRecord(raw);
    if (!line) continue;
    const text = typeof line.text === 'string' ? line.text : '';
    out.push({ kind: 'hook_text', text, startSec: 0, endSec: hookEnd });
  }
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
  if (look) {
    const first = asRecord(items[0]);
    const point = first && typeof first.text === 'string' ? first.text : revealTitle;
    out.push({ kind: 'selling_line', text: point, startSec: 0, endSec: timing.totalFrames / FPS });
  }
  return out;
}

function postcardClock(props: Record<string, unknown>) {
  const look = asRecord(props.look);
  const rules = look ? asRecord(look.rules) : null;
  const craft = look ? asRecord(look.craft) : null;
  if (!rules || !craft || typeof craft.shotSec !== 'number') return null;
  const shotSec = rules.shotFromBrief === true && typeof rules.shotSec === 'number' ? rules.shotSec : craft.shotSec;
  return styledPostcardTiming(props as never, rules as never, FPS, shotSec);
}

function hookTexts(hook: ResolvedHook): string[] {
  const texts = hook.lines.map((line) => line.text);
  if (hook.stat && !texts.includes(hook.stat)) texts.push(hook.stat);
  if (hook.question && !texts.includes(hook.question)) texts.push(hook.question);
  return texts;
}

function collectPlainPostcard(props: Record<string, unknown>): SubstanceElement[] {
  const out: SubstanceElement[] = [];
  const timing = computePostcardTiming(props as never);
  const plan = resolveFramePlan('postcard', props);
  const hookLines = asArray(asRecord(props.hook)?.lines);
  const hookEnd = timing.hookFrames / FPS;
  const shownHook = plan.hook ? hookTexts(plan.hook) : hookLines.map((raw) => (typeof raw === 'string' ? raw : ''));
  for (const text of shownHook) {
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
      text: plan.endCard ? plan.endCard.cta : title,
      startSec: timing.priceFrom / FPS,
      endSec: timing.totalFrames / FPS,
    });
  } else if (plan.endCard) {
    const windows = overlayWindows(timing.totalFrames);
    if (windows.endFrames > 0) {
      out.push({
        kind: 'brand_card',
        text: plan.endCard.cta,
        startSec: windows.endFrom / FPS,
        endSec: timing.totalFrames / FPS,
      });
    }
  }
  return out;
}

function collectStyledPostcard(props: Record<string, unknown>): SubstanceElement[] {
  const timing = postcardClock(props) ?? computePostcardTiming(props as never);
  const out: SubstanceElement[] = [];
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
    out.push({ kind: 'brand_card', text: title, startSec: timing.priceFrom / FPS, endSec: timing.totalFrames / FPS });
  }
  const first = asRecord(scenes[0]);
  const point = first && typeof first.line === 'string' ? first.line : '';
  out.push({ kind: 'selling_line', text: point, startSec: 0, endSec: timing.totalFrames / FPS });
  return out;
}

function collectPostcard(props: Record<string, unknown>): SubstanceElement[] {
  return postcardClock(props) ? collectStyledPostcard(props) : collectPlainPostcard(props);
}

function collectCompare(props: Record<string, unknown>): SubstanceElement[] {
  const look = asRecord(props.look);
  const rules = look ? asRecord(look.rules) : null;
  const craft = look ? asRecord(look.craft) : null;
  const shotSec = rules?.shotFromBrief === true && typeof rules.shotSec === 'number'
    ? rules.shotSec
    : (craft && typeof craft.shotSec === 'number' ? craft.shotSec : undefined);
  const plan = computeCompareTiming(rules as never, shotSec);
  const out: SubstanceElement[] = [];
  const point = typeof props.point === 'string' ? props.point : '';
  out.push({ kind: 'selling_line', text: point, startSec: 0, endSec: plan.totalFrames / FPS });
  for (const shot of plan.shots) {
    const beat = asRecord(props[shot.lineKey]);
    const line = beat && typeof beat.line === 'string' ? beat.line : '';
    out.push({
      kind: 'selling_line',
      text: line,
      startSec: shot.from / FPS,
      endSec: (shot.from + shot.frames) / FPS,
    });
  }
  return out;
}

function collectDataCard(props: Record<string, unknown>): SubstanceElement[] {
  const out: SubstanceElement[] = [];
  const look = craftLook(props);
  const rows = asArray(props.rows);
  const timing = look
    ? styledDataCardTiming(rows.map((row) => ({ value: String((asRecord(row) ?? {}).value ?? '') })), look, FPS)
    : computeDataCardTiming(props as never);
  const hook = asRecord(props.hook);
  const hookLines = hook ? asArray(hook.lines) : [];
  const hookEnd = timing.hookFrames / FPS;
  for (const raw of hookLines) {
    const text = typeof raw === 'string' ? raw : '';
    out.push({ kind: 'hook_text', text, startSec: 0, endSec: hookEnd });
  }
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
  const timing = computeAtmosphereTiming(props as never);
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
  const look = craftLook(props);
  const beats = asArray(props.beats).filter((b): b is number => typeof b === 'number');
  if (look) {
    const words = asArray(props.words);
    const clips = asArray(props.clips);
    const plan = styledMontageTiming(clips.length, words.length, look, FPS);
    words.forEach((raw, i) => {
      const word = asRecord(raw);
      const text = word && typeof word.text === 'string' ? word.text : '';
      const from = plan.shots === 1 ? 0 : (i % plan.shots) * plan.shotFrames;
      const to = plan.shots === 1 ? plan.totalFrames : from + plan.shotFrames;
      out.push({ kind: 'kinetic_words', text, startSec: from / FPS, endSec: to / FPS });
    });
    return out;
  }
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

export function contentSubstanceOf(template: string, props: unknown): ContentSubstance {
  const record = asRecord(props) ?? {};

  let elements: SubstanceElement[];
  let minSeconds = MIN_VISIBLE_SEC;
  let isMontage = false;

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
    case 'compare':
      elements = collectCompare(record);
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
