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
 */

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
}

export interface SuppressionSyncResult {
  scanned: number
  /** contactId 列表，不放 email——日志 PII 规矩同 `sync.ts`/`tags.ts`。 */
  newlySuppressed: string[]
  alreadyTagged: number
  skippedNoEmail: number
  /** 判过要抑制、但邮箱压根不在这个 Mailchimp audience 里——不算错误。 */
  notInAudience: number
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
    errors: [],
  }

  for (const c of contacts) {
    if (!needsSuppression(c)) continue
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
