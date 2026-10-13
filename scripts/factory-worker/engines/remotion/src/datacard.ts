import { z } from 'zod';
import { FPS } from './timing.ts';
import { HEX_COLOR, MUSIC_EXTS, LOGO_EXTS, relFile, text, formatZodIssues } from './schema.ts';

/** Fewest data rows a data card may show. */
export const MIN_ROWS = 3;
/** Most data rows a data card may show. */
export const MAX_ROWS = 7;
/** Most hook lines. */
export const MAX_HOOK_LINES = 2;
/** Widest hook line (characters); longer lines would shrink below readable size. */
export const MAX_HOOK_LINE_CHARS = 12;
/** Minimum WCAG contrast of body text on the background. */
export const MIN_TEXT_CONTRAST = 4.5;
/** Minimum WCAG contrast of the accent (values, bars) on the background. */
export const MIN_ACCENT_CONTRAST = 3;
/** Frames the hook takes to shrink from centre stage to its compact slot. */
export const HOOK_SETTLE_FRAMES = 15;

const hexColor = z.string().regex(HEX_COLOR, { message: '颜色必须是 #RRGGBB 十六进制' });

const ROW = z
  .object({
    label: text(28),
    value: text(14),
    sublabel: text(44).nullable(),
    bar: z
      .number()
      .min(0, { message: '条形长度必须在 0 到 1 之间' })
      .max(1, { message: '条形长度必须在 0 到 1 之间' })
      .nullable(),
  })
  .strict();

/** Schema for the generic data-card video template props. No defaults: a missing field is rejected. */
export const DataCardPropsSchema = z
  .object({
    bgColor: hexColor,
    textColor: hexColor,
    brandColor: hexColor,
    logoFile: relFile('logo 文件', LOGO_EXTS).nullable(),
    musicFile: relFile('音乐文件', MUSIC_EXTS).nullable(),
    musicStartSec: z.number().min(0).max(600).optional(),
    hook: z
      .object({
        lines: z.array(text(MAX_HOOK_LINE_CHARS)).min(1).max(MAX_HOOK_LINES),
      })
      .strict(),
    hookSec: z
      .number()
      .min(1, { message: '开场停留必须在 1 到 4 秒之间' })
      .max(4, { message: '开场停留必须在 1 到 4 秒之间' }),
    rows: z
      .array(ROW)
      .min(MIN_ROWS, { message: '数据行最少 3 行' })
      .max(MAX_ROWS, { message: '数据行最多 7 行' }),
    rowSec: z
      .number()
      .min(0.6, { message: '每行间隔必须在 0.6 到 2.5 秒之间' })
      .max(2.5, { message: '每行间隔必须在 0.6 到 2.5 秒之间' }),
    holdSec: z
      .number()
      .min(1, { message: '结尾停留必须在 1 到 6 秒之间' })
      .max(6, { message: '结尾停留必须在 1 到 6 秒之间' }),
    barMode: z.enum(['none', 'bars', 'steps'], {
      message: 'barMode 只能是 none、bars 或 steps',
    }),
    disclaimer: text(60),
  })
  .strict()
  .superRefine((val, ctx) => {
    const hasBar = val.rows.map((r) => r.bar !== null);
    if (val.barMode === 'none' && hasBar.some(Boolean)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['rows'], message: 'barMode 为 none 时每行 bar 必须是 null' });
    }
    if (val.barMode !== 'none' && !hasBar.every(Boolean)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['rows'], message: 'barMode 不是 none 时每行都必须写 bar（0 到 1）' });
    }
    const textRatio = contrastRatio(val.textColor, val.bgColor);
    if (textRatio < MIN_TEXT_CONTRAST) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['textColor'], message: `文字色与背景色对比度只有 ${textRatio.toFixed(1)}，至少需要 ${MIN_TEXT_CONTRAST}` });
    }
    const accentRatio = contrastRatio(val.brandColor, val.bgColor);
    if (accentRatio < MIN_ACCENT_CONTRAST) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['brandColor'], message: `品牌色与背景色对比度只有 ${accentRatio.toFixed(1)}，至少需要 ${MIN_ACCENT_CONTRAST}` });
    }
  });

/** Inferred props type for the data-card template. */
export type DataCardProps = z.infer<typeof DataCardPropsSchema>;

/** WCAG relative luminance of a #RRGGBB colour. */
function luminance(hex: string): number {
  const channel = (offset: number) => {
    const v = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG contrast ratio between two #RRGGBB colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Parse and validate unknown input, throwing a readable error on failure. */
export function parseDataCardProps(input: unknown): DataCardProps {
  const result = DataCardPropsSchema.safeParse(input);
  if (!result.success) {
    throw new Error('props 校验失败：\n' + formatZodIssues(result.error));
  }
  return result.data;
}

/** Frame layout of the data card. */
export interface DataCardTiming {
  hookFrames: number;
  rowFrames: number;
  /** First frame of each row's reveal. */
  rowFrom: number[];
  totalFrames: number;
}

/** Compute the frame layout from validated props (hook holds, rows appear on a fixed cadence, last row holds). */
export function computeDataCardTiming(
  props: Pick<DataCardProps, 'hookSec' | 'rowSec' | 'holdSec' | 'rows'>,
): DataCardTiming {
  const hookFrames = Math.round(props.hookSec * FPS);
  const rowFrames = Math.round(props.rowSec * FPS);
  const rowFrom = props.rows.map((_, i) => hookFrames + i * rowFrames);
  const totalFrames = hookFrames + props.rows.length * rowFrames + Math.round(props.holdSec * FPS);
  return { hookFrames, rowFrames, rowFrom, totalFrames };
}

/** De-duplicated list of every referenced asset file name. */
export function collectDataCardAssetFiles(props: DataCardProps): string[] {
  const files: string[] = [];
  if (props.logoFile !== null) files.push(props.logoFile);
  if (props.musicFile !== null) files.push(props.musicFile);
  return Array.from(new Set(files));
}
