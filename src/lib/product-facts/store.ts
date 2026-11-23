import { createHash } from 'node:crypto'
import { supabaseAdmin as db } from '@/lib/supabase'
import { externalObservationSchema } from '@/lib/web-intelligence/contracts'
import { STALE_AFTER_DAYS, collectProductFacts, loadFactSource, type CollectOptions, type ProductFact, type ProductFactStatus } from './collect'

/**
 * Snapshots live in the existing immutable `web_intelligence_external_observations` table (source_type `website`,
 * tier A = the client's own site), so no new table. One row per product page per refresh; the structured record is the excerpt.
 */
const SOURCE_NAME = 'client-product-facts'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY_MS = 86_400_000

export type RefreshResult =
  | { ok: true; facts: ProductFact[]; written: number; write_failures: number; dry_run: boolean }
  | { ok: false; reason: 'invalid_client_id' | 'source_not_configured' }

export async function refreshProductFacts(clientId: string, opts: CollectOptions & { dryRun?: boolean } = {}): Promise<RefreshResult> {
  if (!UUID.test(clientId)) return { ok: false, reason: 'invalid_client_id' }
  const source = loadFactSource(clientId)
  if (!source) return { ok: false, reason: 'source_not_configured' }
  const now = opts.now ?? new Date()
  const facts = await collectProductFacts(source, { ...opts, now })
  const dryRun = opts.dryRun ?? false
  let written = 0
  let writeFailures = 0
  for (const f of dryRun ? [] : facts) {
    const { source_url, verified_at, ...payload } = f
    const excerpt = JSON.stringify(payload).slice(0, 5000)
    const row = externalObservationSchema.parse({
      client_id: clientId, source_type: 'website', source_tier: 'A', source_name: SOURCE_NAME,
      source_url, canonical_url: source_url, title: f.name ?? '', excerpt, competitor_domain: null, published_at: null,
      observed_at: now.toISOString(), valid_until: new Date(now.getTime() + STALE_AFTER_DAYS * DAY_MS).toISOString(),
      content_hash: createHash('sha256').update(`${excerpt}|${verified_at ?? ''}|${now.toISOString().slice(0, 10)}`).digest('hex'),
      status: f.status === 'fetch_failed' ? 'unavailable' : 'observed',
    })
    const res = await db.from('web_intelligence_external_observations').insert(row)
    // 23505 = same content already recorded today; the earlier row says the same thing.
    if (!res.error || res.error.code === '23505') written++
    else writeFailures++
  }
  return { ok: true, facts, written, write_failures: writeFailures, dry_run: dryRun }
}

export type ProductFactsResult =
  | { ok: true; facts: ProductFact[]; checked_at: string }
  | { ok: false; reason: 'invalid_client_id' | 'never_measured' | 'read_failed' }

function rowToFact(row: { canonical_url: string; excerpt: string; observed_at: string }, now: Date): ProductFact {
  const unreadable: ProductFact = { name: null, duration_days: null, from_price: null, price_basis: null, departures: null, inclusions: null, source_url: row.canonical_url, verified_at: null, status: 'not_measured', error: 'unreadable_snapshot' }
  try {
    const p = JSON.parse(row.excerpt) as Partial<ProductFact>
    const statuses: ProductFactStatus[] = ['ok', 'stale', 'fetch_failed', 'not_measured']
    if (!p.status || !statuses.includes(p.status)) return unreadable
    const old = now.getTime() - new Date(row.observed_at).getTime() > STALE_AFTER_DAYS * DAY_MS
    return {
      name: p.name ?? null, duration_days: p.duration_days ?? null, from_price: p.from_price ?? null, price_basis: p.price_basis ?? null,
      departures: p.departures ?? null, inclusions: p.inclusions ?? null, source_url: row.canonical_url,
      verified_at: p.status === 'ok' ? row.observed_at : null, status: p.status === 'ok' && old ? 'stale' : p.status, error: p.error,
    }
  } catch {
    return unreadable
  }
}

/**
 * Read-only: the latest refresh's product facts for one client. `ok` older than 14 days is returned as `stale`;
 * a failed or unmeasured page is returned as such (never silently dropped, never replaced by an older good read).
 */
export async function getProductFacts(clientId: string, now: Date = new Date()): Promise<ProductFactsResult> {
  if (!UUID.test(clientId)) return { ok: false, reason: 'invalid_client_id' }
  const res = await db.from('web_intelligence_external_observations').select('canonical_url, excerpt, observed_at')
    .eq('client_id', clientId).eq('source_name', SOURCE_NAME).order('observed_at', { ascending: false }).limit(200)
  if (res.error) return { ok: false, reason: 'read_failed' }
  const rows = (res.data ?? []) as Array<{ canonical_url: string; excerpt: string; observed_at: string }>
  if (!rows.length) return { ok: false, reason: 'never_measured' }
  const latest = rows[0].observed_at // one refresh stamps every row with the same observed_at
  const seen = new Set<string>()
  const facts = rows.filter(r => r.observed_at === latest && !seen.has(r.canonical_url) && seen.add(r.canonical_url)).map(r => rowToFact(r, now))
  return { ok: true, facts, checked_at: latest }
}
