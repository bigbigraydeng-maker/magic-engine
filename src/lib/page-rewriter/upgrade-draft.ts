/**
 * Short-lived browser handoff between the AI page-upgrade screen and the
 * existing WordPress Page Rewriter.
 *
 * The generated body can be too large for a query string, so the upgrade
 * screen stores this validated envelope in sessionStorage and passes only
 * the storage key. The rewriter still performs a fresh WordPress lookup and
 * requires the FDE to review the diff before publishing.
 */

export const PAGE_UPGRADE_DRAFT_VERSION = 1
export const PAGE_UPGRADE_DRAFT_TTL_MS = 4 * 60 * 60 * 1000

const MAX_TEXT_LENGTH = 10_000
const MAX_HTML_LENGTH = 2_000_000

export interface PageUpgradeDraft {
  version: typeof PAGE_UPGRADE_DRAFT_VERSION
  clientId: string
  pageId: string
  sourceUrl: string
  enhancedTitle: string
  enhancedMetaTitle: string
  enhancedMetaDescription: string
  enhancedHtmlBody: string
  createdAt: number
}

export interface CreatePageUpgradeDraftInput {
  clientId: string
  pageId: string
  sourceUrl: string
  enhancedTitle: string
  enhancedMetaTitle: string
  enhancedMetaDescription: string
  enhancedHtmlBody: string
  createdAt?: number
}

export function buildPageUpgradeDraftStorageKey(
  clientId: string,
  pageId: string,
  createdAt = Date.now(),
): string {
  return `me:page-upgrade:v1:${encodeURIComponent(clientId)}:${encodeURIComponent(pageId)}:${createdAt}`
}

export function createPageUpgradeDraft(input: CreatePageUpgradeDraftInput): PageUpgradeDraft {
  return {
    version: PAGE_UPGRADE_DRAFT_VERSION,
    clientId: input.clientId,
    pageId: input.pageId,
    sourceUrl: input.sourceUrl,
    enhancedTitle: input.enhancedTitle,
    enhancedMetaTitle: input.enhancedMetaTitle,
    enhancedMetaDescription: input.enhancedMetaDescription,
    enhancedHtmlBody: input.enhancedHtmlBody,
    createdAt: input.createdAt ?? Date.now(),
  }
}

export function parsePageUpgradeDraft(
  raw: string | null,
  expectedClientId: string,
  expectedSourceUrl: string,
  now = Date.now(),
): PageUpgradeDraft | null {
  if (!raw) return null

  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }

  if (!isRecord(value)) return null
  if (value.version !== PAGE_UPGRADE_DRAFT_VERSION) return null
  if (value.clientId !== expectedClientId) return null
  if (!samePageUrl(value.sourceUrl, expectedSourceUrl)) return null
  if (!isSafeText(value.pageId) || !isSafeText(value.enhancedTitle)) return null
  if (!isSafeText(value.enhancedMetaTitle, true)) return null
  if (!isSafeText(value.enhancedMetaDescription, true)) return null
  if (typeof value.enhancedHtmlBody !== 'string' || value.enhancedHtmlBody.length === 0 || value.enhancedHtmlBody.length > MAX_HTML_LENGTH) return null
  if (typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)) return null
  if (value.createdAt > now + 5 * 60 * 1000) return null
  if (now - value.createdAt > PAGE_UPGRADE_DRAFT_TTL_MS) return null

  return value as unknown as PageUpgradeDraft
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSafeText(value: unknown, allowEmpty = false): value is string {
  return typeof value === 'string'
    && value.length <= MAX_TEXT_LENGTH
    && (allowEmpty || value.trim().length > 0)
}

function samePageUrl(a: unknown, b: string): boolean {
  if (typeof a !== 'string') return false
  try {
    const left = new URL(a)
    const right = new URL(b)
    return normaliseHost(left.hostname) === normaliseHost(right.hostname)
      && normalisePath(left.pathname) === normalisePath(right.pathname)
  } catch {
    return false
  }
}

function normaliseHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '')
}

function normalisePath(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  return trimmed || '/'
}
