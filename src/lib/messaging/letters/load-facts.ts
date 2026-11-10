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
 * Mailchimp 那一路这一版没有接：Mailchimp 的发出记录要靠「活动标题 ↔ 哪封信」对上，这个对应关系还没定
 * （见 PR 说明里要发信设计窗口答的问题）。没接之前，走 Mailchimp 的信显示成「草稿」、发送情况「—」，
 * 与约定 §9 的 3 一致。
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

/** 发送账本的状态 → 收件人状态（约定 §3）。认不出的状态按「待发」，绝不当成已发。 */
export function recipientStatusOf(status: string): RecipientStatus {
  switch (status) {
    case 'sent':
    case 'delivered':
    case 'delivery_delayed':
      return 'sent'
    case 'blocked':
    case 'skipped':
    case 'suppressed':
      return 'blocked'
    case 'failed':
    case 'bounced':
    case 'complained':
    case 'unknown_outcome':
      return 'failed'
    default:
      return 'pending'
  }
}

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
    return { contactId: row.contactId, outcome: 'rehearsal', reasonCode: row.reasonCode, opened: null, clicked: null }
  }
  // 这几种状态账本常常不写原因码：照状态补一个，让页面说清楚（退信 → 邮箱退回；结果不明 → 等人核对；投诉 → 他投诉过）。
  const reasonCode = row.reasonCode ?? STATUS_REASON[row.status] ?? null
  return { contactId: row.contactId, outcome: recipientStatusOf(row.status), reasonCode, opened: null, clicked: null }
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

async function loadPendingProposals(db: SupabaseClient, clientId: string, triggerKeys: readonly string[]): Promise<Set<string>> {
  const pending = new Set<string>()
  for (const group of chunk(triggerKeys, CHUNK_SIZE)) {
    const res = await db
      .from('triggered_send_authorizations')
      .select(AUTHORIZATION_COLUMNS)
      .eq('client_id', clientId)
      .in('trigger_key', group)
    if (res.error) throw new Error(res.error.message)
    for (const row of rowsOf(res.data)) {
      const key = str(row.trigger_key)
      // 等你放行 = 还没批、也没撤回，并且带着要发的那一版正文（约定 §10；演练用的欢迎信提案这一列是空的，不算）。
      if (key !== null && row.authorized_at == null && row.revoked_at == null && str(row.template_sha256) !== null) {
        pending.add(key)
      }
    }
  }
  return pending
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

/** 返回的 Map 只含「有提案或有发送记录」的信（key = trigger_key）；没有任何事实的信不在里面（页面显示草稿）。 */
export async function loadMeSends(
  db: SupabaseClient,
  clientId: string,
  triggerKeys: readonly string[],
): Promise<Map<string, SendFacts>> {
  const keys = unique(triggerKeys)
  const result = new Map<string, SendFacts>()
  if (keys.length === 0) return result
  const [pending, sendRows] = await Promise.all([loadPendingProposals(db, clientId, keys), loadSendRows(db, clientId, keys)])

  const rowsByKey = new Map<string, SendRow[]>()
  for (const row of sendRows) rowsByKey.set(row.triggerKey, [...(rowsByKey.get(row.triggerKey) ?? []), row])

  for (const key of keys) {
    const rows = rowsByKey.get(key) ?? []
    const proposalPending = pending.has(key)
    if (rows.length === 0 && !proposalPending) continue
    result.set(key, {
      channel: 'me',
      proposalPending,
      // 已经开始发 = 有真发行（不是演练），并且至少一行不是被拦 / 跳过（约定 §10）。
      started: rows.some((row) => !row.rehearsal && row.status !== 'blocked' && row.status !== 'skipped'),
      recipients: mergeOutcomes(rows),
    })
  }
  return result
}
