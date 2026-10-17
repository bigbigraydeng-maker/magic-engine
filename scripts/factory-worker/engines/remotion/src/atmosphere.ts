import { z } from 'zod';
import { FPS } from './timing.ts';
import { HEX_COLOR, MUSIC_EXTS, LOGO_EXTS, CLIP_EXTS, relFile, text, formatZodIssues } from './schema.ts';
import { textWidthUnits, bannedWordHits, priceMentionHits, isAcceptableSourceUrl, quoteSupports } from './postcard.ts';

/** Shortest total runtime (seconds). */
export const MIN_DURATION_SEC = 12;
/** Longest total runtime (seconds). */
export const MAX_DURATION_SEC = 20;
/** Width budget of the single text line, in units. */
export const LINE_UNITS = 25;
/** Largest end zoom factor for the slow push. */
export const MAX_PUSH = 1.04;
/** Smallest allowed text top position (px). */
export const TEXT_TOP_MIN = 480;
/** Largest allowed text top position (px). */
export const TEXT_TOP_MAX = 1100;
/** Default fade-in length (seconds). */
export const FADE_IN_DEFAULT_SEC = 1.0;
/** Default fade-out length (seconds). */
export const FADE_OUT_DEFAULT_SEC = 1.5;
/** Black cover opacity at frame 0, so the first frame is not fully black. */
export const FADE_START_OPACITY = 0.75;

const LINE = z
  .object({
    text: text(120),
    sourceUrl: z.string(),
    sourceQuote: text(300),
  })
  .strict();

const CROP = z
  .object({
    x: z.number().min(0, { message: '裁剪 x 必须在 0 到 1 之间' }).max(1, { message: '裁剪 x 必须在 0 到 1 之间' }),
    y: z.number().min(0, { message: '裁剪 y 必须在 0 到 1 之间' }).max(1, { message: '裁剪 y 必须在 0 到 1 之间' }),
    w: z.number().gt(0, { message: '裁剪 w 必须大于 0' }).max(1, { message: '裁剪 w 必须不大于 1' }),
    h: z.number().gt(0, { message: '裁剪 h 必须大于 0' }).max(1, { message: '裁剪 h 必须不大于 1' }),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.x + val.w > 1.0001) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['w'],
        message: '裁剪区域超出画面（x + w 必须不大于 1）',
      });
    }
    if (val.y + val.h > 1.0001) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['h'],
        message: '裁剪区域超出画面（y + h 必须不大于 1）',
      });
    }
  });

