import { isAutoReply } from '@/lib/microsoft/auto-reply'
import type { OutboundItem } from '../types'

export interface GraphSentMessage {
  id: string
  sentDateTime: string
  subject: string | null
  to: string[]
  cc: string[]
  bcc: string[]
}

export type PageFetcher = (
  pathOrUrl: string,
) => Promise<{ ok: true; json: unknown } | { ok: false; error: string }>

const DEFAULT_PAGE_SIZE = 100
const DEFAULT_MAX_PAGES = 30

function clampPageSize(pageSize: number): number {
  if (!Number.isFinite(pageSize)) return DEFAULT_PAGE_SIZE
  const n = Math.floor(pageSize)
  if (n < 1) return 1
  if (n > 100) return 100
  return n
}

export function buildSentItemsPath(sinceIso: string, pageSize = DEFAULT_PAGE_SIZE): string {
  const top = clampPageSize(pageSize)
  const filter = encodeURIComponent(`sentDateTime ge ${sinceIso}`)
  const select = 'id,sentDateTime,subject,toRecipients,ccRecipients,bccRecipients'
  return (
    '/me/mailFolders/sentitems/messages?' +
    `$filter=${filter}` +
    '&$orderby=sentDateTime%20desc' +
    `&$select=${select}` +
    `&$top=${top}`
  )
}

interface RawRecipient {
  emailAddress?: { address?: unknown }
}

function readAddresses(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  const out: string[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) return null
    const addr = (entry as RawRecipient).emailAddress?.address
    if (typeof addr !== 'string') continue
    const trimmed = addr.trim()
    if (!trimmed) continue
    out.push(trimmed.toLowerCase())
  }
  return out
}

function readMessage(raw: unknown): GraphSentMessage | null {
  if (typeof raw !== 'object' || raw === null) return null
  const m = raw as Record<string, unknown>
  if (typeof m.id !== 'string' || !m.id) return null
  if (typeof m.sentDateTime !== 'string') return null
  const subject = m.subject === undefined ? null : m.subject
  if (subject !== null && typeof subject !== 'string') return null
  const to = readAddresses(m.toRecipients)
  const cc = readAddresses(m.ccRecipients)
  const bcc = readAddresses(m.bccRecipients)
  if (!to || !cc || !bcc) return null
  return { id: m.id, sentDateTime: m.sentDateTime, subject, to, cc, bcc }
}

export function parseSentItemsPage(
  json: unknown,
): { messages: GraphSentMessage[]; nextLink: string | null } | null {
  if (typeof json !== 'object' || json === null) return null
  const page = json as Record<string, unknown>
  if (!Array.isArray(page.value)) return null
  const messages: GraphSentMessage[] = []
  for (const raw of page.value) {
    const msg = readMessage(raw)
    if (!msg) return null
    messages.push(msg)
  }
  const rawNext = page['@odata.nextLink']
  if (rawNext !== undefined && typeof rawNext !== 'string') return null
  const nextLink = typeof rawNext === 'string' && rawNext ? rawNext : null
  return { messages, nextLink }
}

export async function collectSentItems(
  fetchPage: PageFetcher,
  sinceIso: string,
  opts?: { maxPages?: number },
): Promise<{ ok: true; messages: GraphSentMessage[] } | { ok: false; error: string }> {
  const maxPages = opts?.maxPages ?? DEFAULT_MAX_PAGES
  const all: GraphSentMessage[] = []
  let path: string | null = buildSentItemsPath(sinceIso)
  let pages = 0
  while (path) {
    if (pages >= maxPages) return { ok: false, error: 'too many pages' }
    const res = await fetchPage(path)
    if (!res.ok) return { ok: false, error: res.error }
    const parsed = parseSentItemsPage(res.json)
    if (!parsed) return { ok: false, error: 'unreadable page' }
    all.push(...parsed.messages)
    pages += 1
    path = parsed.nextLink
  }
  return { ok: true, messages: all }
}

export function toOutboundItems(
  messages: readonly GraphSentMessage[],
  addresses: readonly string[],
): OutboundItem[] {
  const wanted = new Set(addresses.map((a) => a.trim().toLowerCase()).filter(Boolean))
  const out: OutboundItem[] = []
  for (const msg of messages) {
    if (isAutoReply(msg.subject)) continue
    const present = new Set<string>([...msg.to, ...msg.cc, ...msg.bcc])
    for (const addr of present) {
      if (!wanted.has(addr)) continue
      out.push({
        source: 'sent_items',
        id: msg.id,
        at: msg.sentDateTime,
        subject: msg.subject,
        address: addr,
      })
    }
  }
  return out
}
