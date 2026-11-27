/**
 * 把 CRM 判过的「别再联系 / 不感兴趣」同步进 Mailchimp 的抑制标签。
 *
 * ## 为什么要它（PM 2026-09-08 CTS newsletter 排期会话中发现的真实缺口）
 *
 * CTS 有两条独立的「谁不该再联系」判定：CRM（电话/邮件/私信笔记解析出
 * `not_interested` / `do_not_contact`，用于决定还要不要打电话）和 Mailchimp
 * 的 `suppressed_do_not_email` 标签（决定还要不要发营销邮件）。**这两条从来没有
 * 同步过**——`sales_active`（2026-07-13 上线）和 `paid_customer`
 * （见 `paid-tagging.ts`，2026-09-02 上线）都已经有 CRM → Mailchimp 的自动管道，
 * 唯独「不感兴趣/拒联」这一档一直是人工，从没人补过。
 *
 * 实测口径（2026-09-08）：CRM 里 26 个联系人判过 not_interested/do_not_contact，
 * 其中 6 个当时在 Mailchimp 里仍是 subscribed 状态、没打抑制标签——也就是说
 * 下一封群发邮件本来会发给他们。已手工补上那 6 个，本文件是让这件事以后
 * 天天自动跑，不再靠人想起来查。
 *
 * ## 判据复用，不重新发明
 *
 * `do_not_contact` 复用 `crm/dnc.ts` 的 `isDoNotContact()`——**全仓唯一一份
 * 「别再联系算不算成立」的判据**，含「人明确纠正过」的解除逻辑。
 * `not_interested` 没有纠正机制（`dnc.ts` 原话：「这句话没资格替客人收回
 * 『我不买了』」），所以只要出现过一次就算数，跟 `crm/segments.ts` 的
 * `DEAD_OUTCOMES` 语义一致。
 *
 * ## 只加标签，不摘、不动订阅关系
 *
 * 这个方向的写操作只应该让人**少收到**邮件，不应该反过来把已经被抑制的人
 * 解除抑制——CRM 那边没有等价的「不感兴趣被撤销」信号，`dnc_cleared` 只解除
 * `do_not_contact`，不解除 `not_interested`。所以本文件不做「摘掉抑制标签」
 * 这件事，那必须是人工确认后的动作。
 *
 * ## 第三个理由：ME 自己的退订（P2-2c-3，2026-11-27）
 *
 * 客人点了 ME 自动信的退订链接、或把 ME 的信标成垃圾邮件（`me_unsubscribe` 记录，
 * `crm/email-unsubscribe.ts`），也要打同一个抑制标签：过渡期同一个客人还在 Mailchimp
 * 名单上，不同步就会继续收到月信。这是新加的判据 `needsMailchimpSuppression`，
 * `needsSuppression` 不变（发信关口在用它）。设计：
 * `docs/specs/2026-11-02-me-send-gate-p2-design-v0.md` §16.10 契约 / §17 P2-2c-3。
 * ME 退订同样「ME 里没有任何东西会自己撤销」，所以照旧只加不摘。
 */

import { emailAddressSha256 } from '@/lib/crm/address-sha256'
import { isDoNotContact, type DncTouch } from '@/lib/crm/dnc'
import { applyMemberTags, type MailchimpTagsConfig } from './tags'

/**
 * 标签名默认值——跟 `mailchimp/audience-config.ts` 的
 * `DEFAULT_META_LEAD_SOURCE_TAG` 同一个理由：这个名字目前只有 CTS 在用，但
 * 语义足够通用（"别再发邮件给这个人"），敢给默认值；换客户如果标签名不同，
 * 调用方从 `leads_config` 传进来覆盖。
 */
export const DEFAULT_SUPPRESS_TAG = 'suppressed_do_not_email'

export interface ContactForSuppressionCheck {
  contactId: string
  email: string | null
  doNotContactFlag: boolean
  touches: DncTouch[]
  /**
   * The guest unsubscribed from e-mail through ME's own link, or marked an ME letter as spam (a `me_unsubscribe`
   * record, see `crm/email-unsubscribe.ts`). Work it out with `meEmailUnsubscribedContactIds`. Required on purpose:
   * a caller that forgets it must not compile.
   */
  meEmailUnsubscribed: boolean
}

/** One ME unsubscribe record as the sync needs it: whose letter it was and the fingerprint of the address. */
export interface MeEmailUnsubscribeMark {
  contactId: string | null
  addressSha256: string | null
}

