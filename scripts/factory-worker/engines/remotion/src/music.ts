import { z } from 'zod';
import { requiredBeatCount } from './timing.ts';
import { SAFE_REL_PATH, MUSIC_EXTS, formatZodIssues } from './schema.ts';

/** Folders under the studio root that may hold music files. */
export const MUSIC_FOLDERS = ['Music', '_shared/music'] as const;

/** A detected tempo above this is treated as double-time and halved. */
export const FOLD_ABOVE_BPM = 150;

const NO_SLASH_OR_CONTROL = /^[^/\u0000-\u001f\u007f]*$/;

/** One music track entry in the catalog. */
export const MusicEntrySchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
        message: '音乐 id 只能是小写字母、数字和连字符',
      })
      .max(40, { message: '音乐 id 太长（最多 40 个字符）' }),
    folder: z.enum(MUSIC_FOLDERS),
    file: z
      .string()
      .min(1, { message: '音乐文件名不能为空' })
      .max(120, { message: '音乐文件名太长（最多 120 个字符）' })
      .refine((v) => NO_SLASH_OR_CONTROL.test(v), {
        message: '音乐文件名不能包含斜杠或控制字符',
      }),
    durationSec: z
      .number()
      .positive({ message: '音乐时长必须大于 0' })
      .max(1200, { message: '音乐时长最多 1200 秒' }),
    bpmDetected: z
      .number()
      .min(60, { message: '检测到的 BPM 必须在 60 到 220 之间' })
      .max(220, { message: '检测到的 BPM 必须在 60 到 220 之间' }),
    offsetSec: z
      .number()
      .min(0, { message: '偏移必须在 0 到 2 秒之间' })
      .lt(2, { message: '偏移必须在 0 到 2 秒之间' }),
    barPhase: z
      .number()
      .int({ message: '小节相位必须是 0 到 3 的整数' })
      .min(0, { message: '小节相位必须是 0 到 3 的整数' })
      .max(3, { message: '小节相位必须是 0 到 3 的整数' }),
    status: z.enum(['ready', 'pending_listen']),
    energy: z.enum(['low', 'mid', 'high']),
    style: z
      .string()
      .trim()
      .min(1, { message: '风格不能为空' })
      .max(40, { message: '风格太长（最多 40 个字符）' }),
    mood: z
      .string()
      .trim()
      .min(1, { message: '情绪不能为空' })
      .max(40, { message: '情绪太长（最多 40 个字符）' }),
  })
  .strict();

/** Schema for the music catalog file. */
export const MusicCatalogSchema = z
  .object({
    version: z.literal(1),
    tracks: z.array(MusicEntrySchema).min(1, { message: '音乐目录至少要有一首曲子' }),
  })
  .strict()
  .superRefine((val, ctx) => {
    const seen = new Set<string>();
    for (const track of val.tracks) {
      if (seen.has(track.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['tracks'],
          message: `音乐 id 重复：${track.id}`,
        });
        return;
      }
      seen.add(track.id);
    }
  });

/** Inferred type for one music track entry. */
export type MusicEntry = z.infer<typeof MusicEntrySchema>;

/** Inferred type for the music catalog. */
export type MusicCatalog = z.infer<typeof MusicCatalogSchema>;

/** Parse and validate unknown input, throwing a readable error on failure. */
export function parseMusicCatalog(input: unknown): MusicCatalog {
  const result = MusicCatalogSchema.safeParse(input);
  if (!result.success) {
    throw new Error('音乐目录校验失败：\n' + formatZodIssues(result.error));
  }
  return result.data;
}

/** Fold a double-time detection back to its musical tempo. */
export function effectiveBpm(bpmDetected: number): number {
  if (bpmDetected > FOLD_ABOVE_BPM) {
    return Math.round((bpmDetected / 2) * 10) / 10;
  }
  return bpmDetected;
}

/** Build the safe staged file name (id + lowercased extension) for a track. */
export function stagedFileName(entry: Pick<MusicEntry, 'id' | 'file'>): string {
  const dot = entry.file.lastIndexOf('.');
  if (dot < 0) {
    throw new Error('音乐文件扩展名不支持：' + entry.file);
  }
  const ext = entry.file.slice(dot).toLowerCase();
  if (!MUSIC_EXTS.includes(ext)) {
    throw new Error('音乐文件扩展名不支持：' + entry.file);
  }
  const staged = `${entry.id}${ext}`;
  if (!SAFE_REL_PATH.test(staged)) {
    throw new Error('音乐暂存文件名不合法：' + staged);
  }
  return staged;
}

/** Round a number to 3 decimal places. */
function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Compute `count` beat times (seconds from the start of the audio). */
export function beatGrid(entry: MusicEntry, count: number): number[] {
  if (!Number.isInteger(count) || count < 1 || count > 80) {
    throw new Error('节拍数量必须是 1 到 80 的整数');
  }
  const basePeriod = 60 / entry.bpmDetected;
  const step = entry.bpmDetected > FOLD_ABOVE_BPM ? 2 : 1;
  const firstIndex = step === 1 ? entry.barPhase : entry.barPhase % 2;
  const out: number[] = [];
  for (let k = 0; k < count; k++) {
    out.push(round3(entry.offsetSec + (firstIndex + k * step) * basePeriod));
  }
  const last = out[out.length - 1];
  if (last > entry.durationSec - 1) {
    throw new Error('音乐太短：' + entry.id + ' 放不下 ' + count + ' 个节拍');
  }
  return out;
}

/** Compute the beat times needed for a video with `itemCount` items. */
export function beatsFor(entry: MusicEntry, itemCount: number): number[] {
  return beatGrid(entry, requiredBeatCount(itemCount));
}
