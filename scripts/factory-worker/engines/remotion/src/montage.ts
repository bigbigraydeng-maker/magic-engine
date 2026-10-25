import { z } from 'zod';
import { FPS } from './timing.ts';
import {
  HEX_COLOR,
  CLIP_EXTS,
  LOGO_EXTS,
  MUSIC_EXTS,
  relFile,
  text,
  formatZodIssues,
} from './schema.ts';

/** Allowed clip kinds for the montage pool. */
export const CLIP_KINDS = ['aerial', 'street', 'person', 'detail'] as const;
/** Allowed word background styles. */
export const WORD_BGS = ['black', 'brand', 'white'] as const;
/** Minimum number of words. */
export const MONTAGE_MIN_WORDS = 10;
/** Maximum number of words. */
export const MONTAGE_MAX_WORDS = 30;
/** Minimum number of clips in the pool. */
export const MONTAGE_MIN_CLIPS = 8;
/** Minimum number of distinct clip kinds. */
export const MONTAGE_MIN_KINDS = 3;
/** Maximum total video length in seconds. */
export const MONTAGE_MAX_SECONDS = 20;
/** Frame shift applied to every beat after the first for sync. */
export const MONTAGE_SYNC_SHIFT_FRAMES = 2;
/** Number of beats the logo stays on screen at the end. */
export const MONTAGE_LOGO_BEATS = 2;
/** Minimum total frames for a montage. */
export const MONTAGE_MIN_TOTAL_FRAMES = 60;
/** Shortest allowed gap between two beats; fast bars halve it. */
export const MONTAGE_MIN_BEAT_GAP_SEC = 0.25;
/** Photosensitivity cap: most flashes allowed in any one second. */
export const MONTAGE_MAX_FLASHES_PER_SEC = 3;

const SLUG = z
  .string()
  .regex(/^[a-z0-9-]{1,24}$/, { message: '标签只能是小写字母、数字和连字符' });

const WORD = z
  .object({
    at: z.number().int().min(0, { message: '词的起始拍必须是非负整数' }),
    beats: z
      .number()
      .int()
      .min(1, { message: '词的持续拍数必须是 1 到 3' })
      .max(3, { message: '词的持续拍数必须是 1 到 3' }),
    text: text(12),
    bg: z.enum(WORD_BGS),
    rot: z
      .number()
      .int()
      .min(-4, { message: '旋转角度必须在 -4 到 4 之间' })
      .max(4, { message: '旋转角度必须在 -4 到 4 之间' }),
    clipTag: SLUG.optional(),
  })
  .strict();

const CLIP = z
  .object({
    file: relFile('镜头文件', CLIP_EXTS),
    tag: SLUG,
    kind: z.enum(CLIP_KINDS),
    source: z.enum(['own', 'stock', 'ai']),
    lenFrames: z
      .number()
      .int()
      .min(30, { message: '镜头长度必须是 30 到 900 帧' })
      .max(900, { message: '镜头长度必须是 30 到 900 帧' }),
    luma: z
      .number()
      .min(1, { message: '亮度必须在 1 到 255 之间' })
      .max(255, { message: '亮度必须在 1 到 255 之间' })
      .optional(),
  })
  .strict();

const IMPACT_PLAN = z.object({
  hookTag: SLUG,
  buildTags: z.array(SLUG).min(4, { message: '冲击叙事中段至少要有 4 个不同场景' }).max(8),
  payoffTag: SLUG,
  hookBeats: z.number().int().min(1).max(4).default(2),
  payoffBeats: z.number().int().min(1).max(4).default(2),
}).strict();

