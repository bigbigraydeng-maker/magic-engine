/**
 * 自治开关同步 worker —— `ad_strategy_configs.autonomy_mode` → `client_automation_policies.mode`。
 *
 * 🔴 **Kernel 一行不动**：本文件不 import `@/lib/kernel/**` 的任何运行时代码；Kernel 的
 *    `authorize.ts` / `gateway.ts` / `store.ts` 都不认识 `autonomy_mode`。
 *
 * 🔴 **事件只当叫醒铃**：payload 只带 `client_id`；worker 收到铃一律回库 SELECT 当前值，
 *    不信 payload 里的值（spec §4.4）。
 *
 * 🔴 **唯一写路径 = SQL 函数 `ads_sync_autonomy_policy`**：本文件是全仓唯一
 *    `rpc('ads_sync_autonomy_policy')` 调用点，架构测试锁死。绝不直接
 *    `.update(` / `.insert(` / `.upsert(` / `.delete(` `client_automation_policies`。
 *
 * 🔴 **`deny` 永不覆盖**：函数体里的防御性守卫（`mode <> 'deny'`）保证；本文件也不写
 *    任何 `'deny'` 字面量。
 *
 * 🔴 **每个键每次尝试写一行 `ads_autonomy_sync_receipts`**：幂等键
 *    `(client_id, action_key, ad_strategy_configs.updated_at)`（spec §4.10）。
 *
 * 🔴 **新增函数上线要手动 Sync `/api/inngest`**（STATE.md:174、PITFALLS F10）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { inngest, CLOUD_FN_PREFIX } from '../client'
import { supabaseAdmin } from '@/lib/supabase'
import { ADS_AUTONOMY_MODE_CHANGED } from '../ads-events'
import {
  planAutonomySync,
  syncActorLabel,
  type AutonomyMode,
  type AutonomySyncPlanItem,
} from '@/lib/ads-strategy/autonomy/sync-policy'

export const ADS_AUTONOMY_SYNC_FN_ID = `${CLOUD_FN_PREFIX}ads-autonomy-sync`

export interface AdsAutonomySyncDeps {
  /** 在 handler 内取客户端，不在模块顶层 new。测试注入假对象。 */
  readonly getSupabase: () => SupabaseClient
}

export interface AdsAutonomySyncKeyResult {
  readonly key: string
  readonly from_mode: string | null
  readonly to_mode: string
  readonly outcome: string // rpc 返回：inserted | updated | unchanged | locked_by_deny
}

export type AdsAutonomySyncReceipt =
  | { ok: false; reason: 'invalid_payload' | 'no_config'; client_id: string | null }
  | {
      ok: true
      client_id: string
      source_updated_at: string
      applied: number
      skipped: number
      results: AdsAutonomySyncKeyResult[]
    }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** payload 校验（fail-closed）：只认合法 UUID 的 `client_id`。 */
export function parseClientId(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const clientId = (data as Record<string, unknown>).client_id
  if (typeof clientId !== 'string' || !UUID_RE.test(clientId)) return null
  return clientId
}

interface ConfigSnapshot {
  readonly autonomyMode: AutonomyMode
  readonly sourceUpdatedAt: string
  readonly updatedBy: string | null
}

/** 读意向源当前值；无行返回 null（→ `no_config`）。 */
async function readConfig(sb: SupabaseClient, clientId: string): Promise<ConfigSnapshot | null> {
  const { data, error } = await sb
    .from('ad_strategy_configs')
    .select('autonomy_mode, updated_at, autonomy_mode_updated_by')
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) throw new Error(`read-config failed: ${error.message}`)
  if (!data) return null
  return {
    autonomyMode: data.autonomy_mode === 'bounded_auto' ? 'bounded_auto' : 'observe',
    sourceUpdatedAt: String(data.updated_at),
    updatedBy: typeof data.autonomy_mode_updated_by === 'string' ? data.autonomy_mode_updated_by : null,
  }
}

/**
 * 读最近回执，算出每个 action_key 的「已同步到哪个 source_updated_at」。
 *
 * 返回**普通对象**（不是 Map）—— step 返回值必须可 JSON 序列化。
 * `sync_failed:` 前缀的行不算「已同步」，否则一次失败会把该键永久锁死。
 */
async function readLastSynced(sb: SupabaseClient, clientId: string): Promise<Record<string, string>> {
  const { data, error } = await sb
    .from('ads_autonomy_sync_receipts')
    .select('action_key, source_updated_at, skipped_reason')
    .eq('client_id', clientId)
    .order('synced_at', { ascending: false })
    .limit(200)
  if (error) throw new Error(`read-receipts failed: ${error.message}`)
  const record: Record<string, string> = {}
  for (const row of data ?? []) {
    const key = typeof row.action_key === 'string' ? row.action_key : null
    if (key === null || key in record) continue
    const skipped = typeof row.skipped_reason === 'string' ? row.skipped_reason : null
    if (skipped !== null && skipped.startsWith('sync_failed:')) continue
    record[key] = String(row.source_updated_at)
  }
  return record
}

