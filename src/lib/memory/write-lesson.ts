/**
 * 往跨客户经验池写东西的**唯一入口**。
 *
 * ── 为什么必须只有一个入口 ──────────────────────────────────────────────
 * 狄仁杰 2026-08-04 复验的第一条：`assertShareable` 写好了，但**零个生产调用方**。
 * 一道没人调的闸等于不存在 —— 而 `global_learned_lessons` 当时那 11 条全是
 * 手敲 SQL 塞进去的，零校验，其中 5 条含买家真名和每 lead 成本，
 * 每天注入至少 8 个客户的提示词。
 *
 * 所以这个模块存在的意义不是「方便」，是**让「绕过校验」变成一件要专门去做的事**。
 * 同一张表里就躺着 `config-must-go-through-ui-not-direct-db-write` 这条经验，
 * 它自己就是那条经验的反例。
 *
 * ── 脱敏不通过就是写入失败，不是警告 ────────────────────────────────────
 * 抛出去，让调用方当场看见。写进去再标红没有意义：这张表的内容会被
 * `format.ts` 原样拼进提示词，落库那一刻就已经在对外了。
 *
 * ── 客户名 / 人名从库里查，不由调用方给 ─────────────────────────────────
 * 让调用方传「要避开哪些名字」等于让它自己决定查得严不严。这里一次查全库，
 * 调用方没有放松的余地。
 *
 * ── 同步行必须一次写完（契约 4.8）────────────────────────────────────────
 * 带来源的 lesson 如果先 upsert 再 update 补列，中间那一瞬是
 * 「is_active=true 且来源字段为空」的可注入半成品。所以来源字段、脱敏时间、
 * 脱敏结论、有效期与正文放在**同一条** upsert 里；字段不全就当场拒绝，不发请求。
 *
 * ── 时间必须是真实存在的 ISO 时间 ───────────────────────────────────────
 * `Date.parse('2099-02-31T00:00:00.000Z')` 不会报错，它会悄悄滚成 3 月 3 日；
 * `Date.parse('12/31/2099')` 也照收。有效期的含义是「这条规则什么时候失效」，
 * 滚一天就是一天的区别，所以这里用 `parseStrictIsoInstant` 先做严格的形状 +
 * 日历校验，过了才交给 `Date.parse`。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { assertShareable, checkShareable, type ShareabilityVerdict } from './lesson-shareability'
import { LEARNING_PILLARS, type LearningPillar } from '@/lib/agent-learning/contracts'
import { RULE_ID_RE } from '@/lib/skill-cards/board'

export type LessonScope = 'global' | 'channel' | 'industry'

/** 同步行的来源信息；有它时走「一次写完」路径，字段一次齐才能落库（契约 4.8） */
export interface LessonProvenance {
  sourcePointKey: string
  sourceCardId: string
  pillar: LearningPillar
  validUntil: string          // ISO 时间，必须是未来
  lastReviewedAt?: string     // ISO 时间，可选
}

export interface LessonInput {
  lessonKey: string
  scope: LessonScope
  /** `industry` 作用域必给 —— 不给就等于偷偷升级成全局。 */
  industry?: string | null
  flywheel?: string | null
  lesson: string
  rationale?: string | null
  confidence: number
  /**
   * 个案证据。**这里可以放金额、客户名、具体数字** —— evidence 不进提示词，
   * 它是给人回查用的。「术」留在 lesson/rationale，「案例」全丢这里。
   */
  evidence?: Record<string, unknown> | null
  /** 有它时走「一次写完」路径，见契约 4.8。 */
  provenance?: LessonProvenance
  /**
   * 默认 `true`（老调用方行为不变）。给 `false` = 写成未启用的候选，
   * 不进任何提示词，要人在广告引擎页点开才算采纳。
   */
  isActive?: boolean
}

/**
 * 只认「完整时间戳 + 时区」这一种形状：`YYYY-MM-DDTHH:mm:ss[.fraction](Z|±HH:mm)`。
 * 日期只有日期、没有时区、用斜杠、带首尾空格的，一律不收（**不做 trim**：
 * 能带空格进来就说明上游给的字符串不可信）。
 */
const STRICT_ISO_INSTANT_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function daysInMonth(year: number, month: number): number {
  const table = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (month === 2 && isLeapYear(year)) return 29
  return table[month - 1]
}

