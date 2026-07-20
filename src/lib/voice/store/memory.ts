/**
 * InMemoryVoiceStore — used for tests and the mock closed-loop (no live Supabase).
 * Enforces the same uniqueness/idempotency contracts as the PG schema so behaviour
 * matches production (魏征 #3).
 */
import { randomUUID } from 'crypto'
import { VoiceError, leadUpsertKeyForCall, transcriptSegmentKey } from '../domain'
import type {
  AgentRow,
  AuditInput,
  CallRow,
  ContactRow,
  KnowledgeDocRow,
  LeadRow,
  PhoneRouteRow,
  TenantRow,
  ToolCallRow,
  TranscriptSegmentRow,
  VoiceStore,
  WebhookEventRow,
} from './types'

const now = () => new Date().toISOString()
const clone = <T>(v: T): T => (v == null ? v : JSON.parse(JSON.stringify(v)))

export class InMemoryVoiceStore implements VoiceStore {
  private tenants = new Map<string, TenantRow>()
  private agents = new Map<string, AgentRow>()
  private routes = new Map<string, PhoneRouteRow>()
  private contacts = new Map<string, ContactRow>()
  private leads = new Map<string, LeadRow>()
  private leadByCall = new Map<string, string>() // leadUpsertKeyForCall → leadId
  private calls = new Map<string, CallRow>()
  private callByOpenAi = new Map<string, string>()
  private transcripts = new Map<string, TranscriptSegmentRow>() // key = transcriptSegmentKey
  private toolCalls = new Map<string, ToolCallRow>()
  private knowledge = new Map<string, KnowledgeDocRow>()
  private webhookEvents = new Map<string, WebhookEventRow>() // key = provider:external_event_id
  private suppression = new Set<string>() // key = tenant:phone
  private callbacks: { id: string }[] = []
  public auditLog: AuditInput[] = []

  async listTenants() { return Array.from(this.tenants.values()).map(clone) }
  async getTenantById(id: string) { return clone(this.tenants.get(id) ?? null) }
  async getTenantBySlug(slug: string) {
    const t = Array.from(this.tenants.values()).find((x) => x.slug === slug)
    return t ? clone(t) : null
  }
  async getAgentById(id: string) { return clone(this.agents.get(id) ?? null) }
  async listAgentsByTenant(tenantId: string) {
    return Array.from(this.agents.values()).filter((a) => a.tenant_id === tenantId).map(clone)
  }

  async listActiveRoutes() {
    return Array.from(this.routes.values()).filter((r) => r.status === 'active').map(clone)
  }
  async listRoutesByTenant(tenantId: string) {
    return Array.from(this.routes.values()).filter((r) => r.tenant_id === tenantId).map(clone)
  }

  async findContactByPhone(tenantId: string, phoneE164: string) {
    const c = Array.from(this.contacts.values()).find((x) => x.tenant_id === tenantId && x.phone_e164 === phoneE164)
    return c ? clone(c) : null
  }
  async getContactById(id: string) { return clone(this.contacts.get(id) ?? null) }
  async createContact(input: Omit<ContactRow, 'id'>) {
    const row: ContactRow = { id: randomUUID(), ...clone(input) }
    this.contacts.set(row.id, row)
    return clone(row)
  }
  async updateContact(id: string, patch: Partial<ContactRow>) {
    const cur = this.contacts.get(id)
    if (!cur) throw new VoiceError('TENANT_SCOPE_MISSING', `contact ${id} not found`)
    const next = { ...cur, ...clone(patch), id: cur.id }
    this.contacts.set(id, next)
    return clone(next)
  }

  async upsertLeadForCall(
    callId: string,
    tenantId: string,
    patch: Partial<Omit<LeadRow, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>>,
  ) {
    const key = leadUpsertKeyForCall(callId)
    const existingId = this.leadByCall.get(key)
    if (existingId) {
      const cur = this.leads.get(existingId)!
      const next: LeadRow = { ...cur, ...clone(patch), id: cur.id, tenant_id: cur.tenant_id, updated_at: now() }
      this.leads.set(existingId, next)
      return clone(next)
    }
    const row: LeadRow = {
      id: randomUUID(),
      tenant_id: tenantId,
      contact_id: null,
      source: 'voice_call',
      stage: 'new',
      intent_level: null,
      service_interest: null,
      budget_min: null,
      budget_max: null,
      currency: null,
      preferred_area: null,
      timeline: null,
      next_action: null,
      assigned_to: null,
      structured_data: {},
      last_contact_at: null,
      created_at: now(),
      updated_at: now(),
      ...clone(patch),
    }
    this.leads.set(row.id, row)
    this.leadByCall.set(key, row.id)
    // mirror supabase impl: anchor the call's lead_id (魏征 #3 — same-source behaviour)
    const call = this.calls.get(callId)
    if (call && !call.lead_id) this.calls.set(callId, { ...call, lead_id: row.id, updated_at: now() })
    return clone(row)
  }
  async getLeadById(id: string) { return clone(this.leads.get(id) ?? null) }
  async listLeadsByTenant(tenantId: string, limit = 100) {
    return Array.from(this.leads.values())
      .filter((l) => l.tenant_id === tenantId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit)
      .map(clone)
  }

