/**
 * 读「信的登记」和「ME 自己发的信的发送记录」（只读，不写）。
 *
 * 绝不返回邮箱：这里只 select 明确列出的列——登记表读标题 / 正文 / 版本（不读 created_by），
 * 授权表只读是否已批（不读 rule：它里面有试发邮箱名单），发送账本只读 trigger_key / contact_id / 范围 / 状态 / 原因码
 * （不读收件地址的哈希，也不读 annotations）。
 *
 * 一封信怎么对上记录（都由信的四项事实算出来，见 keys.ts）：
 *  - 登记：crm_email_templates.template_key = buildTemplateKey(...)，取最大版本。
 *  - 提案 / 发送：triggered_send_authorizations / triggered_sends 的 trigger_key = buildTriggerKey(...)。
 *
 * 走 Mailchimp 发的信（发信设计窗口 11-10 定的对应规则）：Mailchimp 活动的标题 ＝ 这封信的模板键，一字不差、区分大小写；
 * 只认已经发出的活动（同步只给已发出的活动写记录）；同一个标题对上不止一个活动就不猜（对不上，页面如实说）；
 * 对不上的信显示「草稿」、发送情况「—」，不报错。记录来自 Mailchimp 同步写进 contact_touchpoints 的「发出」「打开」「点击」，
 * 这里只读、只 select 明确列出的列（不读 summary，也不读任何邮箱）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase-paginate'
import type { RecipientOutcome, RegistryEntry, SendFacts } from './aggregate'
import type { RecipientStatus } from './types'

const CHUNK_SIZE = 100

const TEMPLATE_COLUMNS = 'template_key, version, subject, body'
const AUTHORIZATION_COLUMNS = 'trigger_key, authorized_at, revoked_at, template_sha256'
const SEND_COLUMNS = 'id, trigger_key, contact_id, dedupe_scope, status, reason_code'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function rowsOf(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data) ? data.filter(isRecord) : []
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size))
  return out
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values))
}

// ─── 信的登记 ────────────────────────────────────────────────────────────────

/** 每个模板键取最大版本（登记表只增不改，最大版本就是「现在这版」）。读不出来就抛错。 */
export async function loadRegistry(
  db: SupabaseClient,
  clientId: string,
  templateKeys: readonly string[],
): Promise<Map<string, RegistryEntry>> {
  const latest = new Map<string, { version: number; entry: RegistryEntry }>()
  for (const group of chunk(unique(templateKeys), CHUNK_SIZE)) {
    const res = await db.from('crm_email_templates').select(TEMPLATE_COLUMNS).eq('client_id', clientId).in('template_key', group)
    if (res.error) throw new Error(res.error.message)
    for (const row of rowsOf(res.data)) {
      const key = str(row.template_key)
      const version = typeof row.version === 'number' ? row.version : null
      if (key === null || version === null) continue
      const known = latest.get(key)
      if (known !== undefined && known.version >= version) continue
      // 预览行：登记表目前没有这一列，先给 null（发信设计窗口加列之后在这里接）。
      latest.set(key, { version, entry: { subject: str(row.subject), previewText: null, bodyText: str(row.body) } })
    }
  }
  return new Map(Array.from(latest, ([key, value]) => [key, value.entry] as const))
}

// ─── ME 自己发的信：提案 + 发送记录 ──────────────────────────────────────────

/**
 * 发送账本的状态 → 收件人状态（约定 §3，11-10 傍晚按发信窗口的口径更新）。认不出的状态按「待发」，绝不当成已发。
 * complained（客人投诉）说明信已经送到，算收到；unknown_outcome 单列成「结果不明」，不并进出错。
 */
export function recipientStatusOf(status: string): RecipientStatus {
  switch (status) {
    case 'sent':
    case 'delivered':
    case 'delivery_delayed':
    case 'complained':
      return 'sent'
    case 'blocked':
    case 'skipped':
    case 'suppressed':
      return 'blocked'
    case 'failed':
    case 'bounced':
      return 'failed'
    case 'unknown_outcome':
      return 'unknown'
    default:
      return 'pending'
  }
}

