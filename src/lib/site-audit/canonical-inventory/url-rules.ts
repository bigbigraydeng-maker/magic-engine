/**
 * Magic Engine 2.0 · canonical URL 归一规则 v1（Issue #930 · WP05 前置）
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 为什么不复用现成的两个「canonical」
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 1. `crawler.ts` 的同源判定：`url.replace(/^(https?:\/\/)www\./,'$1')` 之后
 *    `startsWith(origin)`。两个毛病 ——
 *    (a) 把 www 与裸域强行等同，而 #930 的现场事实是这两个主机下面挂着**不同的站**；
 *    (b) 前缀比较不是主机比较：`https://example.com.evil.com/x` 会被判成同源。
 *
 * 2. `seo-patrol/page-signals.ts#canonicalUrl`：它**故意**合并 bare/www 并丢掉 scheme，
 *    因为它服务的是跨数据源的分析匹配（GSC / SERP / 站内），宽松匹配在那里是对的。
 *    但台账身份要的是**精确**：合并过的串没法唯一定位一个真实页面。
 *    两者目标相反，共用一个函数只会让其中一边悄悄错。
 *
 * 所以这里另起一套**只服务于台账身份**的规则，并且带版本号。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 规则 v1（`inventory-url-rules@1`）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * - scheme 必须是 https；http 直接拒（不替对方假设「反正会跳转」——那属于重定向证据，本轮拿不到）
 * - 主机名与 scheme 小写；主机名必须**精确命中**批准清单
 * - 带用户名/密码 → 拒
 * - 非默认端口 → 拒；`:443` 由 `URL` 自动去掉，留痕
 * - 片段（#…）→ 去掉
 * - 查询参数：只去掉**已知的跟踪参数**，其余按键排序后保留，并留 `query_retained` 标记
 *   （不全删 —— 全删会把 `?id=1` 和 `?id=2` 两个真实页面合并成一条，那是凭空造身份）
 * - 尾斜杠：根路径 `/` 保留，其余去掉
 * - 归一是**幂等**的：canonical 再跑一次规则必须还是自己（有测试盯着）
 */

import type { HostBoundary, NormalisationNote, RejectionReasonCode } from './types'

/**
 * 已知跟踪参数。命中即删。
 *
 * 🔴 只删「确定不改变页面内容」的参数。名单之外的一律保留 ——
 *    保留会多出候选（人能看见并判），误删会把两个页面合并成一个（人看不见）。
 */
export const TRACKING_QUERY_KEYS: readonly string[] = [
  'gclid',
  'dclid',
  'fbclid',
  'msclkid',
  'twclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  '_ga',
  '_gl',
  'ref_src',
]

/** 前缀式跟踪参数（`utm_source` / `utm_campaign` …）。 */
export const TRACKING_QUERY_PREFIXES: readonly string[] = ['utm_']

export class InventoryHostBoundaryError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'InventoryHostBoundaryError'
    this.code = code
  }
}

export type CanonicalisationResult =
  | { readonly ok: true; readonly canonicalUrl: string; readonly notes: readonly NormalisationNote[] }
  | {
      readonly ok: false
      readonly reasonCodes: readonly RejectionReasonCode[]
      readonly notes: readonly NormalisationNote[]
    }

/**
 * 校验并规范化「被批准的主机清单」。
 *
 * 🔴 这是一道安全边界，输入不合规**直接抛**，不做善意修补：
 *    带 scheme / 端口 / 路径 / 通配符 / 前导点的写法一律拒，
 *    否则「批准了什么」这件事就取决于我们怎么猜。
 */