/**
 * 严格解析一个 ISO 瞬时时间，返回 epoch 毫秒；不是**真实存在**的完整 ISO 时间就返回 `null`。
 *
 * 纯函数，不读库不写库。存在的理由：`Date.parse` 会把 `'2099-02-31T00:00:00.000Z'`
 * 滚成 3 月 3 日、也会接受 `'12/31/2099'`，而有效期滚一天就是规则多活一天。
 *
 * 校验顺序：① 形状（正则，含时分秒与时区）→ ② 真实日历（月 1..12、日 1..当月天数含闰年、
 * 时 0..23、分 0..59、秒 0..59、偏移小时 0..23、偏移分钟 0..59）→ ③ `Date.parse` 且有限。
 */
export function parseStrictIsoInstant(value: unknown): number | null {
  if (typeof value !== 'string') return null

  const match = STRICT_ISO_INSTANT_RE.exec(value)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const zone = match[7]

  if (month < 1 || month > 12) return null
  if (day < 1 || day > daysInMonth(year, month)) return null
  if (hour > 23 || minute > 59 || second > 59) return null

  if (zone !== 'Z') {
    const offsetHour = Number(zone.slice(1, 3))
    const offsetMinute = Number(zone.slice(4, 6))
    if (offsetHour > 23 || offsetMinute > 59) return null
  }

  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/** 一次查全库的客户名与人名，给脱敏闸用。 */
export async function loadShareabilityContext(
  supabase: SupabaseClient,
): Promise<{ clientNames: string[]; personNames: string[] }> {
  const [{ data: clients }, { data: contacts }] = await Promise.all([
    supabase.from('clients').select('name'),
    supabase.from('contacts').select('full_name').not('full_name', 'is', null).limit(5000),
  ])

  const clientNames = ((clients ?? []) as { name: string | null }[])
    .map((c) => c.name ?? '')
    .filter((n) => n.trim().length >= 2)

  // 人名只取有意义长度的，避免 "Li" 这种两字母名把正常英文全判成泄露。
  const personNames = ((contacts ?? []) as { full_name: string | null }[])
    .map((c) => c.full_name ?? '')
    .filter((n) => n.trim().length >= 3)

  return { clientNames, personNames }
}

/**
 * 校验来源字段是否齐全、是否可注入。返回中文错误，`null` 表示合格。
 * 纯函数：不读库、不写库，调用方可以在发任何请求之前先用它挡一次。
 */
export function validateProvenance(
  provenance: LessonProvenance,
  lesson: string,
  now: Date,
): string | null {
  if (!provenance.sourcePointKey?.trim() || !provenance.sourceCardId?.trim()) {
    return '来源点或来源卡没给全'
  }
  if (!LEARNING_PILLARS.includes(provenance.pillar)) {
    return '支柱取值不合法'
  }
  const validUntilMs = parseStrictIsoInstant(provenance.validUntil)
  if (validUntilMs === null) {
    return '有效期格式不对，要写成完整的 ISO 时间（含时区），且必须是真实存在的日期'
  }
  if (validUntilMs <= now.getTime()) {
    return '有效期必须是未来时间'
  }
  const lastReviewedAt = provenance.lastReviewedAt
  if (lastReviewedAt !== undefined && lastReviewedAt !== null) {
    if (parseStrictIsoInstant(lastReviewedAt) === null) {
      return '复核时间格式不对，要写成完整的 ISO 时间（含时区），且必须是真实存在的日期'
    }
  }
  if (RULE_ID_RE.test(lesson.trim())) {
    return '经验正文是规则编号，不是规则句'
  }
  return null
}

/**
 * 组装唯一一条 upsert 的行。
 * 没有 provenance 时**只**返回今天已有的列，一个字节都不多，老调用方行为不变。
 */
function buildLessonRow(
  input: LessonInput,
  verdict: ShareabilityVerdict,
  now: Date,
): Record<string, unknown> {
  const row: Record<string, unknown> = {
    lesson_key: input.lessonKey,
    scope: input.scope,
    industry: input.scope === 'industry' ? input.industry : null,
    flywheel: input.flywheel ?? null,
    lesson: input.lesson,
    rationale: input.rationale ?? null,
    confidence: input.confidence,
    evidence: input.evidence ?? null,
    is_active: input.isActive ?? true,
    updated_at: now.toISOString(),
  }

  const provenance = input.provenance
  if (!provenance) return row

  // 来源字段、脱敏时间、脱敏结论、有效期与正文在同一条 upsert 里落库（契约 4.8）。
  // 走到这里说明 validUntil / lastReviewedAt 已经过 parseStrictIsoInstant，可放心转 ISO。
  row.source_point_key = provenance.sourcePointKey
  row.source_card_id = provenance.sourceCardId
  row.pillar = provenance.pillar
  row.valid_until = new Date(provenance.validUntil).toISOString()
  if (provenance.lastReviewedAt !== undefined && provenance.lastReviewedAt !== null) {
    row.last_reviewed_at = new Date(provenance.lastReviewedAt).toISOString()
  }
  // sanitized_at 与 shareability_verdict 由本函数自己填，不接受调用方传入（防伪造）。
  row.sanitized_at = now.toISOString()
  row.shareability_verdict = verdict
  return row
}

export type WriteLessonResult =
  | { ok: true; lessonKey: string }
  | { ok: false; reason: 'not_shareable'; verdict: ShareabilityVerdict }
  | { ok: false; reason: 'invalid'; error: string }
  | { ok: false; reason: 'db'; error: string }

/**
 * 写一条跨客户经验。脱敏不过 → 不写，返回 `not_shareable` 并带上逐条命中。
 *
 * 返回错误而不是抛：调用方多半是 API 路由，需要把命中原样回给人看，
 * 好知道该改哪一句。要「不过就炸」的语义，用 `assertShareable` 本身。
 */
export async function writeGlobalLesson(
  supabase: SupabaseClient,
  input: LessonInput,
): Promise<WriteLessonResult> {
  // 一次调用只取一次时钟：updated_at 与 sanitized_at 必须同源。
  const now = new Date()

  if (!input.lessonKey?.trim()) return { ok: false, reason: 'invalid', error: '没给 lesson_key' }
  if (!input.lesson?.trim()) return { ok: false, reason: 'invalid', error: '经验正文是空的' }
  if (input.scope === 'industry' && !input.industry?.trim()) {
    // 行业作用域缺行业 = 它会被当成谁都读得到 —— 静默扩大了受众。
    return { ok: false, reason: 'invalid', error: '行业作用域必须说清是哪个行业' }
  }
  if (!(input.confidence >= 0 && input.confidence <= 1)) {
    return { ok: false, reason: 'invalid', error: '置信度要在 0 到 1 之间' }
  }

  // 带来源的行：字段不全当场拒，连读库都不做（契约 4.8 第 ① 步）。
  if (input.provenance) {
    const invalid = validateProvenance(input.provenance, input.lesson, now)
    if (invalid) return { ok: false, reason: 'invalid', error: invalid }
  }

  const ctx = await loadShareabilityContext(supabase)
  const verdict = checkShareable(input.lesson, input.rationale, ctx)
  if (!verdict.shareable) return { ok: false, reason: 'not_shareable', verdict }

  // 只发一次 upsert：禁止「先 upsert 再 update 补列」的两步写法（会留可注入半成品）。
  const { error } = await supabase
    .from('global_learned_lessons')
    .upsert(buildLessonRow(input, verdict, now), { onConflict: 'lesson_key' })

  if (error) return { ok: false, reason: 'db', error: error.message }
  return { ok: true, lessonKey: input.lessonKey }
}

/**
 * 给非路由调用方（cron、后台 agent）的强制版：不过就抛。
 *
 * 这是 `assertShareable` 真正的生产调用点 —— 在它存在之前，那道闸只有测试在调。
 *
 * 来源校验放在最前面：`loadShareabilityContext` 是**读库**操作，
 * 字段不全的行连查库都不该发生（无效输入不配触发任何 I/O）。
 */
export async function writeGlobalLessonOrThrow(
  supabase: SupabaseClient,
  input: LessonInput,
): Promise<void> {
  if (input.provenance) {
    const invalid = validateProvenance(input.provenance, input.lesson, new Date())
    if (invalid) throw new Error(`写入失败：${invalid}`)
  }

  const ctx = await loadShareabilityContext(supabase)
  assertShareable(input.lesson, input.rationale, ctx)
  const r = await writeGlobalLesson(supabase, input)
  if (!r.ok) {
    throw new Error(
      r.reason === 'not_shareable' ? r.verdict.summary : `写入失败：${r.error}`,
    )
  }
}