const MontageBaseSchema = z
  .object({
    brandColor: z.string().regex(HEX_COLOR, {
      message: '颜色必须是 #RRGGBB 十六进制',
    }),
    logoFile: relFile('logo 文件', LOGO_EXTS),
    musicFile: relFile('音乐文件', MUSIC_EXTS),
    beats: z.array(z.number().finite().min(0).max(120)).max(120),
    totalBeats: z
      .number()
      .int()
      .min(16, { message: '总拍数必须是 16 到 64' })
      .max(64, { message: '总拍数必须是 16 到 64' }),
    fastBars: z.array(z.number().int().min(0)).min(1, {
      message: '快切小节至少要有一个',
    }),
    placeTerms: z.array(z.string().min(1).max(24)).max(30),
    words: z
      .array(WORD)
      .min(MONTAGE_MIN_WORDS, {
        message: `词数量最少 ${MONTAGE_MIN_WORDS} 个`,
      })
      .max(MONTAGE_MAX_WORDS, {
        message: `词数量最多 ${MONTAGE_MAX_WORDS} 个`,
      }),
    clips: z
      .array(CLIP)
      .min(MONTAGE_MIN_CLIPS, {
        message: `镜头池最少 ${MONTAGE_MIN_CLIPS} 个`,
      })
      .max(24, { message: '镜头池最多 24 个' }),
    /** Explicit hook → progression → payoff storyboard, required by the impact template. */
    impactPlan: IMPACT_PLAN.optional(),
  })
  .strict();

type MontageBase = z.infer<typeof MontageBaseSchema>;

/** Validate beats ordering, count and total duration. */
function checkBeats(val: MontageBase, ctx: z.RefinementCtx): void {
  const beats = val.beats;
  let increasing = true;
  for (let i = 1; i < beats.length; i++) {
    if (beats[i] <= beats[i - 1]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['beats'],
        message: '节拍必须严格递增',
      });
      increasing = false;
      break;
    }
  }
  if (increasing) {
    const last = Math.min(beats.length - 1, val.totalBeats);
    for (let i = 1; i <= last; i++) {
      const gap = beats[i] - beats[i - 1];
      if (gap < MONTAGE_MIN_BEAT_GAP_SEC) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['beats'],
          message: `节拍间隔太近：第 ${i} 拍与上一拍只差 ${gap.toFixed(3)} 秒（至少 ${MONTAGE_MIN_BEAT_GAP_SEC} 秒）`,
        });
        break;
      }
    }
  }
  const needed = val.totalBeats + 1;
  if (beats.length < needed) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['beats'],
      message: `节拍数量不够：需要 ${needed} 个，现在只有 ${beats.length} 个`,
    });
    return;
  }
  if (beats[val.totalBeats] > MONTAGE_MAX_SECONDS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['beats'],
      message: '成片总时长不能超过 20 秒',
    });
  }
}

/** Validate fastBars uniqueness and range. */
function checkFastBars(val: MontageBase, ctx: z.RefinementCtx): void {
  const limit = Math.floor(val.totalBeats / 4);
  const seen = new Set<number>();
  for (const bar of val.fastBars) {
    if (seen.has(bar)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fastBars'],
        message: `快切小节重复：${bar}`,
      });
      return;
    }
    seen.add(bar);
    if (bar >= limit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fastBars'],
        message: `快切小节 ${bar} 超出范围（必须小于 ${limit}）`,
      });
    }
  }
}

/** Validate word ordering, first-word rule and coverage. */
function checkWords(val: MontageBase, ctx: z.RefinementCtx): void {
  const words = val.words;
  const first = words[0];
  if (first !== undefined) {
    const okText = /^\d/.test(first.text) || /[?？]$/.test(first.text);
    if (first.at !== 0 || !okText) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['words', 0],
        message:
          '第一个词必须从第 0 拍开始，且是数字或问句（不许用风景空镜/普通词起手）',
      });
    }
  }
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.at + w.beats > val.totalBeats) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['words', i],
        message: `词「${w.text}」超出总拍数`,
      });
    }
    if (i > 0) {
      const prev = words[i - 1];
      if (w.at < prev.at) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['words', i],
          message: '词必须按起始拍排序',
        });
      } else if (prev.at + prev.beats > w.at) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['words', i],
          message: `词「${w.text}」与上一个词重叠`,
        });
      }
    }
  }
}

