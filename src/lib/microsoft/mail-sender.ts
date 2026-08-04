/**
 * 这封邮件的对方，算不算一个「客人」。
 *
 * ## 为什么这是接邮件最要紧的一件事
 *
 * 公司邮箱里**大部分邮件不是客人发的**：供应商对账、系统通知、订阅推送、
 * 垃圾邮件、同事之间转发。全都灌进 CRM，销售第二天打开会看到几百个
 * 「noreply@」和「accounts@」躺在今天的名单上 —— 那一页当场作废。
 *
 * 2026-08-02 已经有过一次小规模预演：4 个假冒 Meta 的钓鱼私信被当成了真实
 * 客人，混在「新客人，还没打过」里等着销售去联系。邮箱的量级比私信大得多。
 *
 * ## 判据只有三条，而且都保守
 *
 * 宁可漏判一个真客人（他还会再来一封，而且他仍然出现在这条会话线上），
 * 也不要把一个 `noreply@` 变成 CRM 里的一张卡 —— 前者是少一次便利，
 * 后者是让整页不可信。
 *
 * **这里只判断「要不要建人」，不决定「要不要存这封信」** —— 信照存，
 * 邮箱是完整的；只是不是每封信的发件人都值得成为一个客人。
 */

/**
 * 一看就不是活人的发件人。
 *
 * 用「开头匹配」而不是「包含」：`newsletter@` 要挡，但一个真名叫
 * `Bonnie.Newsletter@…` 的人不该被误伤（真实姓名里出现这些词的概率很低，
 * 但开头匹配几乎不可能误伤）。
 */
const ROBOT_LOCAL_PARTS = [
  'noreply',
  'no-reply',
  'no_reply',
  'donotreply',
  'do-not-reply',
  'mailer-daemon',
  'postmaster',
  'bounce',
  'bounces',
  'notification',
  'notifications',
  'newsletter',
  'automated',
  'auto-reply',
  'autoreply',
  'support+',
  'invoice',
  'invoices',
  'billing',
  'accounts',
  'noreply-',
]

/** 邮件地址拆成 本地部分 / 域名。拆不开就是脏数据。 */
function split(address: string): { local: string; domain: string } | null {
  const a = address.trim().toLowerCase()
  const at = a.lastIndexOf('@')
  if (at <= 0 || at === a.length - 1) return null
  return { local: a.slice(0, at), domain: a.slice(at + 1) }
}

export type SenderVerdict =
  /** 建人 —— 这看起来是个真实的潜在客户。 */
  | { kind: 'customer' }
  /** 不建人，并说清楚为什么（写进记录，将来能回查判错没有）。 */
  | { kind: 'skip'; why: string }

export interface ClassifySenderInput {
  /** 对方的邮件地址。 */
  address: string
  /**
   * 客户自己的邮件域名（比如 `ctstours.co.nz`）。同域来信 = 内部同事，不建人。
   * 不传就不做这项判断 —— 不猜。
   */
  ownDomains?: string[]
}

/**
 * 这个发件人要不要在 CRM 里变成一个人。
 *
 * 纯函数，不碰数据库、不碰网络 —— 判据要能被单测一条条钉住。
 */
export function classifySender(input: ClassifySenderInput): SenderVerdict {
  const parts = split(input.address)
  if (!parts) return { kind: 'skip', why: '地址不成形' }

  const { local, domain } = parts

  // 内部同事之间的邮件。**先判这条** —— 公司自己的 accounts@ 既是内部的
  // 也是机器人，两条都命中时说「是同事」比说「是机器人」更准确。
  const own = (input.ownDomains ?? []).map((d) => d.trim().toLowerCase()).filter(Boolean)
  if (own.includes(domain)) return { kind: 'skip', why: '公司内部邮箱' }

  if (ROBOT_LOCAL_PARTS.some((p) => local.startsWith(p))) {
    return { kind: 'skip', why: '系统发件人（noreply 一类）' }
  }

  // 带 + 号的一次性地址（`someone+shop@gmail.com`）本身是正常人用的，
  // 不拦 —— 拦了会误伤真客人。这里刻意不做更多聪明判断：
  // 判据越复杂，误伤真客人的概率越高，而误伤是不可见的损失。
  return { kind: 'customer' }
}
