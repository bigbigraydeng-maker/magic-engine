import { supabaseAdmin as db } from '@/lib/supabase'
import { canonicalDomain } from './targets'
import { getClientKeywords } from '@/lib/keywords/resolver'
import { normalizeProducts } from '@/lib/brief/products'
import { deriveTravelScope } from './profiles/travel'
import {
  buildCompetitionBrief,
  type AiSnapshot,
  type BaselineDomain,
  type MarketSnapshot,
  type ReputationSnapshot,
} from './competition-brief'

type CompetitorRef = { domain: string; status: string; urls: string[]; tags: string[] }
type QueryResult<T> = { data: T | null; error: unknown }

async function loadBaselines(clientDomain: string | null, competitors: CompetitorRef[]): Promise<QueryResult<BaselineDomain[]>> {
  if (!clientDomain) return { data: [], error: null }
  const own = canonicalDomain(clientDomain)
  const groups = await db.from('baseline_domains').select('sub_industry').eq('is_client', true).in('domain', [own, `www.${own}`])
  if (groups.error) return { data: null, error: groups.error }
  const subIndustries = [...new Set((groups.data ?? []).map(row => String(row.sub_industry)))]
  if (!subIndustries.length) return { data: [], error: null }
  const known = [own, `www.${own}`, ...competitors.map(item => canonicalDomain(item.domain)), ...competitors.map(item => `www.${canonicalDomain(item.domain)}`)]
  return db.from('baseline_domains')
    .select('domain,seo_score,last_collected_at,is_client')
    .in('sub_industry', subIndustries)
    .in('domain', [...new Set(known)])
    .eq('is_active', true)
}

export async function loadCompetitionBrief(clientId: string, client: { name: string; domain: string | null }, competitors: CompetitorRef[]) {
  const active = competitors.filter(item => item.status !== 'archive')
  const configuredUrls = active.flatMap(item => item.urls)
  const snapshotsRequest = configuredUrls.length
    ? db.from('market_snapshots').select('domain,url,projection_content,page_role,captured_at,projection_version')
      .eq('client_id', clientId).in('url', configuredUrls).order('captured_at', { ascending: false }).limit(100)
    : Promise.resolve({ data: [], error: null })
  const [snapshots, reputation, ai, baselines, products, keywords] = await Promise.all([
    snapshotsRequest,
    db.from('reputation_snapshots').select('entity_type,entity_name,source,rating,review_count,snapshot_date,measured_at')
      .eq('client_id', clientId).order('measured_at', { ascending: false }).limit(100),
    db.from('ai_visibility_snapshots').select('week_of,avg_rank,mentions_count,total_runs,models_covered')
      .eq('client_id', clientId).order('week_of', { ascending: false }).limit(1).maybeSingle(),
    loadBaselines(client.domain, active),
    db.from('master_briefs').select('products').eq('client_id', clientId)
      .or('status.eq.active,is_active.eq.true').order('version', { ascending: false }).limit(1).maybeSingle(),
    getClientKeywords(clientId, 100, { strict: true }).then(data => ({ data, error: null })).catch(error => ({ data: null, error })),
  ])
  const clientProducts = normalizeProducts(products.data?.products)
  const clientKeywords = keywords.data?.keywords ?? []
  const travelEnabled = active.some(item => item.tags.includes('industry:travel'))
  return buildCompetitionBrief({
    clientName: client.name,
    clientDomain: client.domain,
    competitorCount: active.filter(item => item.urls.length > 0).length,
    configuredPageCount: active.reduce((sum, item) => sum + item.urls.length, 0),
    snapshots: { data: (snapshots.data ?? []) as MarketSnapshot[], failed: Boolean(snapshots.error) },
    baselines: { data: (baselines.data ?? []) as BaselineDomain[], failed: Boolean(baselines.error) },
    reputation: { data: (reputation.data ?? []) as ReputationSnapshot[], failed: Boolean(reputation.error) },
    ai: { data: (ai.data ?? null) as AiSnapshot | null, failed: Boolean(ai.error) },
    productScope: travelEnabled ? deriveTravelScope(clientProducts, clientKeywords) : deriveTravelScope([], []),
    productScopeApplies: travelEnabled,
    productScopeFailed: Boolean(products.error || keywords.error),
    hasConfiguredProducts: clientProducts.length > 0,
  })
}
