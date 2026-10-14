import { z } from 'zod';
import { FPS } from './timing.ts';
import { HEX_COLOR, MUSIC_EXTS, LOGO_EXTS, CLIP_EXTS, relFile, text, formatZodIssues } from './schema.ts';

/** Fewest scenes a postcard may show. */
export const MIN_SCENES = 2;
/** Most scenes a postcard may show. */
export const MAX_SCENES = 4;
/** Longest total runtime (seconds). */
export const MAX_TOTAL_SEC = 25;
/** Most hook lines. */
export const MAX_HOOK_LINES = 3;
/** Width budget of one hook line, in units. */
export const HOOK_LINE_UNITS = 8.7;
/** Width budget of one scene line, in units. */
export const SCENE_LINE_UNITS = 25;
/** Width budget of one scene place label, in units. */
export const PLACE_UNITS = 19;

/** English phrases that must never appear (matched as whole words, case-insensitive). */
export const ENGLISH_BANNED = [
  'deadline',
  'limited time',
  'early bird',
  'countdown',
  'last chance',
  'hurry',
  'book now',
  'today only',
  'seats left',
  'spots left',
  'selling fast',
  'sold out soon',
];

/** Chinese phrases that must never appear (plain substring match). */
export const CHINESE_BANNED = [
  '限时',
  '截止',
  '早鸟',
  '倒计时',
  '最后机会',
  '仅剩',
  '名额',
  '限量',
  '先到先得',
  '还剩',
];

/** Scarcity patterns that must never appear (returned as the matched text). */
const SCARCITY_PATTERNS = [
  /only\s+\d+\s+(left|remaining|seats|spots|places)/i,
  /\b\d+\s+(days?|weeks?|seats?|spots?)\s+left\b/i,
];

const CJK_RANGES = [
  [0x2e80, 0x2eff],
  [0x2f00, 0x2fdf],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xf900, 0xfaff],
  [0xff00, 0xffef],
];

/** True when the code point is a CJK / fullwidth character. */
function isWideChar(code: number): boolean {
  for (const [lo, hi] of CJK_RANGES) {
    if (code >= lo && code <= hi) return true;
  }
  return false;
}

/** Width of a string in layout units (CJK = 1, space = 0.3, other = 0.55), rounded to 2 decimals. */
export function textWidthUnits(s: string): number {
  let total = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (isWideChar(code)) {
      total += 1;
    } else if (ch === ' ') {
      total += 0.3;
    } else {
      total += 0.55;
    }
  }
  return Math.round(total * 100) / 100;
}

