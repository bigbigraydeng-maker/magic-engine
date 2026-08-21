import { getConnection } from '@/lib/cms/connection-store'
import { GithubClient } from '@/lib/cms/github-client'
import { getSitePageForClient } from '@/lib/db/site-pages'
import {
  buildSlugIndex,
  CTS_CLIENT_ID,
  inspectCtsIntentForSlug,
} from '@/lib/seo-meta/cts-meta-source'

const CTS_SOURCE: unique symbol = Symbol('tenant_bound_cts_github_source')
const trustedSources = new WeakSet<object>()
const DATA_DIR = 'src/lib/data'
const DATA_FILE = /^(seo-pages|blogs)[^/]*\.ts$/

export interface TenantBoundCtsGithubSource {
  readonly [CTS_SOURCE]: 'tenant_bound_cts_github_source'
  readonly clientId: typeof CTS_CLIENT_ID
  readonly pageLedgerRef: string
  readonly targetPageUrl: string
  readonly entrySlug: string
  readonly repoOwner: string
  readonly repoName: string
  readonly defaultBranch: string
  readonly contentPath: string
  readonly versionToken: string
  readonly rawContent: string
  readonly current: {
    readonly title: string
    readonly description: string
    readonly h1: string
    readonly descriptionField: 'description' | 'excerpt'
  }
  readonly observedAt: string
  readonly provenance: {
    readonly clientSource: string
    readonly pageLedgerSource: string
    readonly connectionSource: string
    readonly providerSource: string
  }
}

export type LoadCtsGithubSourceResult =
  | { readonly ok: true; readonly source: TenantBoundCtsGithubSource }
  | {
      readonly ok: false
      readonly reason:
        | 'invalid_identity'
        | 'ledger_page_not_found'
        | 'target_slug_invalid'
        | 'connection_not_ready'
        | 'provider_read_failed'
        | 'target_source_not_found'
        | 'source_entry_invalid'
    }

export function isTenantBoundCtsGithubSource(
  value: unknown,
): value is TenantBoundCtsGithubSource {
  return value !== null && typeof value === 'object' && trustedSources.has(value)
}

function slugFromPageUrl(value: string): string | null {
  try {
    const parts = decodeURIComponent(new URL(value).pathname).split('/').filter(Boolean)
    const slug = parts.at(-1) ?? ''
    return /^[a-z0-9][a-z0-9-]*$/.test(slug) ? slug : null
  } catch {
    return null
  }
}

export async function loadTenantBoundCtsGithubSource(
  input: { readonly clientId: string; readonly pageId: string },
): Promise<LoadCtsGithubSourceResult> {
  if (input.clientId !== CTS_CLIENT_ID || !input.pageId.trim()) {
    return { ok: false, reason: 'invalid_identity' }
  }
  const page = await getSitePageForClient(input.clientId, input.pageId)
  if (!page || page.client_id !== CTS_CLIENT_ID) {
    return { ok: false, reason: 'ledger_page_not_found' }
  }
  const entrySlug = slugFromPageUrl(page.url)
  if (!entrySlug) return { ok: false, reason: 'target_slug_invalid' }

  const connection = await getConnection(input.clientId)
  if (
    !connection || connection.provider !== 'github' || !connection.connected ||
    connection.status !== 'connected' || !connection.repoOwner.trim() ||
    !connection.repoName.trim() || !connection.branch.trim()
  ) return { ok: false, reason: 'connection_not_ready' }

  try {
    const client = new GithubClient(connection.plainToken)
    const directory = await client.listDirectory(
      connection.repoOwner,
      connection.repoName,
      DATA_DIR,
      connection.branch,
    )
    const eligible = directory.filter(
      (entry) => entry.type === 'file' && DATA_FILE.test(entry.name) &&
        entry.path === `${DATA_DIR}/${entry.name}`,
    )
    const files = await Promise.all(eligible.map(async (entry) => {
      const file = await client.getFileContent(
        connection.repoOwner,
        connection.repoName,
        entry.path,
        connection.branch,
      )
      return { path: entry.path, source: file.decodedContent, sha: file.sha }
    }))
    const contentPath = buildSlugIndex(files).get(entrySlug)
    if (!contentPath) return { ok: false, reason: 'target_source_not_found' }
    const file = files.find((candidate) => candidate.path === contentPath)
    if (!file) return { ok: false, reason: 'target_source_not_found' }
    const current = inspectCtsIntentForSlug(file.source, entrySlug)
    if (!current || !file.sha.trim()) return { ok: false, reason: 'source_entry_invalid' }

    const observedAt = new Date().toISOString()
    const source: TenantBoundCtsGithubSource = Object.freeze({
      [CTS_SOURCE]: 'tenant_bound_cts_github_source' as const,
      clientId: CTS_CLIENT_ID,
      pageLedgerRef: `client_site_pages:${page.id}`,
      targetPageUrl: page.url,
      entrySlug,
      repoOwner: connection.repoOwner,
      repoName: connection.repoName,
      defaultBranch: connection.branch,
      contentPath,
      versionToken: file.sha,
      rawContent: file.source,
      current: Object.freeze({
        title: current.title,
        description: current.description,
        h1: current.h1,
        descriptionField: current.descriptionField,
      }),
      observedAt,
      provenance: Object.freeze({
        clientSource: `clients:${CTS_CLIENT_ID}`,
        pageLedgerSource: `client_site_pages:${page.id}`,
        connectionSource: `cms_connections:${CTS_CLIENT_ID}:github`,
        providerSource: `github:${connection.repoOwner}/${connection.repoName}:${contentPath}@${file.sha}`,
      }),
    })
    trustedSources.add(source)
    return { ok: true, source }
  } catch {
    return { ok: false, reason: 'provider_read_failed' }
  }
}