/** Validate clip kinds diversity and file uniqueness. */
function checkClips(val: MontageBase, ctx: z.RefinementCtx): void {
  const kinds = new Set<string>();
  const files = new Set<string>();
  for (const clip of val.clips) {
    kinds.add(clip.kind);
    if (files.has(clip.file)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['clips'],
        message: `镜头文件重复：${clip.file}`,
      });
      return;
    }
    files.add(clip.file);
  }
  if (kinds.size < MONTAGE_MIN_KINDS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['clips'],
      message: '镜头池至少要有 3 种类型',
    });
  }
}

/** Validate word clipTags: existence in the pool, place-name binding and tag coverage. */
function checkWordTags(val: MontageBase, ctx: z.RefinementCtx): void {
  const tags = new Set(val.clips.map((c) => c.tag));
  const tagCounts = new Map<string, number>();
  for (const clip of val.clips) {
    tagCounts.set(clip.tag, (tagCounts.get(clip.tag) ?? 0) + 1);
  }
  const terms = val.placeTerms.map((t) => t.toLowerCase());
  val.words.forEach((w, i) => {
    if (w.clipTag !== undefined) {
      if (!tags.has(w.clipTag)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['words', i],
          message: `词「${w.text}」要求的镜头标签「${w.clipTag}」在镜头池里不存在`,
        });
      } else if ((tagCounts.get(w.clipTag) ?? 0) < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['words', i],
          message: `镜头标签「${w.clipTag}」只有 1 条镜头，连续使用会重复，至少要 2 条`,
        });
      }
      return;
    }
    const lower = w.text.toLowerCase();
    const term = terms.find((t) => lower.includes(t));
    if (term !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['words', i],
        message: `词「${w.text}」含地名「${term}」，必须绑定镜头标签（clipTag）`,
      });
    }
  });
}

/** The planned scene tag for one beat in an impact reel. */
export function impactTagAtBeat(props: Pick<MontageReelProps, 'impactPlan' | 'totalBeats'>, beat: number): string | null {
  const plan = props.impactPlan
  if (!plan) return null
  if (beat < plan.hookBeats) return plan.hookTag
  if (beat >= props.totalBeats - plan.payoffBeats) return plan.payoffTag
  const buildLength = props.totalBeats - plan.hookBeats - plan.payoffBeats
  const buildBeat = beat - plan.hookBeats
  const index = Math.min(plan.buildTags.length - 1, Math.floor((buildBeat / buildLength) * plan.buildTags.length))
  return plan.buildTags[index]
}

function checkImpactPlan(val: MontageBase, ctx: z.RefinementCtx): void {
  const plan = val.impactPlan
  if (!plan) return
  if (plan.hookBeats + plan.payoffBeats >= val.totalBeats) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['impactPlan'], message: '开头和结尾占满了整条片，中段没有递进空间' })
    return
  }
  const roles = [plan.hookTag, ...plan.buildTags, plan.payoffTag]
  if (new Set(roles).size !== roles.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['impactPlan'], message: '开头、中段和结尾必须使用不同场景标签' })
  }
  const counts = new Map<string, number>()
  for (const clip of val.clips) counts.set(clip.tag, (counts.get(clip.tag) ?? 0) + 1)
  for (const tag of roles) {
    const count = counts.get(tag) ?? 0
    if (count < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['impactPlan'],
        message: `场景「${tag}」需要至少 2 条不同素材，避免同一画面反复快切`,
      })
    }
  }
  const lastWord = val.words[val.words.length - 1]
  if (!lastWord || lastWord.at < val.totalBeats - plan.payoffBeats) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['words'],
      message: '冲击叙事的最后一句必须落在结尾兑现画面上',
    })
  }
  val.words.forEach((word, wordIndex) => {
    if (!word.clipTag) return
    for (let beat = word.at; beat < word.at + word.beats; beat++) {
      if (impactTagAtBeat(val as unknown as MontageReelProps, beat) !== word.clipTag) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['words', wordIndex, 'clipTag'],
          message: `词「${word.text}」绑定的场景与第 ${beat} 拍的分镜不一致`,
        })
        break
      }
    }
  })
}

