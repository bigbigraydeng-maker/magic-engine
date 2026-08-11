/**
 * 「这个网址属于这个客户吗」—— **全仓唯一一份实现**。
 *
 * 🔴 为什么必须只有一份（2026-08-05 实测）：
 *    这个判断先写了两份（`cms/retest.ts` 一份、`clients/cross-client-audit.ts` 一份），
 *    **写完当天就已经不一致** —— 一份会剥 `sc-domain:` 前缀，另一份不会。
 *    而生产 `gsc_performance_snapshots.site_url` 存的正是 `sc-domain:ctstours.co.nz`。
 *    同一行记录，闸门那份判「串台」，排查那份判「自己家」。
 *    副本必然漂移，所以这里是唯一入口，两边都 import 它。
 */

/**
 * 这些后缀本身不是任何人的域名。
 *
 * `clients.domain` 是自由文本、没有校验（生产里就有一条写成 `smiledental.co.nz/zh`）。
 * 万一填成 `co.nz`，`endsWith('.co.nz')` 会让**整个新西兰的域名**都算「自己家」。
 * 与其猜，不如判「判断不了」并报出来让人填对。
 */
const PUBLIC_SUFFIXES = new Set([
  'co.nz', 'net.nz', 'org.nz', 'govt.nz', 'ac.nz', 'school.nz',
  'com.au', 'net.au', 'org.au', 'gov.au', 'edu.au', 'id.au',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk',
  'com', 'net', 'org', 'io', 'ai', 'app', 'dev', 'co',
])

export type DomainVerdict =
  /** 确实是这个客户自己的 */
  | 'owned'
  /** 确实不是 —— 红线 */
  | 'foreign'
  /**
   * 判断不了。**不等于安全**：调用方必须自己决定要不要放行，
   * 并且要把「判断不了」这件事本身报出去，而不是当成没问题。
   */
  | 'unknown'

/** 取出裸主机名。解析不出来返回 null —— 调用方不许把 null 当成「没问题」。 */
export function bareHost(v: string | null | undefined): string | null {
  if (!v) return null
  const s = v.trim().toLowerCase()
  if (!s) return null

  // 协议五花八门（含 sc-domain: 这种 Search Console 自己的写法），统一剥掉
  const withoutScheme = s.replace(/^sc-domain:/, '').replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  // `user@host` 形式里真正的主机在 @ 之后 —— 不剥的话 evil.com 会被当成路径
  const afterAuth = withoutScheme.includes('@')
    ? withoutScheme.slice(withoutScheme.lastIndexOf('@') + 1)
    : withoutScheme
  const host = afterAuth.split(/[/\\?#]/)[0].split(':')[0].replace(/\.$/, '')

  // 只认「至少两段、全是域名合法字符」的东西。空串、`//evil.com` 剥完剩空、
  // IP、含空白或控制字符的，一律返回 null（= 判断不了 = 不许当成放行）
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null
  return host.replace(/^www\./, '')
}

/**
 * 判断一个网址属不属于这个客户。
 *
 * 三态，不是布尔 —— **「判断不了」必须跟「是」区分开**。写成布尔的那一版里，
 * 判断不了返回 null，调用方写 `!== false` 就当成放行了，
 * 于是域名为空的客户（生产里有 2 个）完全不设防。
 */
export function judgeDomainOwnership(
  stored: string | null | undefined,
  clientDomain: string | null | undefined,
): DomainVerdict {
  const target = bareHost(stored)
  const own = bareHost(clientDomain)

  if (!own) return 'unknown'          // 客户没填域名 / 填得没法解析
  if (PUBLIC_SUFFIXES.has(own)) return 'unknown'  // 填成了公共后缀，量谁都「像自己」
  if (!target) return 'unknown'       // 存的值解析不出主机名

  return target === own || target.endsWith(`.${own}`) ? 'owned' : 'foreign'
}
