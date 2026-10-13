/** 存储层的 Supabase 实现。所有读写都带 client_id，跨租户靠这个隔离。 */

import { supabaseAdmin } from '@/lib/supabase'
import { resolveContact } from '@/lib/crm/identity'
import type { NormalisedCallEvent } from './events'
import type {
  CallRow,
  RawEventRow,
  RawStatus,
  TelephonyConnection,
  TelephonyStore,
  TouchpointInput,
} from './types'

const asRaw = (r: Record<string, unknown>): RawEventRow => ({
  id: r.id as string,
  clientId: r.client_id as string,
  connectionId: r.connection_id as string,
  callId: r.provider_call_id as string,
  dedupeKey: r.dedupe_key as string,
  receivedAt: r.received_at as string,
  status: r.status as RawStatus,
  attempts: (r.attempts as number) ?? 0,
  event: r.normalised as NormalisedCallEvent,
})

const RAW_COLS = 'id, client_id, connection_id, provider_call_id, dedupe_key, received_at, status, attempts, normalised'

function callToDb(c: CallRow): Record<string, unknown> {
  return {
    client_id: c.clientId,
    connection_id: c.connectionId,
    provider: c.provider,
    provider_call_id: c.providerCallId,
    stage: c.stage,
    direction: c.direction,
    started_at: c.startedAt,
    counterparty_e164: c.counterpartyE164,
    answered: c.answered,
    talk_seconds: c.talkSeconds,
    extension: c.extension,
    staff_email: c.staffEmail,
    legs: c.legs,
    contact_id: c.contactId,
    match_status: c.matchStatus,
    crm_status: c.crmStatus,
    crm_detail: c.crmDetail,
    touchpoint_id: c.touchpointId,
    recording_ref: c.recordingRef,
    recording_raw_event_id: c.recordingRawEventId,
    recording_status: c.recordingStatus,
    transcript_status: c.transcriptStatus,
    summary_status: c.summaryStatus,
    learning_eligible: false,
    receipts: c.receipts,
    updated_at: new Date().toISOString(),
  }
}

function callFromDb(r: Record<string, unknown>): CallRow {
  return {
    provider: r.provider as CallRow['provider'],
    clientId: r.client_id as string,
    connectionId: r.connection_id as string,
    providerCallId: r.provider_call_id as string,
    stage: r.stage as CallRow['stage'],
    direction: r.direction as CallRow['direction'],
    startedAt: r.started_at as string,
    counterpartyE164: r.counterparty_e164 as string | null,
    answered: r.answered as boolean,
    talkSeconds: r.talk_seconds as number,
    extension: r.extension as string | null,
    staffEmail: r.staff_email as string | null,
    legs: (r.legs as CallRow['legs']) ?? [],
    contactId: r.contact_id as string | null,
    matchStatus: r.match_status as CallRow['matchStatus'],
    crmStatus: r.crm_status as CallRow['crmStatus'],
    crmDetail: r.crm_detail as string | null,
    touchpointId: r.touchpoint_id as string | null,
    recordingRef: r.recording_ref as string | null,
    recordingRawEventId: r.recording_raw_event_id as string | null,
    recordingStatus: r.recording_status as CallRow['recordingStatus'],
    transcriptStatus: r.transcript_status as CallRow['transcriptStatus'],
    summaryStatus: r.summary_status as CallRow['summaryStatus'],
    learningEligible: false,
    receipts: (r.receipts as CallRow['receipts']) ?? [],
  }
}

