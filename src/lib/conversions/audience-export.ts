/**
 * 把 CRM 联系人筛成一份能传 Meta「客户名单」(Custom Audience) 的 CSV（Issue #1397）。
 *
 * 纯函数，不碰数据库、不发网络。路由层负责鉴权、读库、下载响应。
 *
 * ────────────────────────────────────────────────────────────────────────
 * 名单 A 的口径（子牙 + 魏征 2026-09-06 复审定死）
 * ────────────────────────────────────────────────────────────────────────
 *
 * 只放同时满足这四条的人：
 *   1. **retail**（终端客户/游客）—— 用既有 contactKindOf 分类，天然剔掉 agent(trade) 与员工(staff)。
 *      把 agent 放进 lookalike 种子会让 Meta 去找更多旅行社，不是游客。
 *   2. **有同意** —— 来源是 Meta 广告（attr_platform='meta' 或有 attr_ad_id）。
 *      那句同意声明在 CTS 的广告线索表单上；没走过广告的人不在覆盖内。
 *   3. **未拒联** —— 走 isDoNotContact（真相源是不可变触点，不是 contacts 那一列）。
 *   4. **有匹配键** —— 至少一个 email 或 phone，否则 Meta 100% 匹配不上。
 *
 * 🔴 这份 CSV 是明文 email/phone —— Meta 上传时才哈希，明文是任务的必然产物。
 *    所以它只能经"系统 → 授权管理员的浏览器下载"这一条路，不落地到别处。
 */

import { normalizePhone, normalizeName } from '@/lib/pii/normalize'

export type ContactKind = 'staff' | 'trade' | 'retail'

/** 已经过 DNC 判据、已算好 kind 的联系人。上游负责把这些算好。 */
export type AudienceContact = {
  displayName: string | null
  email: string | null
  phone: string | null
  kind: ContactKind
  /** 是否来自广告（attr_platform==='meta' 或有 attr_ad_id）。 */
  fromAd: boolean
  /** isDoNotContact 的结果（真相源触点，不是 contacts 那一列）。 */
  doNotContact: boolean
}

export type AudienceRow = {
  email: string
  phone: string
  fn: string
  ln: string
  country: string
}

export type AudienceResult = {
  rows: AudienceRow[]
  /** 说清为什么是这个数：每一条被排除的理由都数出来，方便核对，也方便 PM 知道池子怎么缩的。 */
  stats: {
    total: number
    kept: number
    excluded_not_retail: number
    excluded_no_consent: number
    excluded_dnc: number
    excluded_no_key: number
    with_email: number
    with_phone: number
  }
}

function splitName(displayName: string | null): { fn: string; ln: string } {
  const dn = displayName?.trim()
  if (!dn) return { fn: '', ln: '' }
  const parts = dn.split(/\s+/)
  if (parts.length < 2) return { fn: parts[0] ?? '', ln: '' }
  return { fn: parts[0], ln: parts.slice(1).join(' ') }
}

/**
 * 筛出名单 A。
 * @param defaultPhoneCountry clients.default_phone_country（'64'）—— 电话转国际格式用。
 */
export function buildMetaAudienceA(
  contacts: readonly AudienceContact[],
  defaultPhoneCountry: string | null,
): AudienceResult {
  const stats: AudienceResult['stats'] = {
    total: contacts.length,
    kept: 0,
    excluded_not_retail: 0,
    excluded_no_consent: 0,
    excluded_dnc: 0,
    excluded_no_key: 0,
    with_email: 0,
    with_phone: 0,
  }
  const rows: AudienceRow[] = []

  for (const c of contacts) {
    // 顺序即优先级：先按最该拦的理由归类，一条只数一次。
    if (c.kind !== 'retail') {
      stats.excluded_not_retail++
      continue
    }
    if (c.doNotContact) {
      stats.excluded_dnc++
      continue
    }
    if (!c.fromAd) {
      stats.excluded_no_consent++
      continue
    }

    const email = c.email ? c.email.trim().toLowerCase() : ''
    const phone = normalizePhone(c.phone, defaultPhoneCountry) ?? ''
    if (!email && !phone) {
      stats.excluded_no_key++
      continue
    }

    const { fn, ln } = splitName(c.displayName)
    rows.push({
      email,
      phone,
      fn: normalizeName(fn) ?? '',
      ln: normalizeName(ln) ?? '',
      country: 'nz',
    })
    stats.kept++
    if (email) stats.with_email++
    if (phone) stats.with_phone++
  }

  return { rows, stats }
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/**
 * Meta 客户名单 CSV。列名用 Meta 上传向导认得的标准 schema。
 * Meta 上传时自己哈希，所以这里是明文。
 */
export function audienceToCsv(rows: readonly AudienceRow[]): string {
  const header = ['email', 'phone', 'fn', 'ln', 'country']
  const lines = [header.join(',')]
  for (const r of rows) {
    lines.push([r.email, r.phone, r.fn, r.ln, r.country].map(csvCell).join(','))
  }
  return lines.join('\n') + '\n'
}
