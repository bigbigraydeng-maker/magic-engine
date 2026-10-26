import { z } from 'zod'
import type { PlayKey } from '../play-vocabulary'
import { PLAY_KEYS } from './ad-plays'

/** 一条事实的依据：标签、值、来源、取数日期（读不到时为 null）。 */
export const basisSchema = z.object({
  label: z.string(),
  value: z.string(),
  source: z.string(),
  as_of: z.string().nullable(),
})
export type Basis = z.infer<typeof basisSchema>

/**
 * 字段结果：要么有值（附依据，至少一条），要么为空（说明为什么空）。
 * 两种都带 notes。
 */
export type Field<T> =
  | { ok: true; value: T; basis: Basis[]; notes: string[] }
  | { ok: false; why_empty: string; notes: string[] }

/** 按值类型生成 Field 的 zod schema（有值 / 为空二选一）。 */
function fieldSchema<V extends z.ZodType>(value: V) {
  return z.discriminatedUnion('ok', [
    z.object({
      ok: z.literal(true),
      value,
      basis: z.array(basisSchema).min(1),
      notes: z.array(z.string()),
    }),
    z.object({
      ok: z.literal(false),
      why_empty: z.string(),
      notes: z.array(z.string()),
    }),
  ])
}

/** 打法枚举 schema，取值来自 PLAY_KEYS。 */
const playKeySchema = z.enum(PLAY_KEYS as [PlayKey, ...PlayKey[]])

/** 计划种子里的一个广告步骤：每个字段都是 Field，缺数据时说明原因。 */
export const planSeedStepSchema = z.object({
  step_key: z.string(),
  play: playKeySchema,
  page_id: fieldSchema(z.string()),
  ad_account_id: fieldSchema(z.string()),
  daily_budget_cents: fieldSchema(z.number()),
})
export type PlanSeedStep = z.infer<typeof planSeedStepSchema>

/**
 * 计划种子：ads-agent 产出的、可直接落进推广计划的事实快照。
 * captured_at 记录每个广告账户最近一次成功快照的时间（null = 读不到）。
 */
export const planSeedSchema = z.object({
  schema_version: z.literal(1),
  produced_by: z.literal('ads-agent'),
  facts_as_of: z.string(),
  currency: z.string().nullable(),
  period: z
    .object({ start_date: z.string(), end_date: z.string() })
    .nullable(),
  captured_at: z.record(z.string(), z.string().nullable()),
  ad_steps: z.array(planSeedStepSchema),
  skipped: z.array(z.object({ step_key: z.string(), why_empty: z.string() })),
  notes: z.array(z.string()),
})
export type PlanSeed = z.infer<typeof planSeedSchema>

/** 解析计划种子；畸形输入返回 null，永不抛错。 */
export function readPlanSeed(raw: unknown): PlanSeed | null {
  const parsed = planSeedSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}
