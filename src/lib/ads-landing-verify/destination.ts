/**
 * Where a paused ad says it will send the person.
 * A lead-form ad is the form. Anything else with a link is a web page.
 * No address is left blank. Nothing here is filled in.
 */

import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'
import { isProbeUrlAllowed } from '@/lib/ads-tracking-preflight/landing-probe'

const DRAFT_RE = /^[a-z0-9][a-z0-9_-]{0,64}$/
const TAG_RE = /^[A-Za-z0-9_.=&%-]{1,200}$/

export type DestinationKind = 'page' | 'lead_form' | 'missing'

export interface Destination {
  readonly kind: DestinationKind
  readonly linkUrl: string | null
  readonly urlTags: string | null
  readonly tagsConflict: boolean
  readonly accountLabel: string | null
}

export type RequestTarget =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: 'bad_url' | 'bad_tags' | 'off_site' | 'no_site' }

export function landingSubjectKey(draftId: string): string | null {
  const id = draftId.trim().toLowerCase()
  if (!DRAFT_RE.test(id)) return null
  return `landing-verify:${id}`
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function tagsFromSets(draft: Record<string, unknown>): { tags: string | null; conflict: boolean } {
  if (!Array.isArray(draft.adSets)) return { tags: null, conflict: false }
  const found = new Set<string>()
  for (const set of draft.adSets) {
    if (!set || typeof set !== 'object' || Array.isArray(set)) continue
    const tags = text((set as Record<string, unknown>).urlTags)
    if (tags) found.add(tags)
  }
  if (found.size > 1) return { tags: null, conflict: true }
  const only = [...found]
  return { tags: only.length === 1 ? only[0] : null, conflict: false }
}

export function readDestination(payload: unknown): Destination | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const row = payload as Record<string, unknown>
  const draft = row.draft
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return null
  const body = draft as Record<string, unknown>
  const linkUrl = text(body.linkUrl)
  const rootTags = text(body.urlTags)
  const fromSets = tagsFromSets(body)
  const leadForm = body.kind === 'lead_form' || (!linkUrl && text(body.leadFormId) !== null)
  const kind: DestinationKind = leadForm ? 'lead_form' : linkUrl ? 'page' : 'missing'
  return {
    kind,
    linkUrl,
    urlTags: rootTags ?? fromSets.tags,
    tagsConflict: rootTags ? false : fromSets.conflict,
    accountLabel: text(row.accountLabel),
  }
}

export function destinationKey(dest: Destination): string {
  return canonicalHashOfInput({
    kind: dest.kind,
    linkUrl: dest.linkUrl,
    urlTags: dest.urlTags,
    tagsConflict: dest.tagsConflict,
  })
}

function withTags(link: string, urlTags: string | null): string | null {
  let url: URL
  try {
    url = new URL(link)
  } catch {
    return null
  }
  if (!urlTags) return url.toString()
  const extra = new URLSearchParams(urlTags)
  extra.forEach((value, key) => {
    if (!url.searchParams.has(key)) url.searchParams.append(key, value)
  })
  return url.toString()
}

/** The address we would open. Off-site and unreadable tags are refused before any request. */
export function requestTarget(dest: Destination, siteUrl: string | null): RequestTarget {
  if (dest.tagsConflict || (dest.urlTags !== null && !TAG_RE.test(dest.urlTags))) {
    return { ok: false, reason: 'bad_tags' }
  }
  if (!siteUrl) return { ok: false, reason: 'no_site' }
  if (!dest.linkUrl) return { ok: false, reason: 'bad_url' }
  const url = withTags(dest.linkUrl, dest.urlTags)
  if (!url) return { ok: false, reason: 'bad_url' }
  if (!isProbeUrlAllowed(url, siteUrl)) return { ok: false, reason: 'off_site' }
  return { ok: true, url }
}
