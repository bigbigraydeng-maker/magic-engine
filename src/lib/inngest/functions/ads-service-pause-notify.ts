/**
 * 服务暂停成功之后发一封信，并把发送结果写回操作记录。
 * 事件只是叫醒。信的内容从操作记录重读。已经发过的不再发。
 *
 * 新函数要有人去 Inngest 后台对 /api/inngest 重新 Sync 一次，不然不会跑。
 * 待办不靠这封事件：今日待办会自己读操作记录。
 */

import { inngest, CLOUD_FN_PREFIX } from '../client'
import {
  deliverStopNotice,
  readStopAlertRecipient,
  sendStopNoticeWithResend,
  STOP_PAUSE_EVENT,
  type MailSender,
  type StopEmailStatus,
  type StopPauseFacts,
} from '@/lib/ads/stop-pause-notify'
import { supabaseAdmin } from '@/lib/supabase'

const ACTION = 'ads.service_pause_only'

interface PauseRow {
  id: string
  payload: Record<string, unknown>
}

export interface StopPauseNotifyDeps {
  load: (clientId: string, actionId: string) => Promise<PauseRow | null>
  saveStatus: (actionId: string, payload: Record<string, unknown>, status: StopEmailStatus) => Promise<void>
  recipient: () => string | null
  mail: MailSender | null
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function factsOf(payload: Record<string, unknown>): StopPauseFacts | null {
  const campaignId = payload.campaign_id
  const name = payload.campaign_name
  const account = payload.ad_account_id
  const code = payload.fault_code
  const what = payload.fault_what
  const asOf = payload.as_of
  const currency = payload.currency
  if (typeof campaignId !== 'string' || typeof name !== 'string' || typeof account !== 'string') return null
  if (typeof code !== 'string' || typeof what !== 'string' || typeof asOf !== 'string' || typeof currency !== 'string') return null
  return {
    campaign_id: campaignId,
    campaign_name: name,
    ad_account_id: account,
    fault_code: code,
    fault_what: what,
    as_of: asOf,
    currency,
    spend_today_cents: typeof payload.spend_today_cents === 'number' ? payload.spend_today_cents : null,
    spend_lifetime_cents: typeof payload.spend_lifetime_cents === 'number' ? payload.spend_lifetime_cents : null,
  }
}

export async function runStopPauseNotify(
  data: { client_id?: string; action_id?: string },
  deps: StopPauseNotifyDeps,
): Promise<{ email_status: StopEmailStatus | 'skipped' }> {
  if (!data.client_id || !data.action_id) return { email_status: 'skipped' }
  const row = await deps.load(data.client_id, data.action_id)
  if (!row || row.payload.status !== 'paused') return { email_status: 'skipped' }
  if (row.payload.email_status === 'sent') return { email_status: 'sent' }
  const facts = factsOf(row.payload)
  if (!facts) return { email_status: 'skipped' }
  const status = await deliverStopNotice({ facts, recipient: deps.recipient(), mail: deps.mail })
  await deps.saveStatus(row.id, row.payload, status)
  return { email_status: status }
}

async function loadPause(clientId: string, actionId: string): Promise<PauseRow | null> {
  const { data, error } = await supabaseAdmin
    .from('flywheel_actions')
    .select('id, payload')
    .eq('id', actionId)
    .eq('client_id', clientId)
    .eq('action_type', ACTION)
    .maybeSingle()
  if (error || !data || typeof data.id !== 'string' || !isRecord(data.payload)) return null
  return { id: data.id, payload: data.payload }
}

async function savePauseStatus(actionId: string, payload: Record<string, unknown>, status: StopEmailStatus): Promise<void> {
  const { error } = await supabaseAdmin
    .from('flywheel_actions')
    .update({ payload: { ...payload, email_status: status } })
    .eq('id', actionId)
  if (error) throw new Error('暂停通知的发送结果写不回去')
}

function realNotifyDeps(): StopPauseNotifyDeps {
  return {
    load: loadPause,
    saveStatus: savePauseStatus,
    recipient: () => readStopAlertRecipient(process.env),
    mail: { send: sendStopNoticeWithResend },
  }
}

export function createAdsServicePauseNotify(deps: StopPauseNotifyDeps = realNotifyDeps()) {
  return inngest.createFunction(
    {
      id: `${CLOUD_FN_PREFIX}ads-service-pause-notify`,
      name: 'Ads service pause: email the operator after a campaign is paused',
      retries: 2,
    },
    { event: STOP_PAUSE_EVENT },
    async ({ event, step }) => {
      const data = isRecord(event.data) ? event.data : {}
      const clientId = typeof data.client_id === 'string' ? data.client_id : undefined
      const actionId = typeof data.action_id === 'string' ? data.action_id : undefined
      return step.run('notify', () => runStopPauseNotify({ client_id: clientId, action_id: actionId }, deps))
    },
  )
}

export const adsServicePauseNotify = createAdsServicePauseNotify()