export interface SuppressionSyncResult {
  scanned: number
  /** contactId 列表，不放 email——日志 PII 规矩同 `sync.ts`/`tags.ts`。 */
  newlySuppressed: string[]
  alreadyTagged: number
  skippedNoEmail: number
  /** 判过要抑制、但邮箱压根不在这个 Mailchimp audience 里——不算错误。 */
  notInAudience: number
  /** Contacts tagged (or checked) only because of an ME unsubscribe: neither do-not-contact nor not-interested. */
  meUnsubscribeOnly: number
  errors: Array<{ contactId: string; reason: string }>
}

function isNotInterested(touches: readonly DncTouch[]): boolean {
  return touches.some((t) => t.outcome === 'not_interested')
}

/** 这个人现在算不算「该从邮件营销里抑制掉」。导出供上游 UI 复用同一份判据。 */
export function needsSuppression(
  c: Pick<ContactForSuppressionCheck, 'doNotContactFlag' | 'touches'>,
): boolean {
  return isDoNotContact(c.doNotContactFlag, c.touches) || isNotInterested(c.touches)
}

const SHA256_RE = /^[0-9a-f]{64}$/

/** The `me_unsubscribe` touchpoint rows as read from the table. A fingerprint that is not 64 hex is dropped. */
export function toMeEmailUnsubscribeMarks(
  rows: ReadonlyArray<{ contact_id: string | null; metadata: { address_sha256?: unknown } | null }>,
): MeEmailUnsubscribeMark[] {
  return rows.map((r) => {
    const raw = r.metadata?.address_sha256
    return { contactId: r.contact_id, addressSha256: typeof raw === 'string' && SHA256_RE.test(raw) ? raw : null }
  })
}

/**
 * Which contacts have an ME e-mail unsubscribe. Same matching as the sender's read (`readEmailUnsubscribed`):
 * a record of this contact counts whatever its address; a record of another contact counts when its address
 * fingerprint is this contact's address (the same address can sit on two contact records).
 * Only the contact's current e-mail can be matched: the record keeps a fingerprint, not the address itself.
 */
export function meEmailUnsubscribedContactIds(
  contacts: ReadonlyArray<{ contactId: string; email: string | null }>,
  marks: readonly MeEmailUnsubscribeMark[],
): Set<string> {
  const byContact = new Set<string>()
  const byAddress = new Set<string>()
  for (const m of marks) {
    if (m.contactId) byContact.add(m.contactId)
    if (m.addressSha256) byAddress.add(m.addressSha256)
  }
  const out = new Set<string>()
  for (const c of contacts) {
    const ownRecord = byContact.has(c.contactId)
    const addressRecord = c.email !== null && c.email.trim() !== '' && byAddress.has(emailAddressSha256(c.email))
    if (ownRecord || addressRecord) out.add(c.contactId)
  }
  return out
}

/**
 * Should the Mailchimp suppression tag go on. `needsSuppression` (do-not-contact or not-interested) is NOT changed:
 * the sender's gate uses it and reads ME unsubscribes on its own. This adds the ME unsubscribe as a separate reason,
 * so a guest who unsubscribed from an ME letter also stops getting the client's Mailchimp campaigns.
 */
export function needsMailchimpSuppression(c: Omit<ContactForSuppressionCheck, 'contactId' | 'email'>): boolean {
  return needsSuppression(c) || c.meEmailUnsubscribed
}

export async function syncSuppressionTags(
  contacts: readonly ContactForSuppressionCheck[],
  mcConfig: MailchimpTagsConfig,
  opts: { suppressTag?: string; dryRun?: boolean } = {},
): Promise<SuppressionSyncResult> {
  const tag = opts.suppressTag?.trim() || DEFAULT_SUPPRESS_TAG
  const result: SuppressionSyncResult = {
    scanned: contacts.length,
    newlySuppressed: [],
    alreadyTagged: 0,
    skippedNoEmail: 0,
    notInAudience: 0,
    meUnsubscribeOnly: 0,
    errors: [],
  }

  for (const c of contacts) {
    if (!needsMailchimpSuppression(c)) continue
    if (!needsSuppression(c)) result.meUnsubscribeOnly++
    if (!c.email) {
      result.skippedNoEmail++
      continue
    }
    const applied = await applyMemberTags(mcConfig, c.email, { add: [tag] }, { dryRun: opts.dryRun })
    if (applied.status === 'applied') result.newlySuppressed.push(c.contactId)
    else if (applied.status === 'noop') result.alreadyTagged++
    else if (applied.status === 'skipped') result.notInAudience++
    else if (applied.status === 'error') result.errors.push({ contactId: c.contactId, reason: applied.reason })
  }

  return result
}

export type { MailchimpTagsConfig }
