/**
 * 「客人填了表，没人回」的汇总信。
 *
 * 判据在 `lead-followup-due`，编排在 `inngest/functions/crm-lead-followup-digest`。
 * 这一层只负责一件事：把名单送到人手上，而不是让它死在后台某一页里
 * （CLAUDE.md 铁律 3 下半：发现不许死在日志里）。
 *
 * ## 四个刻意的约束
 *
 * 1. **第一步只发给 ME 自己**（PM 2026-09-24 拍板）。收件人由调用方传，传空
 *    退回 `ME_MAIL_TO_ADDRESS`，**绝不去猜客户的地址**。猜错的代价是把一个
 *    客户的客人名单发给别人 —— 这条线不接受「大概是对的」。
 *    要改成发给客户的销售，是改调用方传的收件人，不是改这里。
 *
 * 2. **正文不写客人的邮箱和电话**。名字 + 感兴趣的团 + 等了多久足够认人，
 *    点链接就看到全部联系方式。多带一个号码，就是把客人的联系方式复制进了
 *    一封会被转发的邮件里。（同 `email-reply-digest` 文件头第 3 条。
 *    将来真要在信里直接给号码，得先想清楚这封信会被转给谁。）
 *    名字本身也可能是个邮箱地址，所以照样过 `stripAddress`。
 *
 * 3. **数字不许说小**。窗口外的积压、被上限压掉的，都要在正文里说出来。
 *    「有 8 个人在等」而实际 285 个，看信的人处理完 8 个以为清空了 ——
 *    那比不发这封信更糟。
 *
 * 4. 🔴 **必须说出「这份名单和后台那一页不一样」**。这封信不把 Facebook 私信的
 *    外发算作「联系过」（理由见 `lead-followup-due` 文件头：Meta 的 AI 客服
 *    回复在库里跟真人回复长得一模一样），后台「今天要联系」那一页现在还算。
 *    于是同一个人会在这里出现、在那一页显示「已联系」。两个地方对同一件事
 *    给出相反的结论，如果不明说，看的人只会觉得系统坏了 —— 这正是 2026-09-22
 *    广告看板 D5/O3 踩过的坑。等根子上的修法（写触点时标 `automated`）落地，
 *    这段话和 `isHumanFollowup` 里那条特例一起撤。
 *
 * 发送函数永不抛异常：发信失败不该把上游那趟巡检一起带崩。
 */

import { ME_MAIL_TO_ADDRESS } from '@/lib/email/sender'
import { contactCardTitle } from '@/lib/crm/display-name'
import {
  contactUrl,
  esc,
  humanWait,
  sendDigestMail,
  stripAddress,
  type DigestMailer,
  type DigestSendResult,
} from '@/lib/crm/digest-shared'
import type { LeadDueItem } from './lead-followup-due'

/** 测试期标记。这封信从「只发给 ME」转正时，只改这一处。 */
export const LEAD_DIGEST_TEST_PREFIX = '【测试中】'

export interface LeadDigestExtra {
  /** 窗口内被上限压掉、没列出来的条数。 */
  dropped?: number
  /** 窗口之外、同样没人回的积压人数。 */
  backlog?: number
}

/** @param count 窗口内在等的**总数**（含被压掉的），不是名单长度。 */
export function buildLeadDigestSubject(clientName: string, count: number): string {
  return `${LEAD_DIGEST_TEST_PREFIX}${clientName}：${count} 个客人填了表还没人回`
}

function waitedMs(item: LeadDueItem, now: Date): number {
  const t = Date.parse(item.leadAt)
  if (Number.isNaN(t)) return Number.NaN
  return now.getTime() - t
}

/** 等最久的排最前；时间戳坏掉的排最后（还得看见，但不该占头条）。 */
function byWaitDesc(a: number, b: number): number {
  const av = Number.isFinite(a) ? a : -Infinity
  const bv = Number.isFinite(b) ? b : -Infinity
  return bv - av
}

function renderRow(item: LeadDueItem, index: number, ms: number): string {
  const name = stripAddress(contactCardTitle(item.displayName))
  const interest = item.interest?.trim()
  return `
      <div style="margin:12px 0;padding:12px 14px;background:#f8fafc;border-radius:8px">
        <div style="font-weight:600;color:#0f172a">${index + 1}. ${esc(name)}</div>
        ${
          interest
            ? `<div style="margin-top:4px;font-size:14px;color:#475569">他在表单里选的：${esc(interest)}</div>`
            : '<div style="margin-top:4px;font-size:14px;color:#94a3b8">他没有在表单里选想去哪条线</div>'
        }
        <div style="margin-top:6px;font-size:13px;color:#b45309">填表到现在已经 ${humanWait(ms)}，没有人回过他</div>
        <div style="margin-top:8px;font-size:13px">
          <a href="${contactUrl(item.clientId, item.contactId)}" style="color:#0891b2">→ 打开这位客人的记录（电话和邮箱在里面）</a>
        </div>
      </div>`
}