/**
 * 账本状态里已经落定、不会再变的：收到了，或者终局没收到（规则内跳过 skipped、被屏蔽 suppressed、发送失败 failed、被退回 bounced）。
 * 排队中（pending）、终身行上可重试的拦截（blocked）、结果不明（unknown_outcome）都还没落定；认不出的状态也按没落定，绝不当成已发。
 */
const SETTLED_STATUSES: ReadonlySet<string> = new Set([
  'sent',
  'delivered',
  'delivery_delayed',
  'complained',
  'skipped',
  'suppressed',
  'failed',
  'bounced',
])

interface SendRow {
  triggerKey: string
  contactId: string
  rehearsal: boolean
  status: string
  reasonCode: string | null
}

function toSendRow(raw: Record<string, unknown>): SendRow | null {
  const triggerKey = str(raw.trigger_key)
  const contactId = str(raw.contact_id)
  const scope = str(raw.dedupe_scope)
  const status = str(raw.status)
  if (triggerKey === null || contactId === null || scope === null || status === null) return null
  return { triggerKey, contactId, rehearsal: scope === 'shadow', status, reasonCode: str(raw.reason_code) }
}

const STATUS_REASON: Readonly<Record<string, string>> = {
  bounced: 'bounced',
  unknown_outcome: 'unknown_outcome',
  complained: 'complained',
}

function outcomeOf(row: SendRow): RecipientOutcome {
  if (row.rehearsal) {
    return { contactId: row.contactId, outcome: 'rehearsal', reasonCode: row.reasonCode, settled: true, opened: null, clicked: null }
  }
  // 这几种状态账本常常不写原因码：照状态补一个，让页面说清楚（退信 → 邮箱退回；结果不明 → 等人核对；投诉 → 他投诉过）。
  const reasonCode = row.reasonCode ?? STATUS_REASON[row.status] ?? null
  return {
    contactId: row.contactId,
    outcome: recipientStatusOf(row.status),
    reasonCode,
    settled: SETTLED_STATUSES.has(row.status),
    opened: null,
    clicked: null,
  }
}

/** 同一个人既有真发行又有演练行时，真发的算数（演练只是预演）。 */
function mergeOutcomes(rows: readonly SendRow[]): RecipientOutcome[] {
  const byContact = new Map<string, SendRow>()
  for (const row of rows) {
    const known = byContact.get(row.contactId)
    if (known === undefined || (known.rehearsal && !row.rehearsal)) byContact.set(row.contactId, row)
  }
  return Array.from(byContact.values(), outcomeOf)
}

interface ProposalStates {
  /** 等你放行：还没批、也没撤回，并且带着要发的那一版正文。 */
  pending: Set<string>
  /** 已放行：批了、没撤回。 */
  approved: Set<string>
}

async function loadProposalStates(db: SupabaseClient, clientId: string, triggerKeys: readonly string[]): Promise<ProposalStates> {
  const pending = new Set<string>()
  const approved = new Set<string>()
  for (const group of chunk(triggerKeys, CHUNK_SIZE)) {
    const res = await db
      .from('triggered_send_authorizations')
      .select(AUTHORIZATION_COLUMNS)
      .eq('client_id', clientId)
      .in('trigger_key', group)
    if (res.error) throw new Error(res.error.message)
    for (const row of rowsOf(res.data)) {
      const key = str(row.trigger_key)
      if (key === null || row.revoked_at != null) continue // 撤回的提案不算（没有「撤下了、没发」这一种状态可显示）
      if (row.authorized_at != null) {
        approved.add(key)
      } else if (str(row.template_sha256) !== null) {
        // 等你放行（约定 §10；演练用的欢迎信提案这一列是空的，不算）。
        pending.add(key)
      }
    }
  }
  return { pending, approved }
}