export const supabaseTelephonyStore: TelephonyStore = {
  async getConnection(id) {
    const { data, error } = await supabaseAdmin
      .from('telephony_connections')
      .select('id, client_id, provider, provider_account_id, webhook_token_hash, secret_ref, forward_to, default_country, extension_map, active')
      .eq('id', id)
      .maybeSingle()
    if (error) throw new Error(`读通话连接失败: ${error.message}`)
    if (!data) return null
    return {
      id: data.id,
      clientId: data.client_id,
      provider: data.provider,
      providerAccountId: data.provider_account_id,
      webhookTokenHash: data.webhook_token_hash,
      secretRef: data.secret_ref ?? null,
      forwardTo: data.forward_to ?? null,
      defaultCountry: data.default_country,
      extensionMap: (data.extension_map ?? {}) as Record<string, string>,
      active: data.active,
    } as TelephonyConnection
  },

  async insertRawEvent(row) {
    const { data, error } = await supabaseAdmin
      .from('telephony_raw_events')
      .upsert(
        {
          client_id: row.clientId,
          connection_id: row.connectionId,
          provider: row.provider,
          provider_call_id: row.callId,
          raw_type: row.rawType,
          dedupe_key: row.dedupeKey,
          received_at: row.receivedAt,
          status: 'pending',
          // 录音链接只留在 payload 列；normalised 里只留「有链接」的标记，避免两处都放敏感内容。
          normalised: { ...row.event, recordingUrl: row.event.recordingUrl ? 'in_payload' : null },
          payload: row.payload,
        },
        { onConflict: 'dedupe_key', ignoreDuplicates: true },
      )
      .select('id')
      .maybeSingle()
    if (error) throw new Error(`原始事件落库失败: ${error.message}`)
    return { inserted: data != null, id: data?.id ?? null }
  },

  async insertRejection(row) {
    // 令牌通过但读不懂的载荷：不按时间节流（接入初期一通电话连发好几个事件，都是校准样本），
    // 但每个连接最多留 200 条。
    if (row.reason.startsWith('unparseable') && row.connectionId) {
      const { count } = await supabaseAdmin
        .from('telephony_webhook_rejections')
        .select('id', { count: 'exact', head: true })
        .eq('connection_id', row.connectionId)
        .like('reason', 'unparseable%')
      if ((count ?? 0) >= 200) return
      const { error: e2 } = await supabaseAdmin.from('telephony_webhook_rejections').insert({
        connection_id: row.connectionId, client_id: row.clientId, reason: row.reason, received_at: row.receivedAt, payload: row.payload ?? null,
      })
      if (e2) throw new Error(`拒绝回执落库失败: ${e2.message}`)
      return
    }
    // 其余（含未认证请求）同一（连接, 原因）一分钟内只记一条，表不会被刷爆。
    const since = new Date(new Date(row.receivedAt).getTime() - 60_000).toISOString()
    let q = supabaseAdmin.from('telephony_webhook_rejections').select('id').eq('reason', row.reason).gte('received_at', since).limit(1)
    q = row.connectionId ? q.eq('connection_id', row.connectionId) : q.is('connection_id', null)
    const { data: recent, error: readErr } = await q
    if (readErr) throw new Error(`读拒绝回执失败: ${readErr.message}`)
    if ((recent ?? []).length > 0) return
    const { error } = await supabaseAdmin.from('telephony_webhook_rejections').insert({
      connection_id: row.connectionId,
      client_id: row.clientId,
      reason: row.reason,
      received_at: row.receivedAt,
      payload: row.payload ?? null,
    })
    if (error) throw new Error(`拒绝回执落库失败: ${error.message}`)
  },

  async getRawEvent(id) {
    const { data, error } = await supabaseAdmin.from('telephony_raw_events').select(RAW_COLS).eq('id', id).maybeSingle()
    if (error) throw new Error(`读原始事件失败: ${error.message}`)
    return data ? asRaw(data) : null
  },

  async listRawEventsForCall(clientId, connectionId, callId) {
    const { data, error } = await supabaseAdmin
      .from('telephony_raw_events')
      .select(RAW_COLS)
      .eq('client_id', clientId)
      .eq('connection_id', connectionId)
      .eq('provider_call_id', callId)
    if (error) throw new Error(`读通话事件失败: ${error.message}`)
    return (data ?? []).map(asRaw)
  },

  async markRaw(id, status, errMsg) {
    const { data: cur } = await supabaseAdmin.from('telephony_raw_events').select('attempts').eq('id', id).maybeSingle()
    const { error } = await supabaseAdmin
      .from('telephony_raw_events')
      .update({
        status,
        last_error: errMsg,
        attempts: status === 'failed' ? ((cur?.attempts as number) ?? 0) + 1 : (cur?.attempts as number) ?? 0,
        processed_at: status === 'processed' || status === 'ignored' ? new Date().toISOString() : null,
      })
      .eq('id', id)
    if (error) throw new Error(`更新原始事件状态失败: ${error.message}`)
  },

  async listStaleRaw(olderThanIso, maxAttempts, limit) {
    const { data, error } = await supabaseAdmin
      .from('telephony_raw_events')
      .select(RAW_COLS)
      .in('status', ['pending', 'failed'])
      .lt('received_at', olderThanIso)
      .lt('attempts', maxAttempts)
      .order('received_at', { ascending: true })
      .limit(limit)
    if (error) throw new Error(`读待补处理事件失败: ${error.message}`)
    return (data ?? []).map(asRaw)
  },

  async countExhaustedRaw(maxAttempts) {
    const { count, error } = await supabaseAdmin
      .from('telephony_raw_events')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'failed')
      .gte('attempts', maxAttempts)
    if (error) throw new Error(`数耗尽事件失败: ${error.message}`)
    return count ?? 0
  },

  async updateCallTouchpoint(t) {
    const { data: cur, error: rErr } = await supabaseAdmin
      .from('contact_touchpoints')
      .select('id, metadata')
      .eq('client_id', t.clientId)
      .eq('source', t.source)
      .eq('source_ref', t.sourceRef)
      .maybeSingle()
    if (rErr) throw new Error(`读通话触点失败: ${rErr.message}`)
    if (!cur) return
    const { error } = await supabaseAdmin
      .from('contact_touchpoints')
      .update({
        summary: t.summary,
        metadata: {
          ...((cur.metadata as Record<string, unknown>) ?? {}),
          outcome: t.outcome,
          reached: t.reached,
          answered: t.answered,
          talk_seconds: t.talkSeconds,
          logged_by: t.staffEmail,
        },
      })
      .eq('id', cur.id)
      .eq('client_id', t.clientId)
    if (error) throw new Error(`更新通话触点失败: ${error.message}`)
  },

  async purgeRejections(olderThanIso, payloadOlderThanIso) {
    const { error: pErr } = await supabaseAdmin
      .from('telephony_webhook_rejections')
      .update({ payload: null })
      .lt('received_at', payloadOlderThanIso)
      .not('payload', 'is', null)
    if (pErr) throw new Error(`清理回执载荷失败: ${pErr.message}`)
    const { count, error } = await supabaseAdmin
      .from('telephony_webhook_rejections')
      .delete({ count: 'exact' })
      .lt('received_at', olderThanIso)
    if (error) throw new Error(`清理拒绝回执失败: ${error.message}`)
    return count ?? 0
  },

  async getCall(clientId, provider, callId) {
    const { data, error } = await supabaseAdmin
      .from('telephony_calls')
      .select('*')
      .eq('client_id', clientId)
      .eq('provider', provider)
      .eq('provider_call_id', callId)
      .maybeSingle()
    if (error) throw new Error(`读通话失败: ${error.message}`)
    return data ? callFromDb(data) : null
  },

  async listStaleCalls(startedBeforeIso, limit) {
    const { data, error } = await supabaseAdmin
      .from('telephony_calls')
      .select('*')
      .eq('crm_status', 'pending')
      .lt('started_at', startedBeforeIso)
      .order('started_at', { ascending: true })
      .limit(limit)
    if (error) throw new Error(`读待补通话失败: ${error.message}`)
    return (data ?? []).map(callFromDb)
  },

  async saveCall(row) {
    const { error } = await supabaseAdmin
      .from('telephony_calls')
      .upsert(callToDb(row), { onConflict: 'client_id,provider,provider_call_id' })
    if (error) throw new Error(`存通话失败: ${error.message}`)
  },

  async findContactIdsByPhone(clientId, phoneE164) {
    const [ident, primary] = await Promise.all([
      supabaseAdmin.from('contact_identities').select('contact_id').eq('client_id', clientId).eq('kind', 'phone').eq('value', phoneE164),
      supabaseAdmin.from('contacts').select('id').eq('client_id', clientId).eq('primary_phone', phoneE164),
    ])
    if (ident.error) throw new Error(`按号码查联系人失败: ${ident.error.message}`)
    if (primary.error) throw new Error(`按主号码查联系人失败: ${primary.error.message}`)
    return [...new Set([...(ident.data ?? []).map((r) => r.contact_id as string), ...(primary.data ?? []).map((r) => r.id as string)])]
  },

  async createContactForInboundCall(input) {
    const { clientId, phoneE164, name, seenAt } = input
    const res = await resolveContact({
      clientId,
      identities: [{ kind: 'phone', value: phoneE164 }],
      // 来电显示名常常就是号码本身；没有字母就不当名字存。
      displayName: name && /[A-Za-z一-鿿]/.test(name) ? name : null,
      source: input.source,
      seenAt,
      mergeStrategy: 'reject',
    })
    return res.contactId
  },

  async writeCallTouchpoint(t: TouchpointInput) {
    const { data, error } = await supabaseAdmin
      .from('contact_touchpoints')
      .upsert(
        {
          client_id: t.clientId,
          contact_id: t.contactId,
          channel: 'phone',
          direction: t.direction,
          occurred_at: t.occurredAt,
          summary: t.summary,
          // 刻意不写 raw：这里没有任何人写的原话，也不放转写/录音内容。
          raw: null,
          metadata: {
            outcome: t.outcome,
            reached: t.reached,
            answered: t.answered,
            talk_seconds: t.talkSeconds,
            // 真实员工；分机没登记就是 null，页面按「不知道谁接的」显示。没有 automated 标记——这是人打的电话。
            logged_by: t.staffEmail,
            provider_call_id: t.providerCallId,
          },
          source: t.source,
          source_ref: t.sourceRef,
        },
        { onConflict: 'client_id,source,source_ref', ignoreDuplicates: true },
      )
      .select('id')
      .maybeSingle()
    if (error) throw new Error(`写通话触点失败: ${error.message}`)

    // last_seen_at 只在「客人来过电话」或「真联系上了」时前移；未接的外呼不算他出现过。
    if (t.direction === 'inbound' || t.reached) {
      const { data: cur } = await supabaseAdmin.from('contacts').select('last_seen_at').eq('id', t.contactId).eq('client_id', t.clientId).maybeSingle()
      const prev = cur?.last_seen_at as string | null | undefined
      if (!prev || new Date(prev).getTime() < new Date(t.occurredAt).getTime()) {
        const { error: uErr } = await supabaseAdmin
          .from('contacts')
          .update({ last_seen_at: t.occurredAt, updated_at: new Date().toISOString() })
          .eq('id', t.contactId)
          .eq('client_id', t.clientId)
        if (uErr) throw new Error(`更新联系人时间失败: ${uErr.message}`)
      }
    }
    let touchpointId = data?.id ?? null
    if (!touchpointId) {
      // 命中幂等键（重试）：回查已有触点的 id，通话行才能和触点对上。
      const { data: existing } = await supabaseAdmin
        .from('contact_touchpoints')
        .select('id')
        .eq('client_id', t.clientId)
        .eq('source', t.source)
        .eq('source_ref', t.sourceRef)
        .maybeSingle()
      touchpointId = (existing?.id as string | undefined) ?? null
    }
    return { touchpointId, created: data != null }
  },
}
