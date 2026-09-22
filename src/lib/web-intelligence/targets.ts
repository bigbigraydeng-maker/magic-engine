import { isIP } from 'node:net'
import { normaliseDomain, getClientCompetitors } from '@/lib/competitors/resolver'
import { supabaseAdmin as db } from '@/lib/supabase'
import { resolveValidatedAddress } from '@/lib/net/safe-fetch'
import { metadataSchema, type MonitorCompetitor } from './contracts'

export function canonicalDomain(raw: string): string {
  const domain = normaliseDomain(raw).replace(/^www\./, '')
  if (isIP(domain) || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) throw new Error('invalid_public_domain')
  return domain
}
export function approvedUrl(raw: string, domain: string): string {
  const url = new URL(raw)
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || canonicalDomain(url.hostname) !== canonicalDomain(domain)) throw new Error('url_outside_approved_scope')
  return url.href
}
function isTourDetailPath(raw: string): boolean {
  try { return /(?:^|\/)tours?\/[^/]+(?:\/|$)|(?:^|\/)escorted-tours\/[^/]+|(?:^|\/)private-tours\/[^/]+/i.test(new URL(raw).pathname) } catch { return false }
}
export async function validatePublicTarget(url: string): Promise<void> {
  await resolveValidatedAddress(new URL(url).hostname)
}

async function baselineDomains(clientDomain: string): Promise<string[]> {
  const own = canonicalDomain(clientDomain)
  const result = await db.from('baseline_domains').select('sub_industry').eq('is_client', true).in('domain', [own, `www.${own}`])
  if (result.error) throw new Error('baseline_read_failed')
  const groups = (result.data ?? []).map(r => String(r.sub_industry))
  if (!groups.length) return []
  const rows = await db.from('baseline_domains').select('domain').in('sub_industry', groups).eq('is_client', false).eq('is_active', true).limit(100)
  if (rows.error) throw new Error('baseline_read_failed')
  return (rows.data ?? []).map(r => String(r.domain))
}
export async function loadCompetitors(clientId: string): Promise<MonitorCompetitor[]> {
  const [resolved, meta, client] = await Promise.all([
    getClientCompetitors(clientId, [], 20, true),
    db.from('competitor_monitoring_metadata').select('*').eq('client_id', clientId),
    db.from('clients').select('domain').eq('id', clientId).single(),
  ])
  if (meta.error || client.error) throw new Error('competitor_read_failed')
  const baselines = client.data.domain ? await baselineDomains(client.data.domain) : []
  const identities = new Map<string, string[]>()
  for (const raw of [...resolved.domains, ...baselines]) {
    const domain = canonicalDomain(raw)
    const source = resolved.sources[raw]
    const sources = identities.get(domain) ?? []
    sources.push(source === 'fde' ? 'manual' : source === 'brief' ? 'brief' : source === 'auto' ? 'auto' : 'industry_baseline')
    identities.set(domain, [...new Set(sources)])
  }
  return [...identities].map(([domain, sources]) => {
    const stored = (meta.data ?? []).find(r => r.domain === domain)
    const defaults = { domain, sources, tier: sources.includes('industry_baseline') ? 'benchmark' : 'watch', status: 'active', tags: [], urls: [], interval_hours: 168 }
    const value = stored ? { ...defaults, ...stored, sources: [...new Set([...sources, ...stored.sources])] } : defaults
    return metadataSchema.parse({ domain, tier: value.tier, status: value.status, sources: value.sources, tags: value.tags, urls: value.urls, interval_hours: value.interval_hours })
  })
}
export async function saveMetadata(clientId: string, raw: unknown): Promise<void> {
  const input = metadataSchema.parse(raw)
  input.domain = canonicalDomain(input.domain)
  const current = (await loadCompetitors(clientId)).find(c => c.domain === input.domain)
  if (!current) throw new Error('domain_not_in_existing_sources')
  input.sources = [...new Set([...current.sources, ...input.sources])] as typeof input.sources
  input.urls = [...new Set(input.urls.map(url => approvedUrl(url, input.domain)))]
  const result = await db.from('competitor_monitoring_metadata').upsert({ client_id: clientId, ...input, updated_at: new Date().toISOString() })
  if (result.error) throw new Error('metadata_save_failed')
}
export async function assertEligibleTarget(clientId: string, domain: string, url: string): Promise<MonitorCompetitor> {
  const canonical = canonicalDomain(domain)
  const ownClient = await db.from('clients').select('domain').eq('id', clientId).single()
  if (ownClient.error) throw new Error('client_read_failed')
  if (ownClient.data?.domain && canonical === canonicalDomain(String(ownClient.data.domain))) {
    const safeUrl = approvedUrl(url, canonical)
    return metadataSchema.parse({
      domain: canonical, tier: 'watch', status: 'active',
      sources: ['manual'], tags: ['industry:travel'], urls: [safeUrl], interval_hours: 168,
    })
  }
  const target = (await loadCompetitors(clientId)).find(c => c.domain === canonical)
  if (!target || target.status === 'archive') throw new Error('target_not_eligible')
  const safeUrl = approvedUrl(url, canonical)
  const configured = target.urls.includes(safeUrl)
  const discoveredTour = target.tags.includes('industry:travel') && isTourDetailPath(safeUrl)
  if (!configured && !discoveredTour) throw new Error('url_not_configured')
  return target
}