  async createCall(input: Omit<CallRow, 'id' | 'created_at' | 'updated_at'>) {
    if (input.openai_call_id && this.callByOpenAi.has(input.openai_call_id)) {
      throw new VoiceError('CALL_ALREADY_ENDED', `duplicate openai_call_id ${input.openai_call_id}`)
    }
    const row: CallRow = { id: randomUUID(), created_at: now(), updated_at: now(), ...clone(input) }
    this.calls.set(row.id, row)
    if (row.openai_call_id) this.callByOpenAi.set(row.openai_call_id, row.id)
    return clone(row)
  }
  async getCallById(id: string) { return clone(this.calls.get(id) ?? null) }
  async getCallByOpenAiId(openaiCallId: string) {
    const id = this.callByOpenAi.get(openaiCallId)
    return id ? clone(this.calls.get(id) ?? null) : null
  }
  async updateCall(id: string, patch: Partial<CallRow>) {
    const cur = this.calls.get(id)
    if (!cur) throw new VoiceError('CALL_ALREADY_ENDED', `call ${id} not found`)
    const next = { ...cur, ...clone(patch), id: cur.id, updated_at: now() }
    this.calls.set(id, next)
    if (next.openai_call_id) this.callByOpenAi.set(next.openai_call_id, id)
    return clone(next)
  }
  async listCallsByTenant(tenantId: string, opts?: { limit?: number; includeSimulated?: boolean }) {
    const includeSim = opts?.includeSimulated ?? true
    return Array.from(this.calls.values())
      .filter((c) => c.tenant_id === tenantId && (includeSim || !c.is_simulated))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, opts?.limit ?? 100)
      .map(clone)
  }
  async claimCallForFinalize(id: string) {
    const cur = this.calls.get(id)
    if (!cur) return null
    if (cur.summary_status === 'running' || cur.summary_status === 'done') return null
    const next = { ...cur, summary_status: 'running' as const, updated_at: now() }
    this.calls.set(id, next)
    return clone(next)
  }

  async appendTranscript(input: Omit<TranscriptSegmentRow, 'id'>) {
    const key = transcriptSegmentKey(input.call_id, input.sequence_no)
    const existing = this.transcripts.get(key)
    if (existing) return clone(existing) // idempotent on (call, seq)
    const row: TranscriptSegmentRow = { id: randomUUID(), ...clone(input) }
    this.transcripts.set(key, row)
    return clone(row)
  }
  async listTranscript(callId: string) {
    return Array.from(this.transcripts.values())
      .filter((s) => s.call_id === callId)
      .sort((a, b) => a.sequence_no - b.sequence_no)
      .map(clone)
  }

  async createToolCall(input: Omit<ToolCallRow, 'id'>) {
    const row: ToolCallRow = { id: randomUUID(), ...clone(input) }
    this.toolCalls.set(row.id, row)
    return clone(row)
  }
  async updateToolCall(id: string, patch: Partial<ToolCallRow>) {
    const cur = this.toolCalls.get(id)
    if (!cur) throw new VoiceError('REALTIME_TOOL_INVALID_ARGS', `tool call ${id} not found`)
    const next = { ...cur, ...clone(patch), id: cur.id }
    this.toolCalls.set(id, next)
    return clone(next)
  }
  async listToolCalls(callId: string) {
    return Array.from(this.toolCalls.values()).filter((t) => t.call_id === callId).map(clone)
  }

  async createKnowledgeDoc(input: Omit<KnowledgeDocRow, 'id'>) {
    const row: KnowledgeDocRow = { id: randomUUID(), ...clone(input) }
    this.knowledge.set(row.id, row)
    return clone(row)
  }
  async listKnowledgeByTenant(tenantId: string) {
    return Array.from(this.knowledge.values()).filter((k) => k.tenant_id === tenantId).map(clone)
  }
  async getKnowledgeById(id: string) { return clone(this.knowledge.get(id) ?? null) }
  async updateKnowledgeDoc(id: string, patch: Partial<KnowledgeDocRow>) {
    const cur = this.knowledge.get(id)
    if (!cur) throw new VoiceError('KNOWLEDGE_NOT_READY', `doc ${id} not found`)
    const next = { ...cur, ...clone(patch), id: cur.id }
    this.knowledge.set(id, next)
    return clone(next)
  }

  async insertWebhookEventIfNew(input: Omit<WebhookEventRow, 'id'>) {
    const key = `${input.provider}:${input.external_event_id}`
    const existing = this.webhookEvents.get(key)
    if (existing) return { isNew: false, row: clone(existing) }
    const row: WebhookEventRow = { id: randomUUID(), ...clone(input) }
    this.webhookEvents.set(key, row)
    return { isNew: true, row: clone(row) }
  }
  async markWebhookProcessed(id: string, status: string, error?: string) {
    const row = Array.from(this.webhookEvents.values()).find((r) => r.id === id)
    if (row) {
      row.status = status
      if (error) (row as WebhookEventRow & { error?: string }).error = error
      row.attempts += 1
    }
  }

  async isSuppressed(tenantId: string, phoneE164: string) {
    return this.suppression.has(`${tenantId}:${phoneE164}`)
  }
  async addSuppression(tenantId: string, phoneE164: string, _reason: string) {
    this.suppression.add(`${tenantId}:${phoneE164}`)
  }
  async countRecentCallsTo(tenantId: string, phoneE164: string, sinceIso: string) {
    return Array.from(this.calls.values()).filter(
      (c) => c.tenant_id === tenantId && c.to_number === phoneE164 && c.created_at >= sinceIso,
    ).length
  }

  async createCallbackRequest(input: {
    tenant_id: string; call_id: string | null; contact_id: string | null
    preferred_date: string | null; preferred_time_window: string | null; timezone: string; reason: string | null
  }) {
    const row = { id: randomUUID(), ...input }
    this.callbacks.push({ id: row.id })
    return { id: row.id }
  }

  async audit(input: AuditInput) { this.auditLog.push(clone(input)) }

  async insertTenant(row: TenantRow) { this.tenants.set(row.id, clone(row)); return clone(row) }
  async insertAgent(row: AgentRow) { this.agents.set(row.id, clone(row)); return clone(row) }
  async insertRoute(row: PhoneRouteRow) { this.routes.set(row.id, clone(row)); return clone(row) }
}