/** Schema for the single-shot ambience video template props. No defaults: a missing field is rejected. */
export const AtmospherePropsSchema = z
  .object({
    logoFile: relFile('logo 文件', LOGO_EXTS),
    logoMode: z
      .enum(['last_beats', 'always'], {
        message: 'logoMode 只能是 last_beats 或 always',
      })
      .optional(),
    musicFile: relFile('音乐文件', MUSIC_EXTS).nullable(),
    musicStartSec: z.number().min(0).max(600).optional(),
    clip: relFile('镜头文件', CLIP_EXTS),
    sourceIn: z
      .number()
      .min(0, { message: 'sourceIn 必须在 0 到 3600 秒之间' })
      .max(3600, { message: 'sourceIn 必须在 0 到 3600 秒之间' })
      .optional(),
    crop: CROP.optional(),
    durationSec: z
      .number()
      .min(MIN_DURATION_SEC, { message: '成片时长必须在 12 到 20 秒之间' })
      .max(MAX_DURATION_SEC, { message: '成片时长必须在 12 到 20 秒之间' }),
    fadeInSec: z
      .number()
      .min(0.6, { message: '淡入时长必须在 0.6 到 1.5 秒之间' })
      .max(1.5, { message: '淡入时长必须在 0.6 到 1.5 秒之间' })
      .optional(),
    fadeOutSec: z
      .number()
      .min(0.8, { message: '淡出时长必须在 0.8 到 2 秒之间' })
      .max(2, { message: '淡出时长必须在 0.8 到 2 秒之间' })
      .optional(),
    push: z
      .number()
      .min(1, { message: '推镜倍数必须在 1 到 1.04 之间' })
      .max(MAX_PUSH, { message: '推镜倍数必须在 1 到 1.04 之间' })
      .optional(),
    line: LINE.nullable(),
    textTop: z
      .number()
      .min(TEXT_TOP_MIN, { message: 'textTop 必须在 480 到 1100 之间' })
      .max(TEXT_TOP_MAX, { message: 'textTop 必须在 480 到 1100 之间' })
      .optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.line !== null) {
      if (textWidthUnits(val.line.text) > LINE_UNITS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['line', 'text'],
          message: `文字太宽（最多约 ${LINE_UNITS} 个单位）`,
        });
      }
      const textHits = bannedWordHits(val.line.text);
      if (textHits.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['line', 'text'],
          message: `文字里不能出现促销词：${textHits.join('、')}`,
        });
      }
      const quoteHits = bannedWordHits(val.line.sourceQuote);
      if (quoteHits.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['line', 'sourceQuote'],
          message: `文字里不能出现促销词：${quoteHits.join('、')}`,
        });
      }
      const priceHits = priceMentionHits(val.line.text);
      if (priceHits.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['line', 'text'],
          message: '画面文字里不许出现价格（价格只放价格卡或首评链接）',
        });
      }
      if (!isAcceptableSourceUrl(val.line.sourceUrl)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['line', 'sourceUrl'],
          message: '出处链接必须是 http 或 https 网址',
        });
      }
      if (!quoteSupports(val.line.text, val.line.sourceQuote)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['line', 'sourceQuote'],
          message: '出处片段里找不到这句话的主要词',
        });
      }
    }

    const fadeIn = val.fadeInSec ?? FADE_IN_DEFAULT_SEC;
    const fadeOut = val.fadeOutSec ?? FADE_OUT_DEFAULT_SEC;
    if (fadeIn + fadeOut >= val.durationSec / 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fadeInSec'],
        message: '淡入加淡出必须小于成片时长的一半',
      });
    }
  });

/** Inferred props type for the ambience template. */
export type AtmosphereProps = z.infer<typeof AtmospherePropsSchema>;

/** Parse and validate unknown input, throwing a readable error on failure. */
export function parseAtmosphereProps(input: unknown): AtmosphereProps {
  const result = AtmospherePropsSchema.safeParse(input);
  if (!result.success) {
    throw new Error('props 校验失败：\n' + formatZodIssues(result.error));
  }
  return result.data;
}

/** Resolved fade lengths (seconds), applying the defaults. */
export function resolveFades(props: AtmosphereProps): { fadeInSec: number; fadeOutSec: number } {
  return {
    fadeInSec: props.fadeInSec ?? FADE_IN_DEFAULT_SEC,
    fadeOutSec: props.fadeOutSec ?? FADE_OUT_DEFAULT_SEC,
  };
}

/** Frame layout of the ambience reel. */
export interface AtmosphereTiming {
  totalFrames: number;
  fadeInFrames: number;
  fadeOutFrames: number;
  sourceInFrames: number;
}

/** Compute the frame layout from validated props. */
export function computeAtmosphereTiming(props: AtmosphereProps): AtmosphereTiming {
  const fades = resolveFades(props);
  return {
    totalFrames: Math.round(props.durationSec * FPS),
    fadeInFrames: Math.round(fades.fadeInSec * FPS),
    fadeOutFrames: Math.round(fades.fadeOutSec * FPS),
    sourceInFrames: Math.round((props.sourceIn ?? 0) * FPS),
  };
}

/** De-duplicated list of every referenced asset file name. */
export function collectAtmosphereAssetFiles(props: AtmosphereProps): string[] {
  const files: string[] = [];
  files.push(props.clip);
  files.push(props.logoFile);
  if (props.musicFile !== null) {
    files.push(props.musicFile);
  }
  return Array.from(new Set(files));
}