function fastBarsFor(props: MontageReelProps): Set<number> {
  const bars = new Set(props.fastBars)
  if (!props.impactPlan) return bars
  const start = props.impactPlan.hookBeats
  const end = props.totalBeats - props.impactPlan.payoffBeats
  const buildLength = end - start
  // Add two deliberate accelerations in the middle section, even when the
  // incoming brief only supplied a generic fast-bar marker.
  for (const progress of [0.3, 0.65]) {
    const beat = Math.floor(start + buildLength * progress)
    if (beat >= start && beat < end) bars.add(Math.floor(beat / 4))
  }
  return bars
}

/** Schema for the montage quick-cut video template props. */
export const MontageReelPropsSchema = MontageBaseSchema.superRefine(
  (val, ctx) => {
    checkBeats(val, ctx);
    checkFastBars(val, ctx);
    checkWords(val, ctx);
    checkClips(val, ctx);
    checkWordTags(val, ctx);
    checkImpactPlan(val, ctx);
  },
);

/** Inferred props type for the montage template. */
export type MontageReelProps = z.infer<typeof MontageReelPropsSchema>;

/** One word entry in the montage. */
export type MontageWord = z.infer<typeof WORD>;

/** One clip entry in the montage pool. */
export type MontageClip = z.infer<typeof CLIP>;

/** Parse and validate unknown input, throwing a readable error on failure. */
export function parseMontageReelProps(input: unknown): MontageReelProps {
  const result = MontageReelPropsSchema.safeParse(input);
  if (!result.success) {
    throw new Error('props 校验失败：\n' + formatZodIssues(result.error));
  }
  return result.data;
}

/** Collect the de-duplicated list of every referenced asset file name. */
export function collectMontageAssetFiles(props: MontageReelProps): string[] {
  const files: string[] = [props.logoFile, props.musicFile];
  for (const clip of props.clips) {
    files.push(clip.file);
  }
  return Array.from(new Set(files));
}

/**
 * Frame number of beat `i`, with a sync shift for every beat after the first.
 * Beat 0 is always frame 0: the music's first beat usually lands after t=0, and the video
 * must open on its first word and clip from the very first frame, never on black.
 */
export function montageFrameOf(beats: readonly number[], i: number): number {
  if (i === 0) {
    return 0;
  }
  return Math.round(Math.max(0, beats[i]) * FPS) + MONTAGE_SYNC_SHIFT_FRAMES;
}

/** Compute total frames and the logo start frame for a montage. */
export function computeMontageTiming(
  props: Pick<MontageReelProps, 'beats' | 'totalBeats'>,
): { totalFrames: number; logoFrom: number } {
  const totalFrames = montageFrameOf(props.beats, props.totalBeats);
  if (totalFrames < MONTAGE_MIN_TOTAL_FRAMES) {
    throw new Error(
      `成片太短：只有 ${totalFrames} 帧，至少需要 ${MONTAGE_MIN_TOTAL_FRAMES} 帧`,
    );
  }
  let prev = montageFrameOf(props.beats, 0);
  for (let i = 1; i <= props.totalBeats; i++) {
    const cur = montageFrameOf(props.beats, i);
    if (cur <= prev) {
      throw new Error(`节拍帧必须严格递增：第 ${i} 拍与上一拍太近`);
    }
    prev = cur;
  }
  const logoFrom = montageFrameOf(
    props.beats,
    props.totalBeats - MONTAGE_LOGO_BEATS,
  );
  return { totalFrames, logoFrom };
}

/** One rendered montage segment. */
export interface MontageSegment {
  from: number;
  dur: number;
  clip: number;
  start: number;
  bw: boolean;
  down: boolean;
}

