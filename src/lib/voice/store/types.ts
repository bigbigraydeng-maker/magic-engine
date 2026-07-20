/**
 * VoiceStore — repository interface. Two impls (memory + supabase) implement it;
 * factory picks by config. All methods are tenant-scoped by contract (魏征 #2:
 * isolation lives in the repository layer, not DB RLS).
 */
import type {
  CallDirection,
  CallStatus,
  ConsentStatus,
  IntentLevel,
  Speaker,
  SummaryStatus,
} from '../domain'

// ── Row shapes (subset of columns the P0 loop touches) ───────────────────────
export interface TenantRow {
  id: string
  client_id: string | null
  slug: string
  name: string
  status: string
  default_timezone: string
  default_language: string
  openai_vector_store_id: string | null
  settings: Record<string, unknown>
}

export interface AgentRow {
  id: string
  tenant_id: string
  name: string
  role: string
  status: string
  model: string
  voice: string | null
  reasoning_effort: string
  primary_language: string
  supported_languages: string[]
  greeting: string
  system_instructions: string
  ai_disclosure_required: boolean
  business_hours: Record<string, unknown>
  human_transfer_uri: string | null
  transfer_targets: Record<string, string>
  enabled_tools: string[]
  settings: Record<string, unknown>
}

export interface PhoneRouteRow {
  id: string
  tenant_id: string
  agent_id: string
  provider: string
  channel: string
  phone_number_e164: string | null
  sip_uri: string | null
  provider_resource_id: string | null
  direction: string
  status: string
  priority: number
  settings: Record<string, unknown>
}

export interface ContactRow {
  id: string
  tenant_id: string
  phone_e164: string | null
  whatsapp_phone_e164: string | null
  email: string | null
  first_name: string | null
  last_name: string | null
  preferred_language: string | null
  consent_status: ConsentStatus
  do_not_call: boolean
  me_lead_id: string | null
  metadata: Record<string, unknown>
}

export interface LeadRow {
  id: string
  tenant_id: string
  contact_id: string | null
  source: string
  stage: string
  intent_level: IntentLevel | null
  service_interest: string | null
  budget_min: number | null
  budget_max: number | null
  currency: string | null
  preferred_area: string | null
  timeline: string | null
  next_action: string | null
  assigned_to: string | null
  structured_data: Record<string, unknown>
  last_contact_at: string | null
  created_at: string
  updated_at: string
}

export interface CallRow {
  id: string
  tenant_id: string
  agent_id: string
  contact_id: string | null
  lead_id: string | null
  channel: string
  direction: CallDirection
  provider: string
  is_simulated: boolean
  provider_call_id: string | null
  openai_call_id: string | null
  from_number: string | null
  to_number: string | null
  status: CallStatus
  started_at: string | null
  answered_at: string | null
  ended_at: string | null
  duration_seconds: number | null
  language_detected: string | null
  recording_url: string | null
  transcript_status: string
  summary_status: SummaryStatus
  summary: string | null
  outcome: string | null
  disposition: string | null
  structured_outcome: Record<string, unknown>
  usage: Record<string, unknown>
  cost_estimate: Record<string, unknown>
  error_code: string | null
  error_message: string | null
  created_at: string
  updated_at: string
}

export interface TranscriptSegmentRow {
  id: string
  tenant_id: string
  call_id: string
  sequence_no: number
  speaker: Speaker
  text: string
  started_at_ms: number | null
  ended_at_ms: number | null
  source_event_id: string | null
  is_final: boolean
  metadata: Record<string, unknown>
}

export interface ToolCallRow {
  id: string
  tenant_id: string
  call_id: string | null
  agent_id: string | null
  openai_tool_call_id: string | null
  tool_name: string
  arguments: Record<string, unknown>
  status: string
  result: Record<string, unknown> | null
  error: string | null
  latency_ms: number | null
  requires_confirmation: boolean
  confirmed_at: string | null
}

export interface KnowledgeDocRow {
  id: string
  tenant_id: string
  title: string
  source_type: string
  storage_path: string | null
  source_url: string | null
  mime_type: string | null
  checksum: string | null
  openai_file_id: string | null
  openai_vector_store_id: string | null
  index_status: string
  version: number
  attributes: Record<string, unknown>
  error_message: string | null
}

export interface WebhookEventRow {
  id: string
  provider: string
  external_event_id: string
  event_type: string
  signature_valid: boolean
  payload_hash: string
  payload: Record<string, unknown> | null
  status: string
  attempts: number
}

