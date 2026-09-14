import { supabaseAdmin as db } from '@/lib/supabase'
import { allowedClient, settingsSchema, type Settings, type Signal } from './contracts'
import { canonicalDomain, loadCompetitors } from './targets'
import { loadCompetitionBrief } from './competition-sources'
import { latestFreshSnapshots, latestSnapshots } from './competition-brief'
import { buildOperatingBrief, normalizeOperatingProducts, operatingProductFromTour, parseTourRecordLine, resolveCurrentOperatingGoal, type OperatingBrief, type OperatingEvidence, type OperatingGoalCandidate } from './operating-brief'
import { extractTourLinks, matchTravelScope, travelMarketTerms } from './profiles/travel'
import { loadFirstPartyTourProducts } from './first-party-tours'
import { projectTrafficDirectionSignals } from './traffic-direction'

export async function saveSettings(clientId: string, raw: unknown): Promise<void> {
  const settings = settingsSchema.parse(raw)
  if (settings.enabled && !allowedClient(clientId)) throw new Error('client_not_in_rollout')
  const r = await db.from('web_intelligence_settings').upsert({ client_id: clientId, ...settings, updated_at: new Date().toISOString() })
  if (r.error) throw new Error('settings_save_failed')
}
export async function readView(clientId: string, canEdit: boolean) {
  const [client, settings, competitors, signals, runs, budget, masterBrief, goals, trafficDirection, externalSignals] = await Promise.all([
    db.from('clients').select('id,name,domain').eq('id', clientId).single(),
    db.from('web_intelligence_settings').select('*').eq('client_id', clientId).maybeSingle(),
    loadCompetitors(clientId),
    db.from('market_signals').select('*').eq('client_id', clientId).order('created_at', { ascending: false }).limit(50),
    db.from('web_intelligence_runs').select('*').eq('client_id', clientId).order('created_at', { ascending: false }).limit(50),
    db.rpc('web_intelligence_budget', { p_client_id: clientId }),
    db.from('master_briefs').select('products,primary_audience,buying_trigger,keyword_seeds,competitor_domains,status,is_active,version').eq('client_id', clientId).or('status.eq.active,is_active.eq.true').order('version', { ascending: false }).limit(1).maybeSingle(),
    db.from('goals').select('title,status,primary_metric_label,target_value,period_start,period_end,updated_at').eq('client_id', clientId).order('updated_at', { ascending: false }).limit(20),
    db.from('web_intelligence_external_observations').select('source_url,competitor_domain,observed_at,valid_until,excerpt').eq('client_id', clientId).eq('source_type', 'website').eq('source_name', '竞品网站流量方向（Apify）').order('observed_at', { ascending: false }).limit(100),
    db.from('web_intelligence_external_observations').select('source_type,source_name,source_url,title,excerpt,observed_at,valid_until,analysis').eq('client_id', clientId).in('source_type', ['industry_news', 'industry_media', 'jobs']).order('observed_at', { ascending: false }).limit(60),
  ])
  if (client.error || settings.error || signals.error || runs.error || budget.error || masterBrief.error || goals.error) throw new Error('web_intelligence_read_failed')
  const ids = (signals.data as Signal[]).flatMap(s => [s.before_evidence_id, s.after_evidence_id])
  const evidence = ids.length ? await db.from('market_evidence').select('*').eq('client_id', clientId).in('id', ids) : { data: [], error: null }
  if (evidence.error) throw new Error('evidence_read_failed')
  const config: Settings | null = settings.data ? settingsSchema.strip().parse(settings.data) : null
  const brief = await loadCompetitionBrief(clientId, client.data, competitors)
  const domains = competitors.filter(item => item.status !== 'archive').map(item => item.domain)
  const urls = competitors.filter(item => item.status !== 'archive').flatMap(item => item.urls)
  const ownDomain = client.data.domain ? canonicalDomain(client.data.domain) : null
  const ownUrl = ownDomain ? `https://${ownDomain}/` : null
  const snapshotUrls = [...new Set([...urls, ...(ownUrl ? [ownUrl] : [])])]
  const snapshots = snapshotUrls.length ? await db.from('market_snapshots').select('run_id,domain,url,content,projection_content,captured_at').eq('client_id', clientId).in('url', snapshotUrls).order('captured_at', { ascending: false }).limit(snapshotUrls.length) : { data: [], error: null }
  if (snapshots.error) throw new Error('operating_snapshot_read_failed')
  const detailSnapshots = domains.length ? await db.from('market_snapshots').select('run_id,domain,url,content,projection_content,captured_at,page_role').eq('client_id', clientId).in('domain', domains).eq('page_role', 'product_detail').order('captured_at', { ascending: false }).limit(200) : { data: [], error: null }
  if (detailSnapshots.error) throw new Error('operating_detail_snapshot_read_failed')
  const asOf = new Date()
  const snapshotRows = (snapshots.data ?? []) as Array<{ run_id: string; domain: string; url: string; content: string; projection_content: string | null; captured_at: string; page_role?: string | null }>
  const detailRows = (detailSnapshots.data ?? []) as typeof snapshotRows
  const currentSnapshots = latestFreshSnapshots(snapshotRows, asOf)
  const ownRows = currentSnapshots.filter(row => ownDomain && canonicalDomain(row.domain) === ownDomain)
  const ownProducts = ownRows.flatMap(row => (row.projection_content ?? '').split('\n').map(parseTourRecordLine).filter((value): value is NonNullable<ReturnType<typeof parseTourRecordLine>> => value !== null)).map(operatingProductFromTour)
  const firstPartyProducts = await loadFirstPartyTourProducts(ownDomain)
  const masterProducts = normalizeOperatingProducts(masterBrief.data?.products)
  const clientProducts = masterProducts.length ? masterProducts : firstPartyProducts.length ? firstPartyProducts : ownProducts
  const clientProductSource = masterProducts.length ? 'master_brief' : firstPartyProducts.length ? 'first_party_feed' : ownProducts.length ? 'web_snapshot' : 'none'
  const allCurrentSnapshots = latestFreshSnapshots([...snapshotRows, ...detailRows], asOf)
  const observations = latestSnapshots(snapshotRows).map(row => ({ run_id: row.run_id, domain: row.domain, url: row.url, observed_at: row.captured_at }))
  const detailObservations = latestSnapshots(detailRows).map(row => ({ run_id: row.run_id, domain: row.domain, url: row.url, observed_at: row.captured_at }))
  const latestDetailByUrl = new Map(latestSnapshots(detailRows).map(row => [row.url, row]))
  const latestRunByUrl = new Map([...((runs.data ?? []) as Array<{ url: string; created_at: string; status: string }>)]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .map(run => [run.url, run]))
  const competitorProducts = allCurrentSnapshots.filter(row => !ownDomain || canonicalDomain(row.domain) !== ownDomain).map(row => ({ domain: row.domain, source_url: row.url, observed_at: row.captured_at, records: (row.projection_content ?? '').split('\n').map(parseTourRecordLine).filter((value): value is NonNullable<ReturnType<typeof parseTourRecordLine>> => value !== null) }))
  const discoveredTours = currentSnapshots.flatMap(row => extractTourLinks(row.content ?? '', row.url).map(link => {
    const detail = latestDetailByUrl.get(link.url)
    const run = latestRunByUrl.get(link.url)
    const fresh = detail && asOf.getTime() - Date.parse(detail.captured_at) <= 8 * 86_400_000
    const detailStatus = fresh ? 'ready' : run && !['complete', 'failed', 'reconciliation'].includes(run.status) ? 'capturing' : run?.status === 'failed' || run?.status === 'reconciliation' ? 'failed' : detail ? 'stale' : 'not_started'
    return {
      ...link, domain: row.domain, listing_url: row.url, observed_at: row.captured_at,
      detail_status: detailStatus,
      detail_observed_at: detail?.captured_at ?? null,
    }
  }))
  const activeGoal = resolveCurrentOperatingGoal((goals.data ?? []) as OperatingGoalCandidate[], asOf)
  const operatingEvidence: OperatingEvidence[] = (evidence.data ?? []).map(item => ({ id: item.id, client_id: item.client_id, source: item.source_url, scope: 'competitor', statement: item.excerpt.split('\n').slice(0, 3).join(' '), observed_at: item.observed_at, fact_type: 'fact', confidence: 'high' }))
  const operating: OperatingBrief = buildOperatingBrief({
    client: { id: client.data.id, name: client.data.name },
    goal: activeGoal,
    product_scope: brief.product_scope,
    client_products: clientProducts,
    competitor_products: competitorProducts.map(item => ({ ...item, records: item.records.filter(record => {
      if (brief.product_scope.status === 'unknown' || brief.product_scope.market_ids.length === 0) return false
      return matchTravelScope(`Tour: ${record.name} | Route: ${record.route}`, '', brief.product_scope).status === 'matched'
    }) })),
    evidence: operatingEvidence, now: asOf,
  })
  const trafficRows = (trafficDirection.data ?? []).flatMap(row => typeof row.competitor_domain === 'string' ? [{ domain: row.competitor_domain, source_url: row.source_url, observed_at: row.observed_at, valid_until: row.valid_until, excerpt: row.excerpt }] : [])
  const relevanceTerms = travelMarketTerms(brief.product_scope.market_ids).map(term => term.toLowerCase())
  const scopedExternalSignals = externalSignals.error ? [] : (externalSignals.data ?? []).filter(signal => signal.source_type === 'jobs' || relevanceTerms.some(term => `${signal.title}\n${signal.excerpt}`.toLowerCase().includes(term)))
  return { client: client.data, settings: config, competitors, signals: signals.data, evidence: evidence.data, runs: runs.data, observations: [...observations, ...detailObservations], discovered_tours: discoveredTours, traffic_direction: projectTrafficDirectionSignals(trafficRows, client.data.domain), external_signals: scopedExternalSignals, budget: budget.data, brief, operating, client_product_source: { kind: clientProductSource, count: clientProducts.length }, can_edit: canEdit, can_run: canEdit && allowedClient(clientId) && config?.enabled === true && config?.entitled === true }
}