/** 「名单之外还有几个」。放在名单**末尾**，紧跟着最后一条。 */
function cappedNote(dropped: number): string {
  if (dropped <= 0) return ''
  return `
      <p style="margin:14px 0 0;padding:10px 12px;background:#fff7ed;border:1px solid #fdba74;border-radius:8px;font-size:14px;color:#9a3412">
        另有 <b>${dropped}</b> 个同样没人回的没有列在上面（一封信一次最多列这么多）。
        它们不是不存在 —— 在后台「全部客人」里能看到全部。
      </p>`
}

/** 更早进来、同样没人回的积压。放在最后，跟今天的名单分开说。 */
function backlogNote(backlog: number, windowDays: number): string {
  if (backlog <= 0) return ''
  return `
      <p style="margin:14px 0 0;padding:10px 12px;background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;font-size:14px;color:#991b1b">
        上面只是最近 ${windowDays} 天进来的。更早以前还有 <b>${backlog}</b> 个人同样填了表、
        同样没有人回过 —— 这封信不逐个列，免得看成一堵墙。
        <b>要不要补回这批人，是一次单独的决定，系统不会自己动。</b>
      </p>`
}

/** 🔴 见文件头第 4 条：这份名单跟后台那一页口径不同，必须明说。 */
function calibrationNote(): string {
  return `
      <p style="margin:14px 0 0;font-size:12px;color:#64748b;line-height:1.7">
        <b>为什么这个名单比后台「今天要联系」长</b>：Facebook 私信里那些外发，
        现在分不出是真人回的还是 Meta 的 AI 客服自动回的，所以<b>这封信一律不把私信算成「联系过」</b>。
        宁可多列一个人，也不要把只被机器人回过的客人埋掉。
        如果你确认某个人其实已经有人跟过了，直接回复这封邮件告诉我们，我们照着改判据。
      </p>`
}

/**
 * 正文。第一段固定是测试声明，随后按等待时长从长到短列。
 *
 * `extra` 里那两个数字不是可有可无的补充：少了它们，这封信会把一个
 * **说小了的数字**当成事实报出去（见文件头第 3 条）。
 */
export function buildLeadDigestBody(
  clientName: string,
  items: LeadDueItem[],
  now: Date,
  windowDays: number,
  extra: LeadDigestExtra = {},
): string {
  const dropped = extra.dropped ?? 0
  const backlog = extra.backlog ?? 0
  const rows = items
    .map((item) => ({ item, ms: waitedMs(item, now) }))
    .sort((a, b) => byWaitDesc(a.ms, b.ms))
    .map((r, i) => renderRow(r.item, i, r.ms))
    .join('')

  return `
    <div style="font-family:sans-serif;max-width:620px;margin:0 auto;padding:24px;color:#0f172a">
      <p style="margin:0 0 18px;padding:12px 14px;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;font-size:14px;color:#92400e">
        <b>${LEAD_DIGEST_TEST_PREFIX}</b>这封信来自 Magic Engine 正在测试的新功能：客人在 Facebook 表单里
        留了资料之后，如果一天过去还没有真人回过他，每天早上提醒一次。
        <b>这个功能不会替任何人联系客人</b>，只提醒。
      </p>
      <p style="font-size:16px;font-weight:600;margin:0 0 4px">
        ${esc(clientName)} 有 ${items.length + dropped} 个客人填了表还没人回，等最久的排在最前：
      </p>
      ${rows}
      ${cappedNote(dropped)}
      ${backlogNote(backlog, windowDays)}
      ${calibrationNote()}
      <p style="margin-top:20px;font-size:11px;color:#94a3b8">
        Magic Engine · 测试中的功能，暂不影响现有的工作方式。
      </p>
    </div>`
}

/**
 * 发一封汇总信。永不抛异常。
 *
 * 收件人策略：调用方给了就用调用方的；给空或没给，退回 ME 自己的信箱。
 * 绝不猜客户地址。
 */
export async function sendLeadFollowupDigest(
  clientName: string,
  items: LeadDueItem[],
  options: LeadDigestExtra & {
    recipients?: string[]
    now?: Date
    windowDays?: number
    apiKey?: string
    mailerFactory?: (apiKey: string) => DigestMailer
  } = {},
): Promise<DigestSendResult> {
  const recipients =
    options.recipients && options.recipients.length > 0
      ? options.recipients
      : [ME_MAIL_TO_ADDRESS]

  // 一个都没有就不发。没有「今天很干净」这种信 —— 那种信发几天就没人看了，
  // 真有事的那天也一起被跳过。
  if (items.length === 0) {
    return { sent: false, reason: '没有待跟进的表单线索', recipients }
  }

  const extra: LeadDigestExtra = {
    dropped: options.dropped ?? 0,
    backlog: options.backlog ?? 0,
  }

  return sendDigestMail({
    fromLabel: `${LEAD_DIGEST_TEST_PREFIX}Magic Engine 表单线索提醒`,
    recipients,
    subject: buildLeadDigestSubject(clientName, items.length + (extra.dropped ?? 0)),
    html: buildLeadDigestBody(
      clientName,
      items,
      options.now ?? new Date(),
      options.windowDays ?? 7,
      extra,
    ),
    apiKey: options.apiKey,
    mailerFactory: options.mailerFactory,
  })
}
