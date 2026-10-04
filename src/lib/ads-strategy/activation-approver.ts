/**
 * 「开启一条会真花钱的广告」的授权人名单。
 *
 * ── 为什么名单没配 = 谁都不能批 ────────────────────────────────────────────
 * 这个开关一按下去就开始烧钱。名单没配 / 为空时如果退化成「管理员都能批」，
 * 那任何拿到管理员账号的人都能替客户花钱。宁可功能暂时不能用，也不能让
 * 花钱的口子默认敞开。
 *
 * ── 为什么只做精确相等 ────────────────────────────────────────────────────
 * 名单是邮箱，不是域名、不是通配。`@x.com`、`x.com`、`*` 这类写法一律丢掉，
 * 免得手滑写成通配，把整个域名的人都放进来。比对前两边都 trim + 转小写，
 * 但绝不做前缀 / 后缀 / 子串匹配。
 *
 * 纯函数，不 import 项目内别的模块。
 */

export const APPROVER_ENV_NAME = 'ADS_ACTIVATION_APPROVER_EMAILS'

/** 邮箱必须含 '@' 才算数；名单项和待查邮箱都按这条筛。 */
const hasAt = (s: string): boolean => s.includes('@')

/**
 * 解析名单：按逗号拆；每项 trim + 转小写；丢掉空项；丢掉不含 '@' 的项
 * （防止 '*'、域名、手滑被当成通配）；去重。
 */
export function parseApproverList(raw: string | null | undefined): string[] {
  if (typeof raw !== 'string') return []
  const seen = new Set<string>()
  for (const part of raw.split(',')) {
    const item = part.trim().toLowerCase()
    if (item.length === 0) continue
    if (!hasAt(item)) continue
    seen.add(item)
  }
  return [...seen]
}

/**
 * 这个邮箱在名单里吗。
 *
 * `rawList === undefined` 时才读 `process.env[APPROVER_ENV_NAME]`（在函数内部读，
 * 调用时才读）；传 `null` 或空串表示「没配」。邮箱 trim + 转小写后必须非空且含
 * '@'，且与名单某一项**完全相等**。
 */
export function isApproverEmail(
  email: string | null | undefined,
  rawList?: string | null,
): boolean {
  if (typeof email !== 'string') return false
  const target = email.trim().toLowerCase()
  if (target.length === 0 || !hasAt(target)) return false
  const raw = rawList === undefined ? process.env[APPROVER_ENV_NAME] : rawList
  const list = parseApproverList(raw)
  if (list.length === 0) return false
  return list.includes(target)
}

/** 路由用：在 isApproverEmail 基础上还要求会话邮箱已验证。 */
export function isActivationApprover(
  input: { email: string | null | undefined; emailConfirmed: boolean },
  rawList?: string | null,
): boolean {
  if (input.emailConfirmed !== true) return false
  return isApproverEmail(input.email, rawList)
}