async function loadSendRows(db: SupabaseClient, clientId: string, triggerKeys: readonly string[]): Promise<SendRow[]> {
  const rows: SendRow[] = []
  for (const group of chunk(triggerKeys, CHUNK_SIZE)) {
    const raw = await fetchAll<Record<string, unknown>>(
      (from, to) =>
        db
          .from('triggered_sends')
          .select(SEND_COLUMNS)
          .eq('client_id', clientId)
          .in('trigger_key', group)
          .order('id', { ascending: true })
          .range(from, to),
      20000,
    )
    for (const item of raw) {
      const row = toSendRow(item)
      if (row !== null) rows.push(row)
    }
  }
  return rows
}

/**
 * 返回的 Map 只含「有提案（等你放行的或已放行的）或有发送记录」的信（key = trigger_key）；
 * 没有任何事实的信不在里面（页面显示草稿）。
 */
export async function loadMeSends(
  db: SupabaseClient,
  clientId: string,
  triggerKeys: readonly string[],
): Promise<Map<string, SendFacts>> {
  const keys = unique(triggerKeys)
  const result = new Map<string, SendFacts>()
  if (keys.length === 0) return result
  const [proposals, sendRows] = await Promise.all([loadProposalStates(db, clientId, keys), loadSendRows(db, clientId, keys)])

  const rowsByKey = new Map<string, SendRow[]>()
  for (const row of sendRows) rowsByKey.set(row.triggerKey, [...(rowsByKey.get(row.triggerKey) ?? []), row])

  for (const key of keys) {
    const rows = rowsByKey.get(key) ?? []
    const proposalPending = proposals.pending.has(key)
    const proposalApproved = proposals.approved.has(key)
    if (rows.length === 0 && !proposalPending && !proposalApproved) continue
    result.set(key, {
      channel: 'me',
      proposalPending,
      proposalApproved,
      recipients: mergeOutcomes(rows),
    })
  }
  return result
}

// ─── 走 Mailchimp 发的信 ──────────────────────────────────────────────────────

const TOUCHPOINT_COLUMNS = 'id, contact_id, direction, metadata'
/** 活动标题存在触点的 metadata 里（同步写「发出」和「打开 / 点击」时都带）；PostgREST 取文本的路径写法。 */
const CAMPAIGN_TITLE_PATH = 'metadata->>email_campaign_title'

export interface MailchimpSends {
  /** 能一一对上的信（key = 模板键）：活动标题和模板键一字不差（区分大小写），并且只有一个已发出的活动。 */
  facts: Map<string, SendFacts>
  /** 标题一样的已发出活动不止一个、不敢猜的信：模板键 → 同名活动个数（至少 2）。 */
  ambiguous: Map<string, number>
}

interface MailchimpPerson {
  /** 「发出」记录里的收件状态（sent / hard / soft）；没有「发出」记录（只有打开 / 点击）→ null。 */
  status: string | null
  hasSentRow: boolean
  opened: boolean
  clicked: boolean
}

interface MailchimpTitleGroup {
  campaigns: Set<string>
  people: Map<string, MailchimpPerson>
  /** 这个标题下有没有任何一条打开 / 点击记录：一条都没有，说明打开还没同步进来，不能把「没有记录」说成「没人打开」。 */
  anyInbound: boolean
}

/** Mailchimp 的收件状态 → 收件人状态。认不出的状态按「待发」，绝不当成已发。 */
function mailchimpOutcomeOf(status: string | null): { outcome: RecipientStatus; reasonCode: string | null } {
  if (status === 'sent') return { outcome: 'sent', reasonCode: null }
  if (status === 'hard') return { outcome: 'failed', reasonCode: 'bounced' }
  if (status === 'soft') return { outcome: 'failed', reasonCode: 'soft_bounced' }
  return { outcome: 'pending', reasonCode: null }
}

