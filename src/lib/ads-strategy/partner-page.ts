/**
 * Partnership ads on the existing paused-draft card.
 * The identity page comes from this client's config. The default is the
 * client's own page. A partner page id is never hardcoded.
 * Opening stays on the go-live card, which already checks the approved plan cap.
 * The draft card only creates paused objects.
 */

import type { AdDraft } from './ad-draft'

export const PARTNER_PAGE_KIND = 'partner_page' as const
export const PARTNER_PAGE_CONFIG_KEY = 'ads_partner_page'

export const PARTNER_PAGE_DENIED =
  '伙伴主页还没有投放权限，或还没有分享到这个广告账户。这次没有去建。'
export const PARTNER_PAGE_UNREAD =
  '读不到伙伴主页是不是已经有投放权限、是不是已经分享到广告账户。这次没有去建。'
export const PARTNER_PAGE_UNCONFIGURED =
  '这位客户的配置里还没有伙伴主页编号，不能把身份换成伙伴主页。这次没有继续。'
export const PARTNER_PAGE_CONFIG_UNREAD = '读不到这位客户的主页配置，这次没有去建。'
export const PARTNER_PAGE_IDENTITY_CHANGED =
  '身份主页和现在的客户配置不一致，这次没有去建。请重新出一张确认卡。'
export const PARTNER_PAGE_OPEN_REFUSAL = '伙伴主页广告只能从开投确认卡打开。这里没有开。'

const CLEAN = new Set<string>([
  PARTNER_PAGE_DENIED,
  PARTNER_PAGE_UNREAD,
  PARTNER_PAGE_UNCONFIGURED,
  PARTNER_PAGE_CONFIG_UNREAD,
  PARTNER_PAGE_IDENTITY_CHANGED,
])

const PAGE_ID = /^\d{5,25}$/
const ACCOUNT_ID = /^act_\d+$/
const GRAPH = 'https://graph.facebook.com/v21.0'

export type PartnerIdentity = 'own' | 'partner'

export interface PartnerPageConfig {
  identity: PartnerIdentity
  partnerPageId: string | null
}

type PageProbe =
  | { state: 'ok'; id: string; tasks: string[] | null }
  | { state: 'denied' }
  | { state: 'unread' }

type ShareProbe =
  | { state: 'ok'; ids: string[]; more: boolean }
  | { state: 'denied' }
  | { state: 'unread' }

type ClientPages =
  | { ok: true; ownPageId: string; leadsConfig: unknown }
  | { ok: false }

export function isCleanPartnerRefusal(error: string | undefined): boolean {
  return typeof error === 'string' && CLEAN.has(error)
}

export function readPartnerPageConfig(leadsConfig: unknown): PartnerPageConfig {
  const block = objectOf(objectOf(leadsConfig)?.[PARTNER_PAGE_CONFIG_KEY])
  const raw = block?.partner_page_id
  const partnerPageId = typeof raw === 'string' && PAGE_ID.test(raw.trim()) ? raw.trim() : null
  return { identity: block?.identity === 'partner' ? 'partner' : 'own', partnerPageId }
}

export function resolvePartnerIdentity(args: {
  kind: unknown
  ownPageId: string
  leadsConfig: unknown
}): { ok: true; pageId: string; identity: PartnerIdentity } | { ok: false; reason: string } {
  if (args.kind !== PARTNER_PAGE_KIND) return { ok: true, pageId: args.ownPageId, identity: 'own' }
  const config = readPartnerPageConfig(args.leadsConfig)
  if (config.identity !== 'partner') return { ok: true, pageId: args.ownPageId, identity: 'own' }
  if (!config.partnerPageId) return { ok: false, reason: PARTNER_PAGE_UNCONFIGURED }
  if (config.partnerPageId === args.ownPageId) return { ok: true, pageId: args.ownPageId, identity: 'own' }
  return { ok: true, pageId: config.partnerPageId, identity: 'partner' }
}

/** Server stamp. The request body does not choose the page. */
export function draftStampedWithIdentity(
  draft: AdDraft,
  ownPageId: string,
  leadsConfig: unknown,
): { ok: true; draft: AdDraft } | { ok: false; reason: string } {
  const resolved = resolvePartnerIdentity({ kind: draft.kind, ownPageId, leadsConfig })
  if (!resolved.ok) return resolved
  const next: AdDraft = { ...draft, pageId: resolved.pageId }
  delete next.partnerIdentity
  if (next.kind === PARTNER_PAGE_KIND) next.partnerIdentity = resolved.identity
  return { ok: true, draft: next }
}

export async function alignPartnerDraft(
  draft: AdDraft,
  readClient: (clientId: string) => Promise<ClientPages>,
): Promise<{ ok: true; draft: AdDraft } | { ok: false; reason: string }> {
  if (draft.kind !== PARTNER_PAGE_KIND) return { ok: true, draft }
  const row = await readClient(draft.clientId)
  if (!row.ok) return { ok: false, reason: PARTNER_PAGE_CONFIG_UNREAD }
  const resolved = resolvePartnerIdentity({ kind: draft.kind, ownPageId: row.ownPageId, leadsConfig: row.leadsConfig })
  if (!resolved.ok) return resolved
  const stamped = draft.partnerIdentity ?? 'own'
  if (draft.pageId !== resolved.pageId || stamped !== resolved.identity) {
    return { ok: false, reason: PARTNER_PAGE_IDENTITY_CHANGED }
  }
  return { ok: true, draft: { ...draft, pageId: resolved.pageId, partnerIdentity: resolved.identity } }
}