/** 写一行回执；`locked_by_deny` / `unchanged` 记进 `skipped_reason` 便于对账。 */
async function writeReceipt(
  sb: SupabaseClient,
  clientId: string,
  sourceUpdatedAt: string,
  item: AutonomySyncPlanItem,
  fromMode: string | null,
  outcome: string,
): Promise<void> {
  const skippedReason = outcome === 'locked_by_deny' || outcome === 'unchanged' ? outcome : null
  const { error } = await sb.from('ads_autonomy_sync_receipts').insert({
    client_id: clientId,
    action_key: item.key,
    source_updated_at: sourceUpdatedAt,
    from_mode: fromMode,
    to_mode: item.mode,
    skipped_reason: skippedReason,
  })
  if (error) throw new Error(`write-receipt(${item.key}) failed: ${error.message}`)
}

/** 单个 action_key：读当前 mode → 调 SQL 函数 → 写回执。 */
async function applyOne(
  sb: SupabaseClient,
  clientId: string,
  sourceUpdatedAt: string,
  actor: string,
  item: AutonomySyncPlanItem,
): Promise<AdsAutonomySyncKeyResult> {
  const { data: current } = await sb
    .from('client_automation_policies')
    .select('mode')
    .eq('client_id', clientId)
    .eq('action_key', item.key)
    .is('effective_to', null)
    .maybeSingle()
  const fromMode = typeof current?.mode === 'string' ? current.mode : null

  const { data, error } = await sb.rpc('ads_sync_autonomy_policy', {
    p_client_id: clientId,
    p_action_key: item.key,
    p_mode: item.mode,
    p_updated_by: actor,
  })
  if (error) throw new Error(`ads_sync_autonomy_policy(${item.key}) failed: ${error.message}`)
  const outcome = typeof data === 'string' ? data : 'unknown'

  await writeReceipt(sb, clientId, sourceUpdatedAt, item, fromMode, outcome)
  return { key: item.key, from_mode: fromMode, to_mode: item.mode, outcome }
}

/** 失败回执：`action_key = '*'` 一行，`skipped_reason` 带 `sync_failed:` 前缀。 */
async function writeFailureReceipt(sb: SupabaseClient, clientId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)
  const { error: writeError } = await sb.from('ads_autonomy_sync_receipts').insert({
    client_id: clientId,
    action_key: '*',
    source_updated_at: new Date().toISOString(),
    from_mode: null,
    to_mode: null,
    skipped_reason: `sync_failed:${message}`.slice(0, 500),
  })
  if (writeError) throw new Error(`write-failure-receipt failed: ${writeError.message}`)
}

export function createAdsAutonomySyncFunction(deps: AdsAutonomySyncDeps) {
  return inngest.createFunction(
    {
      id: ADS_AUTONOMY_SYNC_FN_ID,
      name: 'Ads: sync autonomy_mode into Kernel policies',
      retries: 2,
      concurrency: { limit: 1, key: 'event.data.client_id' },
      onFailure: async ({ event, error }) => {
        const nested = (event.data as { event?: { data?: unknown } } | undefined)?.event?.data
        const clientId = parseClientId(nested)
        if (clientId === null) return
        try {
          await writeFailureReceipt(deps.getSupabase(), clientId, error)
        } catch (e) {
          console.error('[ads-autonomy-sync] onFailure receipt write failed', e)
        }
      },
    },
    { event: ADS_AUTONOMY_MODE_CHANGED },
    async ({ event, step }): Promise<AdsAutonomySyncReceipt> => {
      const clientId = parseClientId(event.data)
      if (clientId === null) return { ok: false, reason: 'invalid_payload', client_id: null }

      const config = await step.run('read-config', () => readConfig(deps.getSupabase(), clientId))
      if (config === null) return { ok: false, reason: 'no_config', client_id: clientId }

      const lastSynced = await step.run('read-receipts', () => readLastSynced(deps.getSupabase(), clientId))
      const plan = planAutonomySync({
        autonomyMode: config.autonomyMode,
        sourceUpdatedAt: config.sourceUpdatedAt,
        lastSynced: new Map(Object.entries(lastSynced)),
      })

      const { results, applied } = await step.run('apply', async () => {
        const sb = deps.getSupabase()
        const actor = syncActorLabel(config.updatedBy, config.sourceUpdatedAt)
        const appliedResults: AdsAutonomySyncKeyResult[] = []
        for (const item of plan) {
          if (item.skip !== null) continue
          appliedResults.push(await applyOne(sb, clientId, config.sourceUpdatedAt, actor, item))
        }
        return {
          results: appliedResults,
          applied: appliedResults.filter((r) => r.outcome === 'inserted' || r.outcome === 'updated').length,
        }
      })

      return {
        ok: true,
        client_id: clientId,
        source_updated_at: config.sourceUpdatedAt,
        applied,
        skipped: plan.length - results.length,
        results,
      }
    },
  )
}

export const adsAutonomySyncFunction = createAdsAutonomySyncFunction({ getSupabase: () => supabaseAdmin })
