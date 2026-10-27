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

/** 受众三态：读到 / 读到但不可用 / 读不到（后两种都留空）。 */
export const audienceStateSchema = z.enum(['read', 'unusable', 'unreadable'])
export type AudienceState = z.infer<typeof audienceStateSchema>

/** 素材五态；只有 ready 算通过，pending_approval（素材待批）不算。 */
export const creativeStateSchema = z.enum([
  'ready',
  'pending_approval',
  'window_mismatch',
  'none',
  'unreadable',
])
export type CreativeState = z.infer<typeof creativeStateSchema>

/** 计划种子里的一个广告步骤：每个字段都是 Field，缺数据时说明原因。受众/素材字段是 S1 新增，旧种子没有，所以可选。 */
export const planSeedStepSchema = z.object({
  step_key: z.string(),
  play: playKeySchema,
  page_id: fieldSchema(z.string()),
  ad_account_id: fieldSchema(z.string()),
  daily_budget_cents: fieldSchema(z.number()),
  audience_state: audienceStateSchema.optional(),
  audience_ids: fieldSchema(z.array(z.string())).optional(),
  excluded_audience_ids: fieldSchema(z.array(z.string())).optional(),
  creative_state: creativeStateSchema.optional(),
  creative_refs: fieldSchema(z.array(z.string())).optional(),
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
  /** S1：起止日排期（来自目标周期）；旧种子没有。 */
  schedule: fieldSchema(z.object({ start_date: z.string(), end_date: z.string() })).optional(),
  ad_steps: z.array(planSeedStepSchema),
  skipped: z.array(z.object({ step_key: z.string(), why_empty: z.string() })),
  notes: z.array(z.string()),
  /** 机器可读：取数本身失败（令牌权限、表单、账户状态读不到，或整体超时）。只在失败时出现。 */
  read_failed: z.boolean().optional(),
})
export type PlanSeed= z.infer<typeof planSeedSchema>

/** 解析计划种子；畸形输入返回 null，永不抛错。 */
export function readPlanSeed(raw: unknown): PlanSeed | null {
  const parsed = planSeedSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}
