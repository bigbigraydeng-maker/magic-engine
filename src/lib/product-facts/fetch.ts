const UA = 'MagicEngineFactsBot/1.0 (read-only product fact check)'
const MAX_HOPS = 3

export interface GuardedGetOptions {
  allowedHosts: Set<string>
  fetchImpl?: typeof fetch
  timeoutMs?: number
  maxBytes?: number
}

/** The configured host and its www/apex twin — nothing else (never `clients.domain`, which clients can edit). */
export function allowedHostsFor(origin: string): Set<string> {
  const host = new URL(origin).hostname
  return new Set([host, host.startsWith('www.') ? host.slice(4) : `www.${host}`])
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) throw new Error('empty_body')
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) { await reader.cancel(); throw new Error('too_large') }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** GET with every redirect hop re-checked against the host allowlist, a timeout, a size cap and a content-type check. */
export async function guardedGet(url: string, o: GuardedGetOptions): Promise<string> {
  const doFetch = o.fetchImpl ?? fetch
  let current = url
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const u = new URL(current)
    if (u.protocol !== 'https:' || !o.allowedHosts.has(u.hostname)) throw new Error('host_not_allowed')
    const res = await doFetch(current, { redirect: 'manual', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(o.timeoutMs ?? 10_000) })
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) throw new Error('bad_redirect')
      current = new URL(location, current).toString()
      continue
    }
    if (!res.ok) throw new Error(`http_${res.status}`)
    if (!/html|xml|text\/plain/i.test(res.headers.get('content-type') ?? '')) throw new Error('bad_content_type')
    return readCapped(res, o.maxBytes ?? 2_000_000)
  }
  throw new Error('too_many_redirects')
}

/** Minimal robots.txt reader: only the `User-agent: *` group's Disallow prefixes. */
export function robotsAllows(robotsTxt: string, path: string): boolean {
  let applies = false
  const disallow: string[] = []
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const m = raw.split('#')[0].trim().match(/^(user-agent|disallow)\s*:\s*(.*)$/i)
    if (!m) continue
    if (m[1].toLowerCase() === 'user-agent') applies = m[2].trim() === '*'
    else if (applies && m[2].trim()) disallow.push(m[2].trim())
  }
  return !disallow.some(prefix => path.startsWith(prefix))
}
