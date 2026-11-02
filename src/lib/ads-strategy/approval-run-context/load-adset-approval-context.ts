import type { SupabaseClient } from '@supabase/supabase-js'
import { hoursSinceOwnLastAction } from '@/lib/capabilities/ads/envelope-facts'
import {
  ADS_ENTITY_COOLDOWN_HOURS,
  actionKeySummary,
  type AdsetApprovalContext,
  type ApprovalContextBlock,
  type CooldownView,
  type LastKernelActionView,
  type ReadbackDisplay,
} from './types'

const TERMINAL_FOR_READBACK = new Set([
  'succeeded',
  'failed',
  'dead_letter',
  'running',
  'authorized',
  'pending_approval',
])

const LAST_ACTION_STATUSES = ['succeeded', 'failed', 'dead_letter'] as const

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

async function readbackForRun(sb: SupabaseClient, runId: string, runStatus: string): Promise<ReadbackDisplay> {
  if (!TERMINAL_FOR_READBACK.has(runStatus)) return 'unreadable'
  if (runStatus === 'pending_approval' || runStatus === 'authorized') return 'pending'

  const { data, error } = await sb
    .from('action_run_steps')
    .select('step_key, status, verification')
    .eq('run_id', runId)
  if (error) return 'unreadable'

  const steps = (data ?? []) as Array<{ step_key?: string; status?: string; verification?: unknown }>
  const readback = steps.find((s) => String(s.step_key ?? '').toLowerCase() === 'readback')
  if (!readback) return 'pending'
  if (readback.status !== 'succeeded') return 'pending'

  const v = readback.verification
  if (!v || typeof v !== 'object') return 'unreadable'
  const passed = (v as { passed?: unknown }).passed
  if (passed === true) return 'consistent'
  if (passed === false) return 'inconsistent'
  return 'unreadable'
}

async function loadLastOnAdset(
  sb: SupabaseClient,
  clientId: string,
  adsetId: string,
  excludeRunId: string | null,
): Promise<ApprovalContextBlock<LastKernelActionView>> {
  let query = sb
    .from('action_runs')
    .select('id, action_key, status, finished_at')
    .eq('client_id', clientId)
    .like('action_key', 'ads.%')
    .in('status', [...LAST_ACTION_STATUSES])
    .not('finished_at', 'is', null)
    .eq('input->>adset_id', adsetId)
    .order('finished_at', { ascending: false })
    .limit(5)

  const { data, error } = await query
  if (error) return { kind: 'unreadable' }

  const rows = (data ?? []) as Array<{
    id: string
    action_key: string
    status: string
    finished_at: string | null
  }>
  const row = rows.find((r) => r.id !== excludeRunId)
  if (!row || !row.finished_at) return { kind: 'none' }

  const readback = await readbackForRun(sb, row.id, row.status)
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
  adsetId: string,
  now: Date,
): Promise<AdsetApprovalContext['cooldown']> {
  const own = await hoursSinceOwnLastAction(sb, {
    clientId,
    entityIds: [adsetId],
    now,
  })
  if (!own.ok) return { kind: 'unreadable' }
  if (own.hours === null || own.hours >= ADS_ENTITY_COOLDOWN_HOURS) return { kind: 'clear' }

  const { data, error } = await sb
    .from('action_runs')
    .select('finished_at')
    .eq('client_id', clientId)
    .like('action_key', 'ads.%')
    .in('status', [...LAST_ACTION_STATUSES])
    .not('finished_at', 'is', null)
    .eq('input->>adset_id', adsetId)
    .order('finished_at', { ascending: false })
    .limit(1)
  if (error) return { kind: 'unreadable' }

  const finishedAt = (data?.[0] as { finished_at?: string } | undefined)?.finished_at
  if (!finishedAt) return { kind: 'unreadable' }

  const endMs = Date.parse(finishedAt) + ADS_ENTITY_COOLDOWN_HOURS * 3_600_000
  if (!Number.isFinite(endMs)) return { kind: 'unreadable' }
  const untilIso = new Date(endMs).toISOString()
  const untilLabel = nzFormat(untilIso)
  const view: CooldownView = { untilIso, untilLabel }
  return { kind: 'ok', data: view }
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
  const [lastOnAdset, cooldown, thisRunReadback] = await Promise.all([
    loadLastOnAdset(sb, input.clientId, input.adsetId, input.thisRunId),
    loadCooldown(sb, input.clientId, input.adsetId, now),
    readbackForRun(sb, input.thisRunId, input.thisRunStatus),
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