export function partnerPageOpenBlocked(kind: unknown, entry: string): boolean {
  return kind === PARTNER_PAGE_KIND && entry !== 'go-live-card'
}

export function partnerPageScopeNote(draft: { kind: string; partnerIdentity?: string }): string {
  if (draft.kind !== PARTNER_PAGE_KIND) return ''
  return draft.partnerIdentity === 'partner'
    ? ' 身份主页：已配置的伙伴主页。'
    : ' 身份主页：客户自己的主页。'
}

/** Before any create. Own-page identity does not call Meta. */
export async function partnerPagePublishRefusal(
  draft: Pick<AdDraft, 'kind' | 'pageId' | 'partnerIdentity'>,
  adAccountId: string,
  accessToken: string,
): Promise<string | null> {
  if (draft.kind !== PARTNER_PAGE_KIND || draft.partnerIdentity !== 'partner') return null
  if (!PAGE_ID.test(draft.pageId) || !ACCOUNT_ID.test(adAccountId)) return PARTNER_PAGE_DENIED
  const page = await readPage(draft.pageId, accessToken)
  if (page.state === 'unread') return PARTNER_PAGE_UNREAD
  if (page.state === 'denied') return PARTNER_PAGE_DENIED
  const share = await readPromotePages(adAccountId, draft.pageId, accessToken)
  if (share.state === 'unread') return PARTNER_PAGE_UNREAD
  return partnerShareVerdict(draft.pageId, page, share)
}

export function partnerShareVerdict(pageId: string, page: PageProbe, share: ShareProbe): string | null {
  if (page.state === 'unread' || share.state === 'unread') return PARTNER_PAGE_UNREAD
  if (page.state === 'denied' || share.state === 'denied') return PARTNER_PAGE_DENIED
  if (page.id !== pageId) return PARTNER_PAGE_DENIED
  if (page.tasks && !page.tasks.some((task) => task.toUpperCase() === 'ADVERTISE')) return PARTNER_PAGE_DENIED
  if (share.state === 'ok' && share.ids.includes(pageId)) return null
  if (share.state === 'ok' && share.more) return PARTNER_PAGE_UNREAD
  return PARTNER_PAGE_DENIED
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function errorCode(body: unknown): number | null {
  const code = objectOf(objectOf(body)?.error)?.code
  return typeof code === 'number' ? code : null
}

function failedState(status: number, body: unknown): 'denied' | 'unread' {
  if (status >= 500 || status === 0) return 'unread'
  const code = errorCode(body)
  if (code === 1 || code === 2) return 'unread'
  return 'denied'
}

function parsePage(status: number, body: unknown): PageProbe {
  if (status < 200 || status >= 300) return { state: failedState(status, body) }
  const row = objectOf(body)
  const id = row && typeof row.id === 'string' ? row.id : ''
  if (!row || !id) return { state: 'denied' }
  if (!Object.prototype.hasOwnProperty.call(row, 'tasks')) return { state: 'ok', id, tasks: null }
  if (!Array.isArray(row.tasks) || row.tasks.some((task) => typeof task !== 'string')) return { state: 'denied' }
  return { state: 'ok', id, tasks: row.tasks as string[] }
}

function parseShare(status: number, body: unknown): ShareProbe & { after: string | null } {
  if (status < 200 || status >= 300) return { state: failedState(status, body), after: null }
  const row = objectOf(body)
  const data = row?.data
  if (!Array.isArray(data)) return { state: 'denied', after: null }
  const ids = data.flatMap((item) => {
    const id = objectOf(item)?.id
    return typeof id === 'string' ? [id] : []
  })
  const after = afterCursor(row)
  const next = objectOf(row?.paging)?.next
  return { state: 'ok', ids, more: after !== null || typeof next === 'string', after }
}

function afterCursor(row: Record<string, unknown> | null): string | null {
  const after = objectOf(objectOf(objectOf(row)?.paging)?.cursors)?.after
  return typeof after === 'string' && after.length > 0 && after.length < 500 ? after : null
}

async function graphRead(url: string): Promise<{ status: number; body: unknown } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    const text = await res.text().catch(() => '')
    try {
      return { status: res.status, body: text ? JSON.parse(text) as unknown : null }
    } catch {
      return { status: res.status, body: null }
    }
  } catch {
    return null
  }
}

async function readPage(pageId: string, token: string): Promise<PageProbe> {
  const params = new URLSearchParams({ fields: 'id,tasks', access_token: token })
  const got = await graphRead(`${GRAPH}/${pageId}?${params}`)
  if (!got) return { state: 'unread' }
  return parsePage(got.status, got.body)
}

async function readPromotePages(accountId: string, pageId: string, token: string): Promise<ShareProbe> {
  const ids: string[] = []
  let after: string | null = null
  for (let page = 0; page < 4; page += 1) {
    const params = new URLSearchParams({ fields: 'id', limit: '100', access_token: token })
    if (after) params.set('after', after)
    const got = await graphRead(`${GRAPH}/${accountId}/promote_pages?${params}`)
    if (!got) return { state: 'unread' }
    const parsed = parseShare(got.status, got.body)
    if (parsed.state !== 'ok') return parsed
    ids.push(...parsed.ids)
    if (ids.includes(pageId) || !parsed.more) return { state: 'ok', ids, more: false }
    if (!parsed.after) return { state: 'ok', ids, more: true }
    after = parsed.after
  }
  return { state: 'ok', ids, more: true }
}