export interface AuditInput {
  tenant_id: string | null
  actor_type: 'user' | 'agent' | 'system' | 'webhook'
  actor_id?: string | null
  operation: string
  resource_type: string
  resource_id?: string | null
  before?: Record<string, unknown> | null
  changes?: Record<string, unknown> | null
  call_id?: string | null
  request_id?: string | null
}

// ── Store interface ──────────────────────────────────────────────────────────
export interface VoiceStore {
  // tenants / agents
  listTenants(): Promise<TenantRow[]>
  getTenantById(id: string): Promise<TenantRow | null>
  getTenantBySlug(slug: string): Promise<TenantRow | null>
  getAgentById(id: string): Promise<AgentRow | null>
  listAgentsByTenant(tenantId: string): Promise<AgentRow[]>

  // routes
  listActiveRoutes(): Promise<PhoneRouteRow[]>
  listRoutesByTenant(tenantId: string): Promise<PhoneRouteRow[]>

  // contacts
  findContactByPhone(tenantId: string, phoneE164: string): Promise<ContactRow | null>
  getContactById(id: string): Promise<ContactRow | null>
  createContact(input: Omit<ContactRow, 'id'>): Promise<ContactRow>
  updateContact(id: string, patch: Partial<ContactRow>): Promise<ContactRow>

  // leads (idempotent per call via leadUpsertKeyForCall)
  upsertLeadForCall(
    callId: string,
    tenantId: string,
    patch: Partial<Omit<LeadRow, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>>,
  ): Promise<LeadRow>
  getLeadById(id: string): Promise<LeadRow | null>
  listLeadsByTenant(tenantId: string, limit?: number): Promise<LeadRow[]>

  // calls
  createCall(input: Omit<CallRow, 'id' | 'created_at' | 'updated_at'>): Promise<CallRow>
  getCallById(id: string): Promise<CallRow | null>
  getCallByOpenAiId(openaiCallId: string): Promise<CallRow | null>
  updateCall(id: string, patch: Partial<CallRow>): Promise<CallRow>
  listCallsByTenant(tenantId: string, opts?: { limit?: number; includeSimulated?: boolean }): Promise<CallRow[]>
  /** Atomically claim a call for finalize; returns null if already claimed/done. */
  claimCallForFinalize(id: string): Promise<CallRow | null>

  // transcript (idempotent per (call, sequence))
  appendTranscript(input: Omit<TranscriptSegmentRow, 'id'>): Promise<TranscriptSegmentRow>
  listTranscript(callId: string): Promise<TranscriptSegmentRow[]>

  // tool calls
  createToolCall(input: Omit<ToolCallRow, 'id'>): Promise<ToolCallRow>
  updateToolCall(id: string, patch: Partial<ToolCallRow>): Promise<ToolCallRow>
  listToolCalls(callId: string): Promise<ToolCallRow[]>

  // knowledge
  createKnowledgeDoc(input: Omit<KnowledgeDocRow, 'id'>): Promise<KnowledgeDocRow>
  listKnowledgeByTenant(tenantId: string): Promise<KnowledgeDocRow[]>
  getKnowledgeById(id: string): Promise<KnowledgeDocRow | null>
  updateKnowledgeDoc(id: string, patch: Partial<KnowledgeDocRow>): Promise<KnowledgeDocRow>

  // webhook idempotency — insert-if-new; { isNew:false } means already seen (魏征 #7)
  insertWebhookEventIfNew(input: Omit<WebhookEventRow, 'id'>): Promise<{ isNew: boolean; row: WebhookEventRow }>
  markWebhookProcessed(id: string, status: string, error?: string): Promise<void>

  // outbound safety
  isSuppressed(tenantId: string, phoneE164: string): Promise<boolean>
  addSuppression(tenantId: string, phoneE164: string, reason: string): Promise<void>
  countRecentCallsTo(tenantId: string, phoneE164: string, sinceIso: string): Promise<number>

  // callbacks
  createCallbackRequest(input: {
    tenant_id: string
    call_id: string | null
    contact_id: string | null
    preferred_date: string | null
    preferred_time_window: string | null
    timezone: string
    reason: string | null
  }): Promise<{ id: string }>

  // audit
  audit(input: AuditInput): Promise<void>

  // seed helpers (used by scripts/tests)
  insertTenant(row: TenantRow): Promise<TenantRow>
  insertAgent(row: AgentRow): Promise<AgentRow>
  insertRoute(row: PhoneRouteRow): Promise<PhoneRouteRow>
}