/** 按活动标题归拢触点；标题必须在要找的模板键里（一字不差），其余一律不看。 */
function groupByTitle(rows: readonly Record<string, unknown>[], wanted: ReadonlySet<string>): Map<string, MailchimpTitleGroup> {
  const byTitle = new Map<string, MailchimpTitleGroup>()
  for (const row of rows) {
    const meta = isRecord(row.metadata) ? row.metadata : null
    const title = meta === null ? null : str(meta.email_campaign_title)
    const contactId = str(row.contact_id)
    if (meta === null || title === null || contactId === null || !wanted.has(title)) continue
    const isSent = row.direction === 'outbound' && meta.kind === 'sent'
    // 打开 / 点击记录：必须真的说了「打开了」或「点了链接」，才算数（一条什么都没说的记录不能证明信送到了）。
    const isInbound = row.direction === 'inbound' && (meta.email_opened === true || meta.email_clicked === true)
    if (!isSent && !isInbound) continue
    const group = byTitle.get(title) ?? { campaigns: new Set<string>(), people: new Map<string, MailchimpPerson>(), anyInbound: false }
    group.campaigns.add(str(meta.email_campaign_id) ?? '')
    const person = group.people.get(contactId) ?? { status: null, hasSentRow: false, opened: false, clicked: false }
    if (isSent) {
      person.hasSentRow = true
      person.status = str(meta.email_send_status)
    } else {
      group.anyInbound = true
      person.clicked = person.clicked || meta.email_clicked === true
      person.opened = person.opened || meta.email_opened === true || meta.email_clicked === true // 点了链接一定是打开过
    }
    group.people.set(contactId, person)
    byTitle.set(title, group)
  }
  return byTitle
}

function mailchimpFactsOf(group: MailchimpTitleGroup): SendFacts | null {
  const recipients: RecipientOutcome[] = []
  for (const [contactId, person] of group.people) {
    // 只有打开 / 点击记录、没有「发出」记录的人：能打开说明信已经送到，算收到。
    const { outcome, reasonCode } = person.hasSentRow ? mailchimpOutcomeOf(person.status) : { outcome: 'sent' as const, reasonCode: null }
    // 打开 / 点击只对收到的人有意义；整封信一条打开记录都没有时先不下结论（页面显示「—」，不是「0」）。
    const tracked = group.anyInbound && outcome === 'sent'
    recipients.push({
      contactId,
      outcome,
      reasonCode,
      settled: outcome !== 'pending',
      opened: tracked ? person.opened : null,
      clicked: tracked ? person.clicked : null,
    })
  }
  if (recipients.length === 0) return null
  recipients.sort((a, b) => a.contactId.localeCompare(b.contactId))
  return { channel: 'mailchimp', proposalPending: false, proposalApproved: false, recipients }
}

/**
 * 读走 Mailchimp 发的信的发出 / 打开 / 点击（只读，不写，不调 Mailchimp）。key 是模板键。
 * 对不上的信（没有同名活动，或只有别的客户的 / 别的来源的记录）不在返回里；同名活动不止一个的信放进 `ambiguous`，不猜。
 */
export async function loadMailchimpSends(
  db: SupabaseClient,
  clientId: string,
  templateKeys: readonly string[],
): Promise<MailchimpSends> {
  const keys = unique(templateKeys)
  const result: MailchimpSends = { facts: new Map(), ambiguous: new Map() }
  if (keys.length === 0) return result
  const rows: Record<string, unknown>[] = []
  for (const group of chunk(keys, CHUNK_SIZE)) {
    const raw = await fetchAll<Record<string, unknown>>(
      (from, to) =>
        db
          .from('contact_touchpoints')
          .select(TOUCHPOINT_COLUMNS)
          .eq('client_id', clientId)
          .eq('source', 'mailchimp')
          .in(CAMPAIGN_TITLE_PATH, group)
          .order('id', { ascending: true })
          .range(from, to),
      20000,
    )
    rows.push(...raw)
  }
  for (const [title, group] of groupByTitle(rows, new Set(keys))) {
    if (group.campaigns.size > 1) {
      result.ambiguous.set(title, group.campaigns.size)
      continue
    }
    const facts = mailchimpFactsOf(group)
    if (facts !== null) result.facts.set(title, facts)
  }
  return result
}
