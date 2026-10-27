import { z } from 'zod';
import { FPS } from './timing.ts';
import { HEX_COLOR, MUSIC_EXTS, LOGO_EXTS, CLIP_EXTS, relFile, text, formatZodIssues, musicGainSchema, frameSchema } from './schema.ts';

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
/** Width budget of the end-card title, in units. */
export const END_TITLE_UNITS = 14;

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
  'limited places',
  'limited seats',
  'limited availability',
  'limited spaces',
  'ends soon',
  'book early',
  'book today',
  'act now',
  "don't miss out",
  'last few',
  'almost gone',
  'book soon',
  'closes soon',
  'booking closes',
  'final call',
  'going fast',
  'few seats',
  'last seats',
  'few spots',
  'last spots',
  'sale ends',
  'while stocks last',
  'while supplies last',
  'selling out fast',
  'sell out fast',
  'fills up fast',
  'filling fast',
  'prices rise soon',
  'price goes up',
  'prices increase',
  'seats are limited',
  'spaces are limited',
  'places are limited',
  'spots are limited',
  'last day',
  'last days',
  'final days',
  'ends friday',
  'ends monday',
  'ends tomorrow',
  "don't wait",
  'act fast',
  'selling out',
  'sells out',
  'sell out',
  'few places left',
  'closing soon',
  'offer closes',
  'offer ends',
  'hurry up',
  'dont miss out',
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
  '限定',
  '限時',
  '截至',
  '抢',
  '搶',
  '名額',
  '僅剩',
  '倒數',
  '最後機會',
  '早鳥',
  '最后一天',
  '最後一天',
  '仅限',
  '僅限',
  '今天最后',
  '今天最後',
  '错过再等',
  '錯過再等',
  '限额',
  '限額',
  '席位有限',
  '座位有限',
  '数量有限',
  '名额有限',
  '售罄',
  '手慢无',
  '抓紧',
  '即将结束',
  '马上结束',
  '最后几天',
  '最後幾天',
];

/** Scarcity patterns that must never appear (returned as the matched text). */
const SCARCITY_PATTERNS = [
  /only\s+\d+\s+(left|remaining|seats|spots|places)/i,
  /\b\d+\s+(days?|weeks?|seats?|spots?)\s+left\b/i,
  /\b\d+\s+left\b/i,
  /\boffer\s+ends\b/i,
  /\bexpir(?:es|ed|ing)\b/i,
  /\bonly\s+(a\s+few|one|two|three|four|five|six|seven|eight|nine|ten)\s+(left|remaining)\b/i,
  /\bjust\s+\d+\s+(spots?|seats?|places?)\b/i,
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

/**
 * Normalize a string for banned-word scanning: NFKC-normalize, strip zero-width /
 * bidi / control characters, map curly quotes to ASCII, collapse non-breaking
 * spaces and runs of hyphens/dashes/underscores/whitespace into a single space,
 * then trim.
 */
export function normalizeForScan(s: string): string {
  let out = s.normalize('NFKC');
  out = out.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD]/g, '');
  out = out.replace(/[\u2018\u2019\u201B\u02BC]/g, "'");
  out = out.replace(/[\u201C\u201D]/g, '"');
  out = out.replace(/\u00A0/g, ' ');
  out = out.replace(/[-_\s]+/g, ' ');
  return out.trim();
}

/** Width of a string in layout units (CJK = 1, space = 0.3, other = 0.55 or 0.7 when uppercase), rounded to 2 decimals. */
export function textWidthUnits(s: string, uppercase = false): number {
  const latin = uppercase ? 0.7 : 0.55;
  let total = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (isWideChar(code)) {
      total += 1;
    } else if (ch === ' ') {
      total += 0.3;
    } else {
      total += latin;
    }
  }
  return Math.round(total * 100) / 100;
}

