import { z } from 'zod'
import { HEX_COLOR, CLIP_EXTS, LOGO_EXTS, MUSIC_EXTS, formatZodIssues, musicGainSchema, relFile, text } from './schema.ts'
import { bannedWordHits, isAcceptableSourceUrl, priceMentionHits, quoteSupports } from './postcard.ts'
import { computeComparePlan, type ComparePlan } from './styles/compare-plan.ts'
import { defaultRules, type ViralRules } from './styles/rules.ts'

const BEAT = z
  .object({
    clip: relFile('镜头文件', CLIP_EXTS),
    line: text(48),
    sourceUrl: z.string(),
    sourceQuote: text(300),
  })
  .strict()

/** Before / process / after. Three beats, then hold on the finished picture. */
export const ComparePropsSchema = z
  .object({
    brandColor: z.string().regex(HEX_COLOR, { message: '品牌色必须是 #RRGGBB' }),
    logoFile: relFile('logo 文件', LOGO_EXTS),
    musicFile: relFile('音乐文件', MUSIC_EXTS).nullable(),
    musicStartSec: z.number().min(0).max(600).optional(),
    musicGain: musicGainSchema,
    scrim: z.number().min(0).max(1).optional(),
    hook: text(48),
    point: text(40),
    before: BEAT,
    process: BEAT,
    after: BEAT,
  })
  .strict()
  .superRefine((val, ctx) => {
    checkLine(val.hook, ['hook'], ctx)
    checkLine(val.point, ['point'], ctx)
    checkBeat(val.before, 'before', ctx)
    checkBeat(val.process, 'process', ctx)
    checkBeat(val.after, 'after', ctx)
  })

export type CompareProps = z.infer<typeof ComparePropsSchema>

function checkLine(value: string, path: string[], ctx: z.RefinementCtx): void {
  const hits = bannedWordHits(value).concat(priceMentionHits(value))
  if (hits.length === 0) return
  ctx.addIssue({ code: z.ZodIssueCode.custom, path, message: `文字里不能出现促销词或价格：${hits.join('、')}` })
}

function checkBeat(beat: { line: string; sourceUrl: string; sourceQuote: string }, key: string, ctx: z.RefinementCtx): void {
  if (!isAcceptableSourceUrl(beat.sourceUrl)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key, 'sourceUrl'], message: '出处链接必须是 http 或 https 网址' })
  }
  if (!quoteSupports(beat.line, beat.sourceQuote)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key, 'sourceQuote'], message: '出处片段里找不到这句话的主要词' })
  }
  checkLine(beat.line, [key, 'line'], ctx)
  checkLine(beat.sourceQuote, [key, 'sourceQuote'], ctx)
}

/** Parse a before/process/after brief. */
export function parseCompareProps(input: unknown): CompareProps {
  const result = ComparePropsSchema.safeParse(input)
  if (!result.success) throw new Error('props 校验失败：\n' + formatZodIssues(result.error))
  return result.data
}

/** Timing for the compare template. No rules means the shared defaults. shotSec overrides the pack rhythm. */
export function computeCompareTiming(rules?: ViralRules | null, shotSec?: number): ComparePlan {
  const resolved = rules ?? defaultRules()
  return computeComparePlan(resolved, 30, shotSec ?? resolved.shotSec)
}

/** On-screen strings, in reading order, for the red-line rescan. */
export function compareTextParts(props: CompareProps): Array<[string, string]> {
  return [
    ['钩子', props.hook],
    ['卖点', props.point],
    ['之前', props.before.line],
    ['过程', props.process.line],
    ['完成', props.after.line],
  ]
}

/** One caption line for the worker rescan. */
export function compareCaption(props: CompareProps): string {
  return compareTextParts(props).map(([, value]) => value).join(' · ')
}

/** Caption cues as [fromSec, toSec, text]. The worker formats the SRT. */
export function compareCues(props: CompareProps, fps: number, rules?: ViralRules | null, shotSec?: number): Array<[number, number, string]> {
  const plan = computeCompareTiming(rules, shotSec)
  const end = plan.totalFrames / fps - 0.1
  const cues: Array<[number, number, string]> = [[0, end, props.point]]
  if (plan.mode === 'single') {
    const reveal = plan.revealAt / fps
    cues.push([0, reveal, props.hook], [reveal, end, props.after.line])
    return cues
  }
  cues.push([0, plan.shots[0].frames / fps, props.hook])
  for (const shot of plan.shots) {
    cues.push([shot.from / fps, (shot.from + shot.frames) / fps, props[shot.lineKey].line])
  }
  return cues
}

/** Clips, logo and music referenced by the brief. */
export function collectCompareAssetFiles(props: CompareProps): string[] {
  const files = [props.before.clip, props.process.clip, props.after.clip, props.logoFile]
  if (props.musicFile !== null) files.push(props.musicFile)
  return Array.from(new Set(files))
}
