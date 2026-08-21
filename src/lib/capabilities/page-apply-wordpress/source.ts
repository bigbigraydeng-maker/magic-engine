import { judgeDomainOwnership } from '@/lib/clients/domain-match'
import { getWordpressConnection } from '@/lib/cms/connection-store'
import {
  getExistingWordpressPost,
  probeWordpressAtomicPageApply,
} from '@/lib/cms/wordpress-client'
import { getSitePageForClient } from '@/lib/db/site-pages'
import type { WordpressPageSnapshot } from '@/lib/page-optimization'

const TENANT_BOUND_WORDPRESS_SOURCE: unique symbol = Symbol('tenant_bound_wordpress_source')
const boundSources = new WeakSet<object>()

export interface TenantBoundWordpressSource {
  readonly [TENANT_BOUND_WORDPRESS_SOURCE]: 'tenant_bound_wordpress_source'
  readonly clientId: string
  readonly targetPageUrl: string
  readonly pageLedgerRef: string
  readonly postId: number
  readonly postType: 'post' | 'page'
  readonly snapshot: WordpressPageSnapshot
  readonly provenance: {
    readonly clientSource: string
    readonly pageLedgerSource: string
    readonly connectionSource: string
    readonly postSource: string
  }
}

export interface LoadTenantBoundWordpressSourceInput {
  readonly clientId: string
  readonly pageId: string
  readonly postId: number
  readonly postType: 'post' | 'page'
}

export type LoadTenantBoundWordpressSourceResult =
  | { readonly ok: true; readonly source: TenantBoundWordpressSource }
  | {
      readonly ok: false
      readonly reason:
        | 'invalid_identity'
        | 'ledger_page_not_found'
        | 'connection_not_ready'
        | 'connection_domain_mismatch'
        | 'atomic_apply_unavailable'
        | 'wordpress_post_mismatch'
        | 'snapshot_invalid'
    }

function normalizedUrl(value: string): string | null {
  try {
    const url = new URL(value)
    url.hash = ''
    url.search = ''
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    return url.toString().replace(/\/$/, url.pathname === '/' ? '/' : '')
  } catch {
    return null
  }
}

export function isTenantBoundWordpressSource(value: unknown): value is TenantBoundWordpressSource {
  return value !== null && typeof value === 'object' && boundSources.has(value)
}

/**
 * The only production mint for a WordPress source. Facts are loaded here from
 * the tenant-filtered ledger, credential store, and live provider; callers pass
 * identifiers only and cannot supply ledger/connection/post/provenance values.
 */
export async function loadTenantBoundWordpressSource(
  input: LoadTenantBoundWordpressSourceInput,
): Promise<LoadTenantBoundWordpressSourceResult> {
  if (
    !input.clientId.trim() || !input.pageId.trim() ||
    !Number.isInteger(input.postId) || input.postId <= 0 ||
    (input.postType !== 'post' && input.postType !== 'page')
  ) return { ok: false, reason: 'invalid_identity' }

  const ledgerPage = await getSitePageForClient(input.clientId, input.pageId)
  if (!ledgerPage || ledgerPage.client_id !== input.clientId) {
    return { ok: false, reason: 'ledger_page_not_found' }
  }
  const connection = await getWordpressConnection(input.clientId)
  if (!connection || connection.status !== 'connected' || !connection.yoastPluginInstalled) {
    return { ok: false, reason: 'connection_not_ready' }
  }
  if (judgeDomainOwnership(connection.siteUrl, ledgerPage.url) !== 'owned') {
    return { ok: false, reason: 'connection_domain_mismatch' }
  }
  const config = {
    siteUrl: connection.siteUrl,
    username: connection.username,
    appPassword: connection.plainAppPassword,
  }
  if (!await probeWordpressAtomicPageApply(config)) {
    return { ok: false, reason: 'atomic_apply_unavailable' }
  }
  const post = await getExistingWordpressPost(config, input.postId, input.postType)
  const target = normalizedUrl(ledgerPage.url)
  if (
    !target || post.postId !== input.postId || post.postType !== input.postType ||
    post.status !== 'publish' || normalizedUrl(post.link) !== target
  ) return { ok: false, reason: 'wordpress_post_mismatch' }
  if (!post.modified.trim() || Number.isNaN(Date.parse(post.modified))) {
    return { ok: false, reason: 'snapshot_invalid' }
  }

  const observedAt = new Date().toISOString()
  const snapshot: WordpressPageSnapshot = Object.freeze({
    ok: true,
    provider: 'wordpress',
    fetchedAt: observedAt,
    rawFields: Object.freeze({
      title: post.title,
      content: post.content,
      seoTitle: post.seoTitle ?? '',
      seoDescription: post.seoDescription ?? '',
    }),
    versionToken: post.modified,
  })
  const source: TenantBoundWordpressSource = Object.freeze({
    [TENANT_BOUND_WORDPRESS_SOURCE]: 'tenant_bound_wordpress_source' as const,
    clientId: input.clientId,
    targetPageUrl: ledgerPage.url,
    pageLedgerRef: `client_site_pages:${ledgerPage.id}`,
    postId: post.postId,
    postType: post.postType,
    snapshot,
    provenance: Object.freeze({
      clientSource: `clients:${input.clientId}`,
      pageLedgerSource: `client_site_pages:${ledgerPage.id}`,
      connectionSource: `cms_connections:${input.clientId}:wordpress`,
      postSource: `wordpress:${post.postType}:${post.postId}@${post.modified}`,
    }),
  })
  boundSources.add(source)
  return { ok: true, source }
}