/** Every banned word or scarcity phrase found in the text. */
export function bannedWordHits(s: string): string[] {
  const hits: string[] = [];
  for (const word of ENGLISH_BANNED) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z])`, 'i');
    if (re.test(s)) hits.push(word);
  }
  for (const pattern of SCARCITY_PATTERNS) {
    const match = s.match(pattern);
    if (match !== null) hits.push(match[0]);
  }
  for (const word of CHINESE_BANNED) {
    if (s.includes(word)) hits.push(word);
  }
  return hits;
}

const hexColor = z.string().regex(HEX_COLOR, { message: '颜色必须是 #RRGGBB 十六进制' });

const HOOK = z
  .object({
    clip: relFile('镜头文件', CLIP_EXTS),
    lines: z.array(text(30)).min(1).max(MAX_HOOK_LINES),
  })
  .strict();

const SCENE = z
  .object({
    clip: relFile('镜头文件', CLIP_EXTS),
    place: text(40),
    line: text(120),
    sourceUrl: z.string(),
    sourceQuote: text(300),
    placeSourceQuote: text(300),
  })
  .strict();

const PRICE = z
  .object({
    backdropClip: relFile('镜头文件', CLIP_EXTS),
    fromLabel: text(20),
    currencyPrefix: text(6),
    amount: z.number().int().positive().max(9999999),
    qualifier: text(40),
    dateLine: text(40).optional(),
    footnote: text(80),
    footnoteSize: z
      .number()
      .int()
      .min(30, { message: '脚注字号必须在 30 到 60 之间' })
      .max(60, { message: '脚注字号必须在 30 到 60 之间' })
      .optional(),
  })
  .strict();

const TIMING = z
  .object({
    hookSec: z
      .number()
      .min(2, { message: '开场时长必须在 2 到 4 秒之间' })
      .max(4, { message: '开场时长必须在 2 到 4 秒之间' }),
    sceneSec: z
      .number()
      .min(3, { message: '每段时长必须在 3 到 6 秒之间' })
      .max(6, { message: '每段时长必须在 3 到 6 秒之间' }),
    priceSec: z
      .number()
      .min(5, { message: '价格时长必须在 5 到 8 秒之间' })
      .max(8, { message: '价格时长必须在 5 到 8 秒之间' }),
  })
  .strict();

/** Tokens of a text used for source-quote relevance checks. */
function relevanceTokens(s: string): string[] {
  const tokens: string[] = [];
  const parts = s.toLowerCase().split(/[^\p{L}\p{N}]+/u);
  for (const part of parts) {
    if (part.length === 0) continue;
    let latin = '';
    for (const ch of part) {
      const code = ch.codePointAt(0) ?? 0;
      if (isWideChar(code)) {
        if (latin.length >= 4) tokens.push(latin);
        latin = '';
        tokens.push(ch);
      } else {
        latin += ch;
      }
    }
    if (latin.length >= 4) tokens.push(latin);
  }
  return tokens;
}

/** True when at least one token of `text` occurs in `quote`. */
function quoteSupports(text: string, quote: string): boolean {
  const tokens = relevanceTokens(text);
  if (tokens.length === 0) return true;
  const haystack = quote.toLowerCase();
  return tokens.some((token) => haystack.includes(token));
}

/** Schema for the generic travel-postcard video template props. No defaults: a missing field is rejected. */
export const PostcardPropsSchema = z
  .object({
    brandColor: hexColor,
    logoFile: relFile('logo 文件', LOGO_EXTS),
    logoMode: z
      .enum(['last_beats', 'always'], {
        message: 'logoMode 只能是 last_beats 或 always',
      })
      .optional(),
    musicFile: relFile('音乐文件', MUSIC_EXTS).nullable(),
    musicStartSec: z.number().min(0).max(600).optional(),
    scrim: z
      .number()
      .min(0, { message: '压暗强度必须在 0 到 1 之间' })
      .max(1, { message: '压暗强度必须在 0 到 1 之间' })
      .optional(),
    cardOpacity: z
      .number()
      .min(0, { message: '卡片不透明度必须在 0 到 0.9 之间' })
      .max(0.9, { message: '卡片不透明度必须在 0 到 0.9 之间' }),
    cardSide: z.enum(['left', 'center'], {
      message: 'cardSide 只能是 left 或 center',
    }),
    accent: hexColor.optional(),
    hook: HOOK,
    scenes: z
      .array(SCENE)
      .min(MIN_SCENES, { message: '场景数量最少 2 个' })
      .max(MAX_SCENES, { message: '场景数量最多 4 个' }),
    price: PRICE,
    timing: TIMING,
  })
  .strict()
  .superRefine((val, ctx) => {
    val.hook.lines.forEach((line, i) => {
      if (textWidthUnits(line) > HOOK_LINE_UNITS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['hook', 'lines', i],
          message: `开场第 ${i + 1} 行太宽（最多约 ${HOOK_LINE_UNITS} 个单位）`,
        });
      }
    });

    val.scenes.forEach((scene, i) => {
      if (textWidthUnits(scene.line) > SCENE_LINE_UNITS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['scenes', i, 'line'],
          message: `第 ${i + 1} 段文字太宽（最多约 ${SCENE_LINE_UNITS} 个单位）`,
        });
      }
      if (textWidthUnits(scene.place) > PLACE_UNITS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['scenes', i, 'place'],
          message: `第 ${i + 1} 段地名太宽（最多约 ${PLACE_UNITS} 个单位）`,
        });
      }
    });

    const bannedTargets: Array<[Array<string | number>, string]> = [
      ...val.hook.lines.map((line, i): [Array<string | number>, string] => [['hook', 'lines', i], line]),
      ...val.scenes.flatMap((scene, i): Array<[Array<string | number>, string]> => [
        [['scenes', i, 'place'], scene.place],
        [['scenes', i, 'line'], scene.line],
      ]),
      [['price', 'fromLabel'], val.price.fromLabel],
      [['price', 'qualifier'], val.price.qualifier],
      [['price', 'footnote'], val.price.footnote],
    ];
    if (val.price.dateLine !== undefined) {
      bannedTargets.push([['price', 'dateLine'], val.price.dateLine]);
    }
    for (const [path, value] of bannedTargets) {
      const hits = bannedWordHits(value);
      if (hits.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: `文字里不能出现促销词：${hits.join('、')}`,
        });
      }
    }

    val.scenes.forEach((scene, i) => {
      if (!/^https?:\/\/\S+$/.test(scene.sourceUrl)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['scenes', i, 'sourceUrl'],
          message: '出处链接必须是 http 或 https 网址',
        });
      }
      if (!quoteSupports(scene.line, scene.sourceQuote)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['scenes', i, 'sourceQuote'],
          message: '出处片段里找不到这句话的主要词',
        });
      }
      if (!quoteSupports(scene.place, scene.placeSourceQuote)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['scenes', i, 'placeSourceQuote'],
          message: '出处片段里找不到这句话的主要词',
        });
      }
    });

    const totalSec = val.timing.hookSec + val.scenes.length * val.timing.sceneSec + val.timing.priceSec;
    if (totalSec > MAX_TOTAL_SEC) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['timing'],
        message: `成片总时长不能超过 ${MAX_TOTAL_SEC} 秒`,
      });
    }
  });

/** Inferred props type for the travel-postcard template. */
export type PostcardProps = z.infer<typeof PostcardPropsSchema>;

/** Parse and validate unknown input, throwing a readable error on failure. */
export function parsePostcardProps(input: unknown): PostcardProps {
  const result = PostcardPropsSchema.safeParse(input);
  if (!result.success) {
    throw new Error('props 校验失败：\n' + formatZodIssues(result.error));
  }
  return result.data;
}

/** Frame layout of the postcard. */
export interface PostcardTiming {
  hookFrames: number;
  sceneFrom: number[];
  sceneDur: number[];
  priceFrom: number;
  totalFrames: number;
}

/** Compute the frame layout from validated props (hook holds, scenes run back to back, price holds). */
export function computePostcardTiming(props: PostcardProps): PostcardTiming {
  const hookFrames = Math.round(props.timing.hookSec * FPS);
  const sceneDur = props.scenes.map(() => Math.round(props.timing.sceneSec * FPS));
  const sceneFrom: number[] = [];
  let cursor = hookFrames;
  for (const dur of sceneDur) {
    sceneFrom.push(cursor);
    cursor += dur;
  }
  const priceFrom = cursor;
  const priceFrames = Math.round(props.timing.priceSec * FPS);
  const totalFrames = cursor + priceFrames;
  return { hookFrames, sceneFrom, sceneDur, priceFrom, totalFrames };
}

/** De-duplicated list of every referenced asset file name. */
export function collectPostcardAssetFiles(props: PostcardProps): string[] {
  const files: string[] = [];
  files.push(props.hook.clip);
  for (const scene of props.scenes) {
    files.push(scene.clip);
  }
  files.push(props.price.backdropClip);
  files.push(props.logoFile);
  if (props.musicFile !== null) {
    files.push(props.musicFile);
  }
  return Array.from(new Set(files));
}
