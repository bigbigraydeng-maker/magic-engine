import { z } from 'zod';
import { requiredBeatCount } from './timing.ts';

/** Minimum number of checklist items. */
export const MIN_ITEMS = 3;
/** Maximum number of checklist items. */
export const MAX_ITEMS = 7;

/** Relative path made only of safe segments (no leading slash, backslash, colon, spaces). */
export const SAFE_REL_PATH =
  /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

/** Rough width budget of one hook line (118px bold caps; 10 wide letters already pass the 960px safe edge). */
export const MAX_HOOK_LINE_CHARS = 9;

/** Allowed video clip extensions. */
export const CLIP_EXTS = ['.mp4', '.mov', '.webm'];
/** Allowed music extensions. */
export const MUSIC_EXTS = ['.mp3', '.wav', '.m4a'];
/** Allowed logo image extensions. */
export const LOGO_EXTS = ['.png', '.jpg', '.jpeg', '.webp'];

/** Exactly 6 hex digits with a leading #. */
export const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

const NO_CONTROL_CHARS = /^[^\u0000-\u001f\u007f]*$/;

/** Build a validator for a safe relative file name with an allowed extension. */
export function relFile(kind: string, exts: string[]) {
  return z
    .string()
    .max(120)
    .refine((v) => SAFE_REL_PATH.test(v), {
      message: `${kind}只能是相对文件名（不许网址、绝对路径、..）`,
    })
    .refine((v) => !v.includes('..'), {
      message: `${kind}只能是相对文件名（不许网址、绝对路径、..）`,
    })
    .refine(
      (v) => {
        const lower = v.toLowerCase();
        return exts.some((ext) => lower.endsWith(ext));
      },
      { message: `${kind}扩展名只能是 ${exts.join('/')}` },
    );
}

/** Build a trimmed, non-empty, control-char-free text validator with a max length. */
export function text(max: number) {
  return z
    .string()
    .trim()
    .min(1, { message: '文字不能为空' })
    .max(max, { message: `文字太长（最多 ${max} 个字符）` })
    .refine((v) => NO_CONTROL_CHARS.test(v), { message: '文字不能包含控制字符' });
}

const HOOK_LINE = z
  .object({
    badge: text(6).nullable(),
    text: text(9),
  })
  .strict();

const ITEM = z
  .object({
    text: text(48),
    clip: relFile('条目镜头', CLIP_EXTS),
    blurBackdrop: z.boolean(),
  })
  .strict();

const PRICE = z
  .object({
    backdropClip: relFile('价格背景镜头', CLIP_EXTS),
    fromLabel: text(20),
    currencyPrefix: text(6),
    amount: z.number().int().positive().max(9999999),
    qualifier: text(40),
    dateLine: text(40).optional(),
    footnote: text(80),
    footnoteSize: z.number().int().min(30, { message: '脚注字号必须在 30 到 60 之间' }).max(60, { message: '脚注字号必须在 30 到 60 之间' }).optional(),
    layout: z.enum(['center', 'corner']).optional(),
    qualifierSize: z.number().int().min(30, { message: '限定语字号必须在 30 到 60 之间' }).max(60, { message: '限定语字号必须在 30 到 60 之间' }).optional(),
    footnoteBackdrop: z.boolean().optional(),
  })
  .strict();