export function normaliseApprovedHosts(hosts: readonly string[]): readonly string[] {
  if (hosts.length === 0) {
    throw new InventoryHostBoundaryError('empty_host_allowlist', '批准主机清单为空 —— 没有边界就不许生成计划')
  }
  const out: string[] = []
  for (const raw of hosts) {
    const host = raw.trim().toLowerCase()
    if (host.length === 0) {
      throw new InventoryHostBoundaryError('blank_host', '批准主机清单里有空字符串')
    }
    if (/[:/\\?#@*]/.test(host) || host.startsWith('.') || host.endsWith('.')) {
      throw new InventoryHostBoundaryError(
        'malformed_host',
        `批准主机必须是纯主机名（不带 scheme / 端口 / 路径 / 通配符 / 前后点）：${raw}`,
      )
    }
    // `new URL` 是唯一可信的解析器；用它验一次主机名本身是否合法。
    let parsed: URL
    try {
      parsed = new URL(`https://${host}`)
    } catch {
      throw new InventoryHostBoundaryError('malformed_host', `批准主机解析不了：${raw}`)
    }
    if (parsed.hostname !== host) {
      throw new InventoryHostBoundaryError('malformed_host', `批准主机不是规范主机名：${raw}`)
    }
    if (!out.includes(host)) out.push(host)
  }
  return out
}

/** 主机是否被精确批准。**不是**前缀比较，也不做 www 等价。 */
export function isApprovedHost(hostname: string, approvedHosts: readonly string[]): boolean {
  const host = hostname.toLowerCase()
  return approvedHosts.some((approved) => approved === host)
}

/**
 * 把一个原始 URL 归一成台账 canonical URL。
 *
 * 过不去就返回 `ok: false` + 原因码；**绝不返回一个「差不多」的串**。
 */
export function canonicaliseUrl(raw: string, boundary: Pick<HostBoundary, 'approvedHosts'>): CanonicalisationResult {
  const approvedHosts = boundary.approvedHosts
  const input = raw.trim()
  if (input.length === 0) return { ok: false, reasonCodes: ['malformed_url'], notes: [] }

  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    return { ok: false, reasonCodes: ['malformed_url'], notes: [] }
  }

  const notes: NormalisationNote[] = []
  const authority = input.slice(0, indexOfAuthorityEnd(input))
  if (/[A-Z]/.test(input.slice(0, Math.max(input.indexOf('://'), 0)))) notes.push('scheme_lowercased')
  if (/[A-Z]/.test(authority.replace(/^[^:]*:\/\//, ''))) notes.push('host_lowercased')

  const schemeFailure = checkScheme(parsed)
  if (schemeFailure) return { ok: false, reasonCodes: [schemeFailure], notes }

  if (parsed.username.length > 0 || parsed.password.length > 0) {
    return { ok: false, reasonCodes: ['credentials_present'], notes }
  }
  // `URL` 会把 https 的 `:443` 归一掉（`parsed.port === ''`），所以只在原串里能看见它。
  if (/:443(?:[/?#]|$)/.test(authority)) notes.push('default_port_removed')
  if (parsed.port.length > 0) return { ok: false, reasonCodes: ['non_default_port'], notes }

  if (!isApprovedHost(parsed.hostname, approvedHosts)) {
    return { ok: false, reasonCodes: ['host_not_approved'], notes }
  }

  if (parsed.hash.length > 0) notes.push('fragment_removed')

  const query = normaliseQuery(parsed.searchParams)
  notes.push(...query.notes)

  // 🔴 百分号转义的十六进制**本身不区分大小写**：`/a%2Fb` 与 `/a%2fb` 是同一个资源，
  //    但 WHATWG URL 会原样保留两种写法。直接拼接就会给同一个页面生成两个 canonical，
  //    撞车检测也就看不见它们 —— 复核的人会同时接受，台账里出现两条同一页面的身份。
  //    统一成大写（RFC 3986 推荐的写法）。
  let path = parsed.pathname.replace(/%([0-9a-fA-F]{2})/g, (_m, hex: string) => `%${hex.toUpperCase()}`)
  if (path.length > 1 && path.endsWith('/')) {
    path = path.replace(/\/+$/, '')
    notes.push('trailing_slash_removed')
  }

  return { ok: true, canonicalUrl: `https://${parsed.hostname}${path}${query.search}`, notes }
}

/**
 * 从原始 URL 重新推导 canonical URL；推不出来就是 `null`。
 *
 * 🔴 计划与激活两处都拿它**重算一遍**，再跟计划里记着的 canonical 逐字比对。
 *    只验「这个串本身是不是规范的」不够 —— 把某条候选的 canonical 从 `/a` 改成
 *    同一主机下的 `/hacked`，那个串自己完全规范，但它已经不是这条候选推导出来的东西了；
 *    照批就会抓取并写入一个**没有人复核过**的页面。
 */
export function deriveCanonicalUrl(
  originalUrl: string,
  boundary: Pick<HostBoundary, 'approvedHosts'>,
): string | null {
  const result = canonicaliseUrl(originalUrl, boundary)
  return result.ok ? result.canonicalUrl : null
}

// ---------------------------------------------------------------------------
// 私有
// ---------------------------------------------------------------------------

function checkScheme(parsed: URL): RejectionReasonCode | null {
  if (parsed.protocol === 'https:') return null
  if (parsed.protocol === 'http:') return 'insecure_scheme'
  return 'unsupported_scheme'
}

/** 找到 authority 段（`scheme://host[:port]`）的结束位置，用于在**原始串**上判大小写与 `:443`。 */
function indexOfAuthorityEnd(input: string): number {
  const schemeEnd = input.indexOf('://')
  if (schemeEnd < 0) return input.length
  const rest = input.slice(schemeEnd + 3)
  const stop = rest.search(/[/?#]/)
  return stop < 0 ? input.length : schemeEnd + 3 + stop
}

function isTrackingKey(key: string): boolean {
  const lower = key.toLowerCase()
  return (
    TRACKING_QUERY_KEYS.includes(lower) || TRACKING_QUERY_PREFIXES.some((prefix) => lower.startsWith(prefix))
  )
}

/**
 * 查询串归一：删已知跟踪参数 → 其余**只按 key 排序**（稳定排序）。
 *
 * 排序是为了确定性：`?b=1&a=2` 与 `?a=2&b=1` 是同一个页面，不排序会留下两条候选。
 *
 * 🔴 同名参数之间**保持原始先后**，不按值排。有些站点用重复参数表达顺序或优先级
 *    （`?sort=price&sort=date` 与 `?sort=date&sort=price` 可能是两个不同的页面）。
 *    按值排会把它们合并成一条，另一条被标成撞车 —— 复核的人从此没机会分别接受它们，
 *    而这正是「不许凭空合并页面身份」那条原则的反面。
 */
function normaliseQuery(params: URLSearchParams): { search: string; notes: NormalisationNote[] } {
  const notes: NormalisationNote[] = []
  const kept: [string, string][] = []
  let removedTracking = false

  params.forEach((value, key) => {
    if (isTrackingKey(key)) {
      removedTracking = true
      return
    }
    kept.push([key, value])
  })
  if (removedTracking) notes.push('tracking_query_removed')
  if (kept.length === 0) return { search: '', notes }

  // Array.prototype.sort 在现代 JS 里是稳定排序：只按 key 比，同名参数就保住原始先后。
  const sorted = [...kept].sort((a, b) => compare(a[0], b[0]))
  if (sorted.some((pair, i) => pair !== kept[i])) notes.push('query_sorted')
  notes.push('query_retained')

  const search = sorted.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
  return { search: `?${search}`, notes }
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
