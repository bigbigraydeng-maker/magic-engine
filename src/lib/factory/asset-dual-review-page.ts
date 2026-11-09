// Read one official page for the fact check. Off-site and private addresses are not fetched.

import { lookup } from 'node:dns/promises'
import { isBlockedAddress } from './safe-remote-fetch'
import { officialWebsiteUrl } from './topic-alignment'

const MAX_BYTES = 200_000
const MAX_HOPS = 3

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

async function oneHop(
  current: URL,
  fetcher: typeof fetch,
): Promise<{ kind: 'body'; text: string } | { kind: 'next'; url: string } | { kind: 'stop' }> {
  let response: Response
  try {
    response = await fetcher(current.toString(), {
      redirect: 'manual',
      headers: { Accept: 'text/html' },
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    return { kind: 'stop' }
  }
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location')
    return location ? { kind: 'next', url: location } : { kind: 'stop' }
  }
  if (!response.ok) return { kind: 'stop' }
  const raw = await response.text()
  return { kind: 'body', text: htmlToText(raw.slice(0, MAX_BYTES)) }
}

export type HostGuard = (url: URL) => Promise<boolean>

/** False when the name does not resolve, or any address is private. */
export async function publicHost(url: URL): Promise<boolean> {
  try {
    const addresses = await lookup(url.hostname, { all: true })
    return addresses.length > 0 && addresses.every((item) => !isBlockedAddress(item.address))
  } catch {
    return false
  }
}

function nextOfficial(location: string, current: URL, hosts: readonly string[]): URL | null {
  let next: URL
  try {
    next = new URL(location, current)
  } catch {
    return null
  }
  return officialWebsiteUrl(next.toString(), [...hosts])
}

/** Page text, or null when the page is not on the official site or cannot be read. */
export async function readOfficialPage(
  rawUrl: string,
  hosts: readonly string[],
  fetcher: typeof fetch = fetch,
  guard: HostGuard = publicHost,
): Promise<string | null> {
  let current = officialWebsiteUrl(rawUrl, [...hosts])
  if (!current) return null
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (!(await guard(current))) return null
    const step = await oneHop(current, fetcher)
    if (step.kind === 'body') return step.text
    if (step.kind === 'stop') return null
    const allowed = nextOfficial(step.url, current, hosts)
    if (!allowed) return null
    current = allowed
  }
  return null
}