/** Schema for the generic "what's included" checklist video template props. */
export const ListReelPropsSchema = z
  .object({
    brandColor: z.string().regex(HEX_COLOR, {
      message: '颜色必须是 #RRGGBB 十六进制',
    }),
    itemOverlayOpacity: z
      .number()
      .min(0, { message: '遮罩深浅必须在 0 到 0.6 之间' })
      .max(0.6, { message: '遮罩深浅必须在 0 到 0.6 之间' }),
    logoFile: relFile('logo 文件', LOGO_EXTS),
    logoMode: z
      .enum(['last_beats', 'always'], {
        message: 'logoMode 只能是 last_beats 或 always',
      })
      .optional(),
    cutFlash: z.boolean().optional(),
    footageScrim: z
      .number()
      .min(0, { message: '底部压暗强度必须在 0 到 1 之间' })
      .max(1, { message: '底部压暗强度必须在 0 到 1 之间' })
      .optional(),
    musicFile: relFile('音乐文件', MUSIC_EXTS).nullable(),
    musicStartSec: z.number().min(0).max(600).optional(),
    beats: z.array(z.number().finite().min(0).max(120)).max(80),
    hook: z
      .object({
        clip: relFile('开场镜头', CLIP_EXTS),
        lines: z.tuple([HOOK_LINE, HOOK_LINE, HOOK_LINE]),
      })
      .strict(),
    items: z
      .array(ITEM)
      .min(MIN_ITEMS, { message: '条目数量最少 3 个' })
      .max(MAX_ITEMS, { message: '条目数量最多 7 个' }),
    itemLabel: text(24),
    itemLabelSize: z.number().int().min(30, { message: '条目标签字号必须在 30 到 64 之间' }).max(64, { message: '条目标签字号必须在 30 到 64 之间' }).optional(),
    revealTitle: text(40),
    revealTitleSize: z.number().int().min(36, { message: '片尾标题字号必须在 36 到 60 之间' }).max(60, { message: '片尾标题字号必须在 36 到 60 之间' }).optional(),
    price: PRICE,
  })
  .strict()
  .superRefine((val, ctx) => {
    // The corner card sits in the lower right (x 270-960, from y=820) and must stay inside the 1248 safe-zone
    // floor and the 960 right edge, so its text blocks are capped to one line each.
    if (val.price.layout === 'corner') {
      const p = val.price;
      const tooBig = (p.qualifierSize ?? 40) > 48 || (p.footnoteSize ?? 30) > 40;
      const tooLong = p.qualifier.length > 26 || p.footnote.length > 26 || (p.dateLine ?? '').length > 24;
      if (tooBig || tooLong) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['price', 'layout'],
          message: '右下小卡版式：限定语≤26字且字号≤48、脚注≤26字且字号≤40、日期行≤24字（否则会超出安全区）',
        });
      }
    }
    const beats = val.beats;
    for (let i = 1; i < beats.length; i++) {
      if (beats[i] <= beats[i - 1]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['beats'],
          message: '节拍必须严格递增',
        });
        break;
      }
    }

    const needed = requiredBeatCount(val.items.length);
    if (beats.length < needed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['beats'],
        message: `节拍数量不够：${val.items.length} 个条目至少需要 ${needed} 个节拍，现在只有 ${beats.length} 个`,
      });
      return;
    }

    if (beats[needed - 1] > 90) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['beats'],
        message: '成片总时长不能超过 90 秒',
      });
    }

    val.hook.lines.forEach((line, i) => {
      const width = (line.badge === null ? 0 : line.badge.length + 1) + line.text.length;
      if (width > MAX_HOOK_LINE_CHARS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['hook', 'lines', i],
          message: `开场第 ${i + 1} 行太长（含徽章最多约 ${MAX_HOOK_LINE_CHARS} 个字符，否则会折行）`,
        });
      }
    });
  });

/** Inferred props type for the checklist video template. */
export type ListReelProps = z.infer<typeof ListReelPropsSchema>;

/** Format zod issues as one human-readable line per issue. */
export function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.') || '(根)';
      return `字段 ${path}：${issue.message}`;
    })
    .join('\n');
}

/** Parse and validate unknown input, throwing a readable error on failure. */
export function parseListReelProps(input: unknown): ListReelProps {
  const result = ListReelPropsSchema.safeParse(input);
  if (!result.success) {
    throw new Error('props 校验失败：\n' + formatZodIssues(result.error));
  }
  return result.data;
}

/** Collect the de-duplicated list of every referenced asset file name. */
export function collectAssetFiles(props: ListReelProps): string[] {
  const files: string[] = [];
  files.push(props.logoFile);
  if (props.musicFile !== null) {
    files.push(props.musicFile);
  }
  files.push(props.hook.clip);
  for (const item of props.items) {
    files.push(item.clip);
  }
  files.push(props.price.backdropClip);
  return Array.from(new Set(files));
}
