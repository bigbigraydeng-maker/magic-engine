import { z } from 'zod';
import { FPS } from './timing.ts';
import { HEX_COLOR, MUSIC_EXTS, LOGO_EXTS, relFile, text, formatZodIssues, musicGainSchema, frameSchema } from './schema.ts';

/** Fewest data rows a data card may show. */
export const MIN_ROWS = 3;
/** Most data rows a data card may show. */
export const MAX_ROWS = 7;
/** Most hook lines. */
export const MAX_HOOK_LINES = 2;
/** Widest hook line (characters); longer lines would shrink below readable size. */
export const MAX_HOOK_LINE_CHARS = 12;
/** Widest label / sublabel / disclaimer (characters); the renderer shrinks the font so even all-capital text of this length fits one line. */
export const MAX_LABEL_CHARS = 20;
export const MAX_SUBLABEL_CHARS = 28;
/** Widest value text (characters); sized so even ten all-capital W still fits the value column. */
export const MAX_VALUE_CHARS = 10;
export const MAX_DISCLAIMER_CHARS = 44;
/** Minimum WCAG contrast of body text on the background. */
export const MIN_TEXT_CONTRAST = 4.5;
/** Minimum WCAG contrast of the accent (values, bars) on the background. */
export const MIN_ACCENT_CONTRAST = 3;
/** Frames the hook takes to shrink from centre stage to its compact slot. */
export const HOOK_SETTLE_FRAMES = 15;

const hexColor = z.string().regex(HEX_COLOR, { message: '颜色必须是 #RRGGBB 十六进制' });

const ROW = z
  .object({
    label: text(MAX_LABEL_CHARS),
    value: text(MAX_VALUE_CHARS),
    sublabel: text(MAX_SUBLABEL_CHARS).nullable(),
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
    musicGain: musicGainSchema,
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
    disclaimer: text(MAX_DISCLAIMER_CHARS),
    frame: frameSchema.optional(),
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
    // judge each text role on the colour it is actually painted over, after its opacity
    const card = cardColor(val.bgColor, val.textColor);
    const roles: Array<[string, number]> = [
      ['背景上的文字', contrastRatio(val.textColor, val.bgColor)],
      ['卡片上的主标签', contrastRatio(val.textColor, card)],
      ['卡片上的副标签', contrastRatio(blend(val.textColor, card, SUBLABEL_OPACITY), card)],
      ['免责文案', contrastRatio(blend(val.textColor, val.bgColor, DISCLAIMER_OPACITY), val.bgColor)],
    ];
    for (const [role, ratio] of roles) {
      if (ratio < MIN_TEXT_CONTRAST) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['textColor'], message: `${role}合成后对比度只有 ${ratio.toFixed(1)}，至少需要 ${MIN_TEXT_CONTRAST}` });
      }
    }
    // values and bars sit on the translucent card; the hook's last line uses the brand colour straight on the background
    const accentRatio = Math.min(
      contrastRatio(val.brandColor, cardColor(val.bgColor, val.textColor)),
      contrastRatio(val.brandColor, val.bgColor),
    );
    if (accentRatio < MIN_ACCENT_CONTRAST) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['brandColor'], message: `品牌色在卡片底色或背景上的对比度只有 ${accentRatio.toFixed(1)}，至少需要 ${MIN_ACCENT_CONTRAST}` });
    }
  });

/** Inferred props type for the data-card template. */
export type DataCardProps = z.infer<typeof DataCardPropsSchema>;

/** Opacity the renderer applies to row sublabels. */
export const SUBLABEL_OPACITY = 0.85;
/** Opacity the renderer applies to the disclaimer line. */
export const DISCLAIMER_OPACITY = 0.8;

/** Colour of `fg` painted at `alpha` over `bg`, as #RRGGBB. */
export function blend(fg: string, bg: string, alpha: number): string {
  const mix = (o: number) => {
    const b = parseInt(bg.slice(o, o + 2), 16);
    const f = parseInt(fg.slice(o, o + 2), 16);
    return Math.round(f * alpha + b * (1 - alpha)).toString(16).padStart(2, '0');
  };
  return `#${mix(1)}${mix(3)}${mix(5)}`;
}

/** Card fill (textColor at alpha 0x14 over bgColor) as #RRGGBB, matching how the renderer paints it. */
export function cardColor(bg: string, fg: string): string {
  const a = 0x14 / 255;
  const mix = (o: number) => {
    const b = parseInt(bg.slice(o, o + 2), 16);
    const f = parseInt(fg.slice(o, o + 2), 16);
    return Math.round(f * a + b * (1 - a)).toString(16).padStart(2, '0');
  };
  return `#${mix(1)}${mix(3)}${mix(5)}`;
}

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
