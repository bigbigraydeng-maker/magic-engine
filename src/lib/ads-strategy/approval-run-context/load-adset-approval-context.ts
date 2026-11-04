import type { SupabaseClient } from '@supabase/supabase-js'
import { hoursSinceOwnLastAction } from '@/lib/capabilities/ads/envelope-facts'
import { ACTION_REGISTRY } from '@/lib/kernel/registry'
import {
  ADS_ENTITY_COOLDOWN_HOURS,
  actionKeySummary,
  type AdsetApprovalContext,
  type ApprovalContextBlock,
  type CooldownView,
  type LastKernelActionView,
  type ReadbackDisplay,
} from './types'

const LAST_ACTION_STATUSES = ['succeeded', 'failed', 'dead_letter'] as const

type StepRow = { step_key?: string; status?: string; verification?: unknown }

function nzFormat(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-NZ', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/** 与内核注册表一致：D3 用 verify，多数 ads.* 用 readback。 */
export function verificationStepKeysForAction(actionKey: string): readonly string[] {
  const def = ACTION_REGISTRY.get(actionKey)
  const steps = def?.steps ?? []
  if (steps.includes('verify')) return ['verify']
  if (steps.includes('readback')) return ['readback']
  return ['readback', 'verify']
}

/** 先读已落库的 verification（含失败步），再判 pending。 */
export function readbackFromSteps(
  steps: readonly StepRow[],
  actionKey: string,
  runStatus: string,
): ReadbackDisplay {
  if (runStatus === 'pending_approval' || runStatus === 'authorized') {
    for (const s of steps) {
      const v = s.verification
      if (v && typeof v === 'object' && (v as { passed?: unknown }).passed === false) {
        return 'inconsistent'
      }
    }
    return 'pending'
  }

  for (const s of steps) {
    const v = s.verification
    if (v && typeof v === 'object' && (v as { passed?: unknown }).passed === false) {
      return 'inconsistent'
    }
  }

  for (const key of verificationStepKeysForAction(actionKey)) {
    const step = steps.find((s) => String(s.step_key ?? '').toLowerCase() === key)
    if (!step) continue
    const v = step.verification
    if (v && typeof v === 'object') {
      if ((v as { passed?: unknown }).passed === true) return 'consistent'
      if ((v as { passed?: unknown }).passed === false) return 'inconsistent'
    }
    if (step.status === 'succeeded') return 'pending'
  }

  if (runStatus === 'succeeded' || runStatus === 'failed' || runStatus === 'dead_letter') {
    return 'pending'
  }
  return 'unreadable'
}

async function readbackForRun(
  sb: SupabaseClient,
  runId: string,
  runStatus: string,
  actionKey: string,
): Promise<ReadbackDisplay> {
  const { data, error } = await sb
    .from('action_run_steps')
    .select('step_key, status, verification')
    .eq('run_id', runId)
  if (error) return 'unreadable'
  return readbackFromSteps((data ?? []) as StepRow[], actionKey, runStatus)
}

/** 与 envelope-facts 冷却实体范围对齐（CBO 系列 + 来源广告组）。 */
export function cooldownEntityIdsFromRunInput(
  actionKey: string | null | undefined,
  runInput: unknown,
  fallbackAdsetId: string,
): readonly string[] {
  const input = (runInput ?? {}) as Record<string, unknown>
  const adsetId = typeof input.adset_id === 'string' && input.adset_id.length > 0
    ? input.adset_id
    : fallbackAdsetId
  const campaignId = typeof input.campaign_id === 'string' && input.campaign_id.length > 0
    ? input.campaign_id
    : null
  if (actionKey === 'ads.scale_unit_budget' && campaignId) {
    return [campaignId, adsetId]
  }
  return [adsetId]
}

async function loadLastOnAdset(
  sb: SupabaseClient,
  clientId: string,
  adsetId: string,
  excludeRunId: string | null,
): Promise<ApprovalContextBlock<LastKernelActionView>> {
  const { data, error } = await sb
    .from('action_runs')
    .select('id, action_key, status, finished_at')
    .eq('client_id', clientId)
    .like('action_key', 'ads.%')
    .in('status', [...LAST_ACTION_STATUSES])
    .not('finished_at', 'is', null)
    .eq('input->>adset_id', adsetId)
    .order('finished_at', { ascending: false })
    .limit(5)

  if (error) return { kind: 'unreadable' }

  const rows = (data ?? []) as Array<{
    id: string
    action_key: string
    status: string
    finished_at: string | null
  }>
  const row = rows.find((r) => r.id !== excludeRunId)
  if (!row || !row.finished_at) return { kind: 'none' }

  const readback = await readbackForRun(sb, row.id, row.status, row.action_key)
  return {
    kind: 'ok',
    data: {
      summary: actionKeySummary(row.action_key),
      finishedAt: row.finished_at,
      readback,
    },
  }
}

async function loadCooldown(
  sb: SupabaseClient,
  clientId: string,
  entityIds: readonly string[],
  now: Date,
): Promise<AdsetApprovalContext['cooldown']> {
  const own = await hoursSinceOwnLastAction(sb, {
    clientId,
    entityIds: [...entityIds],
    now,
  })
  if (!own.ok) return { kind: 'unreadable' }
  if (own.hours === null || own.hours >= ADS_ENTITY_COOLDOWN_HOURS) return { kind: 'clear' }

  const ids = [...new Set(entityIds)].filter((id) => id.length > 0)
  if (ids.length === 0) return { kind: 'unreadable' }

  const orExpr = ids
    .flatMap((id) => [`input->>adset_id.eq.${id}`, `input->>campaign_id.eq.${id}`])
    .join(',')

  const { data, error } = await sb
    .from('action_runs')
    .select('finished_at')
    .eq('client_id', clientId)
    .like('action_key', 'ads.%')
    .in('status', [...LAST_ACTION_STATUSES])
    .not('finished_at', 'is', null)
    .or(orExpr)
    .order('finished_at', { ascending: false })
    .limit(1)
  if (error) return { kind: 'unreadable' }

  const finishedAt = (data?.[0] as { finished_at?: string } | undefined)?.finished_at
  if (!finishedAt) return { kind: 'unreadable' }

  const endMs = Date.parse(finishedAt) + ADS_ENTITY_COOLDOWN_HOURS * 3_600_000
  if (!Number.isFinite(endMs)) return { kind: 'unreadable' }
  const untilIso = new Date(endMs).toISOString()
  return { kind: 'ok', data: { untilIso, untilLabel: nzFormat(untilIso) } }
}

export async function loadAdsetApprovalContext(
  sb: SupabaseClient,
  input: {
    readonly clientId: string
    readonly adsetId: string
    readonly thisRunId: string
    readonly thisRunStatus: string
    readonly now?: Date
  },
): Promise<AdsetApprovalContext> {
  const now = input.now ?? new Date()

  const { data: thisRun, error: thisRunErr } = await sb
    .from('action_runs')
    .select('action_key, input')
    .eq('id', input.thisRunId)
    .maybeSingle()
  if (thisRunErr) {
    return {
      lastOnAdset: { kind: 'unreadable' },
      cooldown: { kind: 'unreadable' },
      thisRunReadback: 'unreadable',
    }
  }

  const actionKey = String((thisRun as { action_key?: string } | null)?.action_key ?? '')
  const cooldownIds = cooldownEntityIdsFromRunInput(
    actionKey,
    (thisRun as { input?: unknown } | null)?.input,
    input.adsetId,
  )

  const [lastOnAdset, cooldown, thisRunReadback] = await Promise.all([
    loadLastOnAdset(sb, input.clientId, input.adsetId, input.thisRunId),
    loadCooldown(sb, input.clientId, cooldownIds, now),
    readbackForRun(sb, input.thisRunId, input.thisRunStatus, actionKey),
  ])
  return { lastOnAdset, cooldown, thisRunReadback }
}

export function formatCooldownNote(
  cooldown: AdsetApprovalContext['cooldown'],
): string | null {
  if (cooldown.kind === 'clear') return null
  if (cooldown.kind === 'unreadable') return '冷却期：没读到'
  return `72 小时冷却中，到 ${cooldown.data.untilLabel}`
}
