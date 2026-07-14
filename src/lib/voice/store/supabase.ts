/**
 * SupabaseVoiceStore — production impl over supabaseAdmin (service-role).
 * Tenant isolation is enforced by always scoping queries with tenant_id (魏征 #2).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { VoiceError } from '../domain'
import type {
  AgentRow, AuditInput, CallRow, ContactRow, KnowledgeDocRow, LeadRow,
  PhoneRouteRow, TenantRow, ToolCallRow, TranscriptSegmentRow, VoiceStore, WebhookEventRow,
} from './types'

type DB = SupabaseClient<any, any, any>

export class SupabaseVoiceStore implements VoiceStore {
  constructor(private db: DB) {}

  private async one<T>(p: PromiseLike<{ data: any; error: any }>): Promise<T | null> {
    const { data, error } = await p
    if (error && error.code !== 'PGRST116') throw new VoiceError('PROVIDER_UNAVAILABLE', error.message)
    return (data as T) ?? null
  }
  private async many<T>(p: PromiseLike<{ data: any; error: any }>): Promise<T[]> {
    const { data, error } = await p
    if (error) throw new VoiceError('PROVIDER_UNAVAILABLE', error.message)
    return (data as T[]) ?? []
  }

  listTenants() {
    return this.many<TenantRow>(this.db.from('voice_tenants').select('*').order('created_at', { ascending: false }))
  }
  getTenantById(id: string) {
    return this.one<TenantRow>(this.db.from('voice_tenants').select('*').eq('id', id).maybeSingle())
  }
  getTenantBySlug(slug: string) {
    return this.one<TenantRow>(this.db.from('voice_tenants').select('*').eq('slug', slug).maybeSingle())
  }
  getAgentById(id: string) {
    return this.one<AgentRow>(this.db.from('voice_agents').select('*').eq('id', id).maybeSingle())
  }
  listAgentsByTenant(tenantId: string) {
    return this.many<AgentRow>(this.db.from('voice_agents').select('*').eq('tenant_id', tenantId))
  }

  listActiveRoutes() {
    return this.many<PhoneRouteRow>(this.db.from('voice_phone_routes').select('*').eq('status', 'active'))
  }
  listRoutesByTenant(tenantId: string) {
    return this.many<PhoneRouteRow>(this.db.from('voice_phone_routes').select('*').eq('tenant_id', tenantId))
  }

  findContactByPhone(tenantId: string, phoneE164: string) {
    return this.one<ContactRow>(
      this.db.from('voice_contacts').select('*').eq('tenant_id', tenantId).eq('phone_e164', phoneE164).maybeSingle(),
    )
  }
  getContactById(id: string) {
    return this.one<ContactRow>(this.db.from('voice_contacts').select('*').eq('id', id).maybeSingle())
  }
  async createContact(input: Omit<ContactRow, 'id'>) {
    const row = await this.one<ContactRow>(this.db.from('voice_contacts').insert(input).select().single())
    if (!row) throw new VoiceError('PROVIDER_UNAVAILABLE', 'createContact returned no row')
    return row
  }
  async updateContact(id: string, patch: Partial<ContactRow>) {
    const row = await this.one<ContactRow>(this.db.from('voice_contacts').update(patch).eq('id', id).select().single())
    if (!row) throw new VoiceError('PROVIDER_UNAVAILABLE', 'updateContact returned no row')
    return row
  }

  async upsertLeadForCall(callId: string, tenantId: string, patch: Partial<LeadRow>) {
    // 1:1 anchor on call.lead_id (魏征 #3/#6 — 同一 call 更新同一 lead，不新建重复)
    const call = await this.getCallById(callId)
    if (call?.lead_id) {
      const row = await this.one<LeadRow>(
        this.db.from('voice_leads').update({ ...patch, updated_at: new Date().toISOString() })
          .eq('id', call.lead_id).eq('tenant_id', tenantId).select().single(),
      )
      if (!row) throw new VoiceError('PROVIDER_UNAVAILABLE', 'lead update returned no row')
      return row
    }
    const row = await this.one<LeadRow>(
      this.db.from('voice_leads').insert({ tenant_id: tenantId, source: 'voice_call', ...patch }).select().single(),
    )
    if (!row) throw new VoiceError('PROVIDER_UNAVAILABLE', 'lead insert returned no row')
    if (call) await this.updateCall(callId, { lead_id: row.id })
    return row
  }
  getLeadById(id: string) {
    return this.one<LeadRow>(this.db.from('voice_leads').select('*').eq('id', id).maybeSingle())
  }
  listLeadsByTenant(tenantId: string, limit = 100) {
    return this.many<LeadRow>(
      this.db.from('voice_leads').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(limit),
    )
  }

  async createCall(input: Omit<CallRow, 'id' | 'created_at' | 'updated_at'>) {
    const { data, error } = await this.db.from('voice_calls').insert(input).select().single()
    if (error) {
      if (error.code === '23505') throw new VoiceError('CALL_ALREADY_ENDED', 'duplicate call (openai_call_id)')
      throw new VoiceError('PROVIDER_UNAVAILABLE', error.message)
    }
    return data as CallRow
  }
  getCallById(id: string) {
    return this.one<CallRow>(this.db.from('voice_calls').select('*').eq('id', id).maybeSingle())
  }
  getCallByOpenAiId(openaiCallId: string) {
    return this.one<CallRow>(this.db.from('voice_calls').select('*').eq('openai_call_id', openaiCallId).maybeSingle())
  }
  async updateCall(id: string, patch: Partial<CallRow>) {
    const row = await this.one<CallRow>(this.db.from('voice_calls').update(patch).eq('id', id).select().single())
    if (!row) throw new VoiceError('PROVIDER_UNAVAILABLE', 'updateCall returned no row')
    return row
  }
  listCallsByTenant(tenantId: string, opts?: { limit?: number; includeSimulated?: boolean }) {
    let q = this.db.from('voice_calls').select('*').eq('tenant_id', tenantId)
    if (opts?.includeSimulated === false) q = q.eq('is_simulated', false)
    return this.many<CallRow>(q.order('created_at', { ascending: false }).limit(opts?.limit ?? 100))
  }
  claimCallForFinalize(id: string) {
    // atomic: only the caller that flips pending/failed → running wins (魏征 #6)
    return this.one<CallRow>(
      this.db.from('voice_calls').update({ summary_status: 'running' }).eq('id', id)
        .in('summary_status', ['pending', 'failed']).select().maybeSingle(),
    )
  }

  async appendTranscript(input: Omit<TranscriptSegmentRow, 'id'>) {
    const { data, error } = await this.db.from('voice_call_transcript_segments')
      .upsert(input, { onConflict: 'call_id,sequence_no', ignoreDuplicates: true }).select().maybeSingle()
    if (error) throw new VoiceError('PROVIDER_UNAVAILABLE', error.message)
    if (data) return data as TranscriptSegmentRow
    // duplicate — fetch existing
    const existing = await this.one<TranscriptSegmentRow>(
      this.db.from('voice_call_transcript_segments').select('*')
        .eq('call_id', input.call_id).eq('sequence_no', input.sequence_no).maybeSingle(),
    )
    return existing as TranscriptSegmentRow
  }
  listTranscript(callId: string) {
    return this.many<TranscriptSegmentRow>(
      this.db.from('voice_call_transcript_segments').select('*').eq('call_id', callId).order('sequence_no'),
    )
  }

  async createToolCall(input: Omit<ToolCallRow, 'id'>) {
    const row = await this.one<ToolCallRow>(this.db.from('voice_agent_tool_calls').insert(input).select().single())
    if (!row) throw new VoiceError('PROVIDER_UNAVAILABLE', 'createToolCall returned no row')
    return row
  }
  async updateToolCall(id: string, patch: Partial<ToolCallRow>) {
    const row = await this.one<ToolCallRow>(this.db.from('voice_agent_tool_calls').update(patch).eq('id', id).select().single())
    if (!row) throw new VoiceError('PROVIDER_UNAVAILABLE', 'updateToolCall returned no row')
    return row
  }
  listToolCalls(callId: string) {
    return this.many<ToolCallRow>(this.db.from('voice_agent_tool_calls').select('*').eq('call_id', callId))
  }

  async createKnowledgeDoc(input: Omit<KnowledgeDocRow, 'id'>) {
    const row = await this.one<KnowledgeDocRow>(this.db.from('voice_knowledge_documents').insert(input).select().single())
    if (!row) throw new VoiceError('PROVIDER_UNAVAILABLE', 'createKnowledgeDoc returned no row')
    return row
  }
  listKnowledgeByTenant(tenantId: string) {
    return this.many<KnowledgeDocRow>(this.db.from('voice_knowledge_documents').select('*').eq('tenant_id', tenantId))
  }
  getKnowledgeById(id: string) {
    return this.one<KnowledgeDocRow>(this.db.from('voice_knowledge_documents').select('*').eq('id', id).maybeSingle())
  }
  async updateKnowledgeDoc(id: string, patch: Partial<KnowledgeDocRow>) {
    const row = await this.one<KnowledgeDocRow>(this.db.from('voice_knowledge_documents').update(patch).eq('id', id).select().single())
    if (!row) throw new VoiceError('PROVIDER_UNAVAILABLE', 'updateKnowledgeDoc returned no row')
    return row
  }

  async insertWebhookEventIfNew(input: Omit<WebhookEventRow, 'id'>) {
    const { data, error } = await this.db.from('voice_webhook_events')
      .insert(input).select().single()
    if (error) {
      if (error.code === '23505') {
        const existing = await this.one<WebhookEventRow>(
          this.db.from('voice_webhook_events').select('*')
            .eq('provider', input.provider).eq('external_event_id', input.external_event_id).maybeSingle(),
        )
        return { isNew: false, row: existing as WebhookEventRow }
      }
      throw new VoiceError('PROVIDER_UNAVAILABLE', error.message)
    }
    return { isNew: true, row: data as WebhookEventRow }
  }
  async markWebhookProcessed(id: string, status: string, error?: string) {
    // increment attempts to match the in-memory store's semantics (子牙复审 BUG-1).
    // PostgREST can't self-reference a column in UPDATE, so read-then-write; attempts
    // is a soft observability counter, so a non-atomic bump is acceptable here.
    const cur = await this.one<{ attempts: number }>(
      this.db.from('voice_webhook_events').select('attempts').eq('id', id).maybeSingle(),
    )
    await this.db.from('voice_webhook_events')
      .update({ status, error: error ?? null, processed_at: new Date().toISOString(), attempts: (cur?.attempts ?? 0) + 1 })
      .eq('id', id)
  }

  async isSuppressed(tenantId: string, phoneE164: string) {
    const row = await this.one<{ id: string }>(
      this.db.from('voice_outbound_suppression').select('id').eq('tenant_id', tenantId).eq('phone_e164', phoneE164).maybeSingle(),
    )
    return Boolean(row)
  }
  async addSuppression(tenantId: string, phoneE164: string, reason: string) {
    await this.db.from('voice_outbound_suppression')
      .upsert({ tenant_id: tenantId, phone_e164: phoneE164, reason }, { onConflict: 'tenant_id,phone_e164', ignoreDuplicates: true })
  }
  async countRecentCallsTo(tenantId: string, phoneE164: string, sinceIso: string) {
    const { count, error } = await this.db.from('voice_calls')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('to_number', phoneE164).gte('created_at', sinceIso)
    if (error) throw new VoiceError('PROVIDER_UNAVAILABLE', error.message)
    return count ?? 0
  }

  async createCallbackRequest(input: {
    tenant_id: string; call_id: string | null; contact_id: string | null
    preferred_date: string | null; preferred_time_window: string | null; timezone: string; reason: string | null
  }) {
    const row = await this.one<{ id: string }>(this.db.from('voice_callback_requests').insert(input).select('id').single())
    if (!row) throw new VoiceError('PROVIDER_UNAVAILABLE', 'createCallbackRequest returned no row')
    return row
  }

  async audit(input: AuditInput) {
    await this.db.from('voice_audit_logs').insert({
      tenant_id: input.tenant_id, actor_type: input.actor_type, actor_id: input.actor_id ?? null,
      operation: input.operation, resource_type: input.resource_type, resource_id: input.resource_id ?? null,
      before: input.before ?? null, changes: input.changes ?? null, call_id: input.call_id ?? null,
      request_id: input.request_id ?? null,
    })
  }

  async insertTenant(row: TenantRow) {
    const r = await this.one<TenantRow>(this.db.from('voice_tenants').upsert(row, { onConflict: 'id' }).select().single())
    return (r ?? row) as TenantRow
  }
  async insertAgent(row: AgentRow) {
    const r = await this.one<AgentRow>(this.db.from('voice_agents').upsert(row, { onConflict: 'id' }).select().single())
    return (r ?? row) as AgentRow
  }
  async insertRoute(row: PhoneRouteRow) {
    const r = await this.one<PhoneRouteRow>(this.db.from('voice_phone_routes').upsert(row, { onConflict: 'id' }).select().single())
    return (r ?? row) as PhoneRouteRow
  }
}
