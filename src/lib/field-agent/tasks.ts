import { supabaseAdmin as db } from '@/lib/supabase'
import {
  DASHBOARD_COMPETITOR_ADS_REQUEST,
  FIELD_AGENT_TASKS_TABLE,
  fieldAgentWriteTargets,
  buildCompetitorAdsParams,
  dashboardCompetitorAdsRequestSchema,
  type FieldAgentWebhookBody,
  type ScanCompetitor,
} from './contracts'
import { missingWebhookMessage, postFieldAgentWebhook, resolveFieldAgentWebhook, type FieldAgentWebhookConfig } from './dispatch'

export type CompetitorAdsDispatchResult = {
  httpStatus: number
  ok: boolean
  dispatched: boolean
  task_id: string | null
  status: 'queued' | 'failed' | null
  message: string
}

type InsertedTask = { id: string }

export async function runCompetitorAdsDispatch(input: {
  clientId: string
  requestedBy: string
  body: unknown
  competitors: ScanCompetitor[]
  webhook: FieldAgentWebhookConfig | null
  insertTask: (row: { client_id: string; task_type: 'competitor_ads_scan'; params: FieldAgentWebhookBody['params']; requested_by: string }) => Promise<InsertedTask>
  markDispatched: (taskId: string) => Promise<void>
  markFailed: (taskId: string, error: string) => Promise<void>
  post?: typeof postFieldAgentWebhook
}): Promise<CompetitorAdsDispatchResult> {
  const parsed = dashboardCompetitorAdsRequestSchema.safeParse(input.body)
  if (!parsed.success) {
    return { httpStatus: 400, ok: false, dispatched: false, task_id: null, status: null, message: '请求格式不对。' }
  }
  if (!input.webhook) {
    return { httpStatus: 200, ok: false, dispatched: false, task_id: null, status: null, message: missingWebhookMessage() }
  }
  const params = buildCompetitorAdsParams(input.competitors)
  if (!params.competitors.length) {
    return { httpStatus: 422, ok: false, dispatched: false, task_id: null, status: null, message: '这个客户还没有可采集的竞品名单，这次没有建立任务。' }
  }
  const task = await input.insertTask({
    client_id: input.clientId,
    task_type: parsed.data.task_type,
    params,
    requested_by: input.requestedBy,
  })
  const posted = await (input.post ?? postFieldAgentWebhook)(input.webhook, {
    task_id: task.id,
    client_id: input.clientId,
    task_type: 'competitor_ads_scan',
    params,
    write_targets: fieldAgentWriteTargets,
  })
  if (!posted.ok) {
    await input.markFailed(task.id, posted.message)
    return { httpStatus: 502, ok: false, dispatched: false, task_id: task.id, status: 'failed', message: '采集请求没送出去，任务已标为失败。可以再点一次重试。' }
  }
  await input.markDispatched(task.id)
  return { httpStatus: 202, ok: true, dispatched: true, task_id: task.id, status: 'queued', message: '已把采集请求交给外勤助手。结果会以待审广告出现在下面。' }
}

function requestedBy(email: string | null | undefined): string {
  const value = email?.trim() || 'dashboard'
  return value.slice(0, 200)
}

export async function createCompetitorAdsTask(input: {
  clientId: string
  requestedByEmail: string | null | undefined
  body: unknown
  competitors: ScanCompetitor[]
}): Promise<CompetitorAdsDispatchResult> {
  return runCompetitorAdsDispatch({
    clientId: input.clientId,
    requestedBy: requestedBy(input.requestedByEmail),
    body: input.body ?? DASHBOARD_COMPETITOR_ADS_REQUEST,
    competitors: input.competitors,
    webhook: resolveFieldAgentWebhook(),
    insertTask: async row => {
      const inserted = await db.from(FIELD_AGENT_TASKS_TABLE).insert(row).select('id').single()
      if (inserted.error || !inserted.data) throw new Error('field_agent_task_insert_failed')
      return { id: inserted.data.id as string }
    },
    markDispatched: async taskId => {
      const updated = await db.from(FIELD_AGENT_TASKS_TABLE).update({ dispatched_at: new Date().toISOString() }).eq('id', taskId).eq('client_id', input.clientId)
      if (updated.error) throw new Error('field_agent_task_dispatch_mark_failed')
    },
    markFailed: async (taskId, error) => {
      const updated = await db.from(FIELD_AGENT_TASKS_TABLE).update({
        status: 'failed', error: error.slice(0, 2000), finished_at: new Date().toISOString(),
      }).eq('id', taskId).eq('client_id', input.clientId)
      if (updated.error) throw new Error('field_agent_task_fail_mark_failed')
    },
  })
}