/** Deterministic pseudo-random number in [0, 1) from an integer seed. */
export function rnd(n: number): number {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

/** Find the word covering beat `i`, if any. */
function wordAtBeat(
  words: readonly MontageWord[],
  i: number,
): MontageWord | undefined {
  return words.find((w) => w.at <= i && i < w.at + w.beats);
}

/** Indices of clips matching a predicate. */
function indicesOf(
  clips: readonly MontageClip[],
  pred: (c: MontageClip) => boolean,
): number[] {
  const out: number[] = [];
  clips.forEach((c, idx) => {
    if (pred(c)) {
      out.push(idx);
    }
  });
  return out;
}

/** Mutable rotation counters used while building segments. */
interface Rotations {
  tagged: Map<string, number>;
  person: number;
  general: number;
}

/** Pick a clip index from candidates, avoiding the previous clip when possible. */
function pickClip(
  candidates: number[],
  rotation: number,
  prevClip: number,
): number {
  let idx = candidates[rotation % candidates.length];
  if (idx === prevClip && candidates.length > 1) {
    idx = candidates[(rotation + 1) % candidates.length];
  }
  return idx;
}

/** Choose the candidate clip indices for one segment. */
function candidatesFor(
  props: MontageReelProps,
  beat: number,
  k: number,
): { candidates: number[]; key: string } {
  const plannedTag = impactTagAtBeat(props, beat)
  if (plannedTag !== null) {
    return {
      candidates: indicesOf(props.clips, (c) => c.tag === plannedTag),
      key: `impact:${plannedTag}`,
    }
  }
  const word = wordAtBeat(props.words, beat);
  if (word !== undefined && word.clipTag !== undefined) {
    const tag = word.clipTag;
    return {
      candidates: indicesOf(props.clips, (c) => c.tag === tag),
      key: `tag:${tag}`,
    };
  }
  if (k % 3 === 2) {
    const persons = indicesOf(props.clips, (c) => c.kind === 'person');
    if (persons.length > 0) {
      return { candidates: persons, key: 'person' };
    }
  }
  return {
    candidates: props.clips.map((_, idx) => idx),
    key: 'general',
  };
}

/** Read and bump the rotation counter for a candidate-list key. */
function bumpRotation(rot: Rotations, key: string): number {
  if (key === 'person') {
    const v = rot.person;
    rot.person += 1;
    return v;
  }
  if (key === 'general') {
    const v = rot.general;
    rot.general += 1;
    return v;
  }
  const v = rot.tagged.get(key) ?? 0;
  rot.tagged.set(key, v + 1);
  return v;
}

/** Build one segment for a beat part. */
function makeSegment(
  props: MontageReelProps,
  beat: number,
  part: number,
  parts: number,
  k: number,
  prevClip: number,
  rot: Rotations,
): MontageSegment {
  const f0 = montageFrameOf(props.beats, beat);
  const f1 = montageFrameOf(props.beats, beat + 1);
  const a = f0 + Math.round(((f1 - f0) * part) / parts);
  const b = f0 + Math.round(((f1 - f0) * (part + 1)) / parts);
  const dur = b - a;
  if (dur < 1) {
    throw new Error(`片段太短：第 ${beat} 拍第 ${part} 段只有 ${dur} 帧`);
  }
  const { candidates, key } = candidatesFor(props, beat, k);
  const rotation = bumpRotation(rot, key);
  const clip = pickClip(candidates, rotation, prevClip);
  const need = dur + 2;
  const len = props.clips[clip].lenFrames;
  const start = Math.floor(rnd(k + 3) * Math.max(1, len - need));
  const bar = Math.floor(beat / 4);
  return {
    from: a,
    dur,
    clip,
    start,
    bw: bar % 3 === 2,
    down: beat % 4 === 0 && part === 0,
  };
}

/** Largest number of flash frames falling inside any one-second window. */
export function maxFlashesPerSecond(
  segments: readonly MontageSegment[],
): number {
  const flashes = segments.filter((s) => s.down).map((s) => s.from);
  let worst = 0;
  for (const start of flashes) {
    let count = 0;
    for (const f of flashes) {
      if (f - start >= 0 && f - start < FPS) {
        count += 1;
      }
    }
    if (count > worst) {
      worst = count;
    }
  }
  return worst;
}

/** Build the deterministic list of montage segments. */
export function buildMontageSegments(props: MontageReelProps): MontageSegment[] {
  const out: MontageSegment[] = [];
  const fastBars = fastBarsFor(props)
  const rot: Rotations = { tagged: new Map(), person: 0, general: 0 };
  let prevClip = -1;
  let k = 0;
  for (let beat = 0; beat < props.totalBeats; beat++) {
    const bar = Math.floor(beat / 4);
    const parts = fastBars.has(bar) ? 2 : 1;
    for (let part = 0; part < parts; part++) {
      const seg = makeSegment(props, beat, part, parts, k, prevClip, rot);
      out.push(seg);
      prevClip = seg.clip;
      k += 1;
    }
  }
  const worst = maxFlashesPerSecond(out);
  if (worst > MONTAGE_MAX_FLASHES_PER_SEC) {
    throw new Error(
      `闪白太密：任意 1 秒内最多 ${MONTAGE_MAX_FLASHES_PER_SEC} 次，现在有 ${worst} 次`,
    );
  }
  return out;
}

/** One recipe column the template cannot satisfy for a given set of props. */
export interface RecipeGap {
  column: string;
  status: '未满足';
  reason: string;
}

/** Recipe columns the montage cannot satisfy for these props. */
export function recipeGapsOf(props: MontageReelProps): RecipeGap[] {
  const gaps: RecipeGap[] = [];
  if (!props.clips.some((c) => c.kind === 'person')) {
    gaps.push({
      column: '真人出镜/自拍感',
      status: '未满足',
      reason: '镜头池里没有真人镜头',
    });
  }
  if (!props.clips.some((c) => c.source === 'own')) {
    gaps.push({
      column: '真实感',
      status: '未满足',
      reason: '镜头池里没有自有素材（全部是库存或 AI）',
    });
  }
  return gaps;
}

/**
 * Compact audit summary for the impact storyboard. It records what the renderer
 * actually selected; it does not claim that the hook, footage, or payoff is good.
 */
export function impactPlanReport(props: MontageReelProps): {
  schema_version: 1
  hook_tag: string
  hook_beats: number
  build_tags: string[]
  payoff_tag: string
  payoff_beats: number
  planned_scene_count: number
  rendered_clip_file_count: number
  human_review_required: true
} | null {
  const plan = props.impactPlan
  if (!plan) return null
  const used = new Set(buildMontageSegments(props).map((segment) => props.clips[segment.clip].file))
  return {
    schema_version: 1,
    hook_tag: plan.hookTag,
    hook_beats: plan.hookBeats,
    build_tags: [...plan.buildTags],
    payoff_tag: plan.payoffTag,
    payoff_beats: plan.payoffBeats,
    planned_scene_count: 2 + plan.buildTags.length,
    rendered_clip_file_count: used.size,
    human_review_required: true,
  }
}

/** Music envelope for the standard and impact montages, measured per output frame. */
export function montageMusicVolumeAtFrame(frame: number, totalFrames: number, impact: boolean): number {
  const points: Array<[number, number]> = impact
    ? [
        [0, 0],
        [6, 0.68],
        [Math.round(totalFrames * 0.28), 0.76],
        [Math.round(totalFrames * 0.62), 1],
        [totalFrames - 24, 1],
        [totalFrames - 2, 0],
      ]
    : [
        [0, 0],
        [6, 1],
        [totalFrames - 24, 1],
        [totalFrames - 2, 0],
      ]

  const boundedFrame = Math.max(0, Math.min(frame, totalFrames - 1))
  for (let index = 0; index < points.length - 1; index += 1) {
    const [fromFrame, fromVolume] = points[index]
    const [toFrame, toVolume] = points[index + 1]
    if (boundedFrame <= toFrame) {
      const progress = Math.max(0, Math.min(1, (boundedFrame - fromFrame) / (toFrame - fromFrame)))
      return fromVolume + (toVolume - fromVolume) * progress
    }
  }
  return points[points.length - 1][1]
}