/** Every banned word or scarcity phrase found in the text. */
export function bannedWordHits(s: string): string[] {
  const hits: string[] = [];
  const normalized = normalizeForScan(s);
  const compact = normalized.replace(/[\s·・•.]/g, '');
  for (const word of ENGLISH_BANNED) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z])`, 'i');
    if (re.test(normalized)) hits.push(word);
  }
  for (const pattern of SCARCITY_PATTERNS) {
    const match = normalized.match(pattern);
    if (match !== null) hits.push(match[0]);
  }
  for (const word of CHINESE_BANNED) {
    if (compact.includes(word)) hits.push(word);
  }
  return hits;
}

/** On-screen price mentions that must never appear in body text (prices belong on the price card or the first-comment link). */
export function priceMentionHits(s: string): string[] {
  const hits: string[] = [];
  const normalized = normalizeForScan(s);
  const patterns: RegExp[] = [
    /[$€£¥￥]/,
    /\b(?:nzd|aud|usd|cny|rmb|nz\$|a\$)\b/i,
    /\d[\d,.]*\s*(?:nzd|aud|usd|元|块|刀|美元|新币)/i,
    /(?:nzd|aud|usd|nz\$|a\$)\s*\d/i,
    /(?:仅需|只要|低至|起价|售价|价格|特价|折扣)\s*\d/,
    /\d\s*折/,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match !== null) hits.push(match[0]);
  }
  return hits;
}

const hexColor = z.string().regex(HEX_COLOR, { message: '颜色必须是 #RRGGBB 十六进制' });

const HOOK = z
  .object({
    clip: relFile('镜头文件', CLIP_EXTS),
    lines: z.array(text(30)).min(1).max(MAX_HOOK_LINES),
    // Optional official-page citation for the hook text. Needed by the creative-library fact gate, which refuses any
    // on-screen line without a source. Both or neither.
    sourceUrl: z.string().optional(),
    sourceQuote: text(300).optional(),
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

const PRICE_SHAPE = z
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

const END = z
  .object({
    backdropClip: relFile('镜头文件', CLIP_EXTS),
    title: text(40),
    // Optional official-page citation for the end-card title (same rule as the hook). Both or neither.
    sourceUrl: z.string().optional(),
    sourceQuote: text(300).optional(),
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
      .min(3, { message: '价格时长必须在 3 到 8 秒之间' })
      .max(8, { message: '价格时长必须在 3 到 8 秒之间' }),
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

/**
 * True when the quote supports the text. When the text has no tokens the whole
 * text must occur in the quote; otherwise at least half (rounded up) of the
 * tokens must occur in the quote.
 */
export function quoteSupports(text: string, quote: string): boolean {
  const tokens = relevanceTokens(text);
  const haystack = normalizeForScan(quote).toLowerCase();
  if (tokens.length === 0) {
    return haystack.includes(normalizeForScan(text).toLowerCase());
  }
  const needed = Math.ceil(tokens.length / 2);
  let found = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) found += 1;
  }
  return found >= needed;
}

/** True when the URL is a plain http(s) URL with a real host (not localhost / IPv4 / IPv6 / reserved TLD). */
export function isAcceptableSourceUrl(url: string): boolean {
  if (!/^https?:\/\/[^\s/]+\.[^\s/]+(\/\S*)?$/.test(url)) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (parsed.username !== '' || parsed.password !== '') return false;
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost') return false;
  if (
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.lan') ||
    host.endsWith('.test') ||
    host.endsWith('.invalid')
  ) {
    return false;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  if (host.includes(':')) return false;
  const labels = host.split('.');
  const last = labels[labels.length - 1];
  if (!/^[a-z]{2,}$/.test(last)) return false;
  return true;
}

/** Hook / end-card citation: both fields or neither; when given it must be a real http(s) URL and its quote must support the shown text. */
function checkOptionalSource(
  path: Array<string | number>,
  shown: string,
  sourceUrl: string | undefined,
  sourceQuote: string | undefined,
  ctx: z.RefinementCtx,
): void {
  if (sourceUrl === undefined && sourceQuote === undefined) return;
  if (sourceUrl === undefined || sourceQuote === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path, message: '出处链接和出处片段要么都填，要么都不填' });
    return;
  }
  if (!isAcceptableSourceUrl(sourceUrl)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path, 'sourceUrl'], message: '出处链接必须是 http 或 https 网址' });
  }
  if (!quoteSupports(shown, sourceQuote)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path, 'sourceQuote'], message: '出处片段里找不到这句话的主要词' });
  }
  const hits = bannedWordHits(sourceQuote);
  if (hits.length > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path, 'sourceQuote'], message: `文字里不能出现促销词：${hits.join('、')}` });
  }
}

type FrameValue = z.infer<typeof frameSchema>;

function frameCopyTargets(frame: FrameValue | undefined): Array<[Array<string | number>, string]> {
  if (!frame) return [];
  const out: Array<[Array<string | number>, string]> = [];
  if (frame.hook && typeof frame.hook === 'object') {
    const hook = frame.hook;
    if (hook.text) out.push([['frame', 'hook', 'text'], hook.text]);
    if (hook.stat) out.push([['frame', 'hook', 'stat'], hook.stat]);
    if (hook.question) out.push([['frame', 'hook', 'question'], hook.question]);
  }
  if (frame.endCard && typeof frame.endCard === 'object') {
    const end = frame.endCard;
    if (end.cta) out.push([['frame', 'endCard', 'cta'], end.cta]);
    if (end.contact) out.push([['frame', 'endCard', 'contact'], end.contact]);
    if (end.brandName) out.push([['frame', 'endCard', 'brandName'], end.brandName]);
  }
  return out;
}

/** Scarcity and price rules also apply to optional hook and end-card copy. */
function checkFrameCopy(frame: FrameValue | undefined, ctx: z.RefinementCtx): void {
  for (const [path, value] of frameCopyTargets(frame)) {
    const banned = bannedWordHits(value);
    if (banned.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path,
        message: `文字里不能出现促销词：${banned.join('、')}`,
      });
    }
    const prices = priceMentionHits(value);
    if (prices.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path,
        message: '画面文字里不许出现价格（价格只放价格卡或首评链接）',
      });
    }
  }
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
    musicGain: musicGainSchema,
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
    cardTop: z
      .number()
      .min(600, { message: 'cardTop 必须在 600 到 940 之间' })
      .max(940, { message: 'cardTop 必须在 600 到 940 之间' })
      .optional(),
    cardZone: z.enum(['upper', 'lower', 'alternate'], {
      message: 'cardZone 只能是 upper、lower 或 alternate',
    }).optional(),
    frame: frameSchema.optional(),
    accent: hexColor.optional(),
    hook: HOOK,
    scenes: z
      .array(SCENE)
      .min(MIN_SCENES, { message: '场景数量最少 2 个' })
      .max(MAX_SCENES, { message: '场景数量最多 4 个' }),
    price: PRICE_SHAPE.nullable(),
    end: END.nullable(),
    timing: TIMING,
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.cardTop !== undefined && val.cardZone !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cardZone'],
        message: 'cardTop 和 cardZone 只能填一个',
      });
    }
    checkFrameCopy(val.frame, ctx);

    val.hook.lines.forEach((line, i) => {
      if (textWidthUnits(line, true) > HOOK_LINE_UNITS) {
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
      if (textWidthUnits(scene.place, true) > PLACE_UNITS) {
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
    ];
    if (val.price !== null) {
      bannedTargets.push([['price', 'fromLabel'], val.price.fromLabel]);
      bannedTargets.push([['price', 'qualifier'], val.price.qualifier]);
      bannedTargets.push([['price', 'footnote'], val.price.footnote]);
      if (val.price.dateLine !== undefined) {
        bannedTargets.push([['price', 'dateLine'], val.price.dateLine]);
      }
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

    const priceTargets: Array<[Array<string | number>, string]> = [
      ...val.hook.lines.map((line, i): [Array<string | number>, string] => [['hook', 'lines', i], line]),
      ...val.scenes.flatMap((scene, i): Array<[Array<string | number>, string]> => [
        [['scenes', i, 'place'], scene.place],
        [['scenes', i, 'line'], scene.line],
      ]),
    ];
    if (val.end !== null) {
      priceTargets.push([['end', 'title'], val.end.title]);
    }
    for (const [path, value] of priceTargets) {
      const hits = priceMentionHits(value);
      if (hits.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: '画面文字里不许出现价格（价格只放价格卡或首评链接）',
        });
      }
    }

    for (const line of val.hook.lines) {
      checkOptionalSource(['hook'], line, val.hook.sourceUrl, val.hook.sourceQuote, ctx);
    }
    if (val.end !== null) {
      checkOptionalSource(['end'], val.end.title, val.end.sourceUrl, val.end.sourceQuote, ctx);
    }

    val.scenes.forEach((scene, i) => {
      if (!isAcceptableSourceUrl(scene.sourceUrl)) {
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
      const quoteHits = bannedWordHits(scene.sourceQuote);
      if (quoteHits.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['scenes', i, 'sourceQuote'],
          message: `文字里不能出现促销词：${quoteHits.join('、')}`,
        });
      }
      const placeQuoteHits = bannedWordHits(scene.placeSourceQuote);
      if (placeQuoteHits.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['scenes', i, 'placeSourceQuote'],
          message: `文字里不能出现促销词：${placeQuoteHits.join('、')}`,
        });
      }
    });

    const hasPrice = val.price !== null;
    const hasEnd = val.end !== null;
    if (hasPrice === hasEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['end'],
        message: 'price 和 end 必须二选一：要么显示价格，要么显示结束卡',
      });
    }

    if (val.price !== null && val.timing.priceSec < 5) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['timing', 'priceSec'],
        message: '带价格卡时最后一段至少 5 秒（只有片尾标题卡时可以短到 3 秒）',
      });
    }

    if (val.end !== null) {
      if (textWidthUnits(val.end.title, true) > END_TITLE_UNITS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['end', 'title'],
          message: `结束卡标题太宽（最多约 ${END_TITLE_UNITS} 个单位）`,
        });
      }
      const endHits = bannedWordHits(val.end.title);
      if (endHits.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['end', 'title'],
          message: `文字里不能出现促销词：${endHits.join('、')}`,
        });
      }
    }

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
  if (props.price !== null) {
    files.push(props.price.backdropClip);
  } else if (props.end !== null) {
    files.push(props.end.backdropClip);
  }
  files.push(props.logoFile);
  if (props.musicFile !== null) {
    files.push(props.musicFile);
  }
  return Array.from(new Set(files));
}
