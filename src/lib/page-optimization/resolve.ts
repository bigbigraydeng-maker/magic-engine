/**
 * resolve —— 把「哪一页」变成一个规范身份（Issue #878 / WP06）。
 *
 * 产出两样不同的东西，刻意分开（Page 契约 §3.1）：
 *   · 路由决策——直接复用 `resolvePageUpgradeExecution`，不重新发明。
 *   · 规范页面身份——Roman 没有页面台账，本模块不建注册表、不假设 CMS，
 *     只用「域名归属判定 + URL 规范化」这种确定性规则；解析不出来就显式
 *     unknown，不许猜。
 *
 * 两段都是纯函数、输入固定则确定性——不发网络请求。
 */

import { resolvePageUpgradeExecution } from '@/lib/cms/page-upgrade-plan'
import type { PageUpgradeExecutionPlan, PageUpgradeProviders } from '@/lib/cms/page-upgrade-plan'
import { judgeDomainOwnership, bareHost } from '@/lib/clients/domain-match'
import type { PageCanonicalIdentity, PageResolution } from './types'

/** 路由决策——原样转发，不改既有函数的任何行为。 */
export function resolveRouting(
  pageUrl: string,
  providers: PageUpgradeProviders,
): PageUpgradeExecutionPlan {
  return resolvePageUpgradeExecution(pageUrl, providers)
}

/**
 * 规范页面身份。
 *
 * 三态判据（复用全仓唯一一份域名归属实现）：owned → 产出规范身份；
 * foreign / unknown → 显式 `known:false`，不许把「判断不了」读成「是」。
 */
export function resolveCanonicalIdentity(
  pageUrl: string,
  clientDomain: string | null,
): PageCanonicalIdentity {
  const verdict = judgeDomainOwnership(pageUrl, clientDomain)
  if (verdict !== 'owned') {
    return { known: false, reason: 'source_ambiguous' }
  }

  const domain = bareHost(clientDomain)
  const normalizedPath = normalizePagePath(pageUrl)
  if (!domain || normalizedPath === null) {
    return { known: false, reason: 'source_ambiguous' }
  }

  return { known: true, value: { domain, normalizedPath } }
}

/** 去 query/fragment/trailing slash——确定性规范化，不查任何表。 */
function normalizePagePath(pageUrl: string): string | null {
  try {
    const parsed = new URL(pageUrl)
    const trimmed = parsed.pathname.replace(/\/+$/, '')
    return trimmed === '' ? '/' : trimmed
  } catch {
    return null
  }
}

export interface ResolvePageInput {
  readonly pageUrl: string
  readonly clientDomain: string | null
  readonly providers: PageUpgradeProviders
}

/** 组合两段，仍然是纯函数——不许因为组合了就悄悄发起 I/O。 */
export function resolvePage(input: ResolvePageInput): PageResolution {
  return {
    routing: resolveRouting(input.pageUrl, input.providers),
    canonicalIdentity: resolveCanonicalIdentity(input.pageUrl, input.clientDomain),
  }
}
