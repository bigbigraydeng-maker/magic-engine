import { NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { allowedClient } from '@/lib/web-intelligence/contracts'
import { collectAndRecordExternalObservations } from '@/lib/web-intelligence/external-run'
import { sourceDefaultUrls } from '@/lib/web-intelligence/sources'
import { getClientKeywords } from '@/lib/keywords/resolver'
import { normalizeOperatingProducts } from '@/lib/web-intelligence/operating-brief'
import { deriveTravelScope, travelMarketTerms } from '@/lib/web-intelligence/profiles/travel'
import { supabaseAdmin as db } from '@/lib/supabase'
import { analyzeJobSignals } from '@/lib/web-intelligence/job-analysis'

export const maxDuration = 300

type Context = { params: Promise<{ id: string }> }
type ExternalRequest = {
  source_id?: unknown
  site_url?: unknown
  queries?: unknown
  location?: unknown
  max_results?: unknown
}

const INDUSTRY_SOURCES = new Set(['travel-today', 'travelinc-memo', 'tourism-new-zealand-news'])

async function loadRelevanceTerms(clientId: string): Promise<string[]> {
  const [brief, keywords] = await Promise.all([
    db.from('master_briefs').select('products').eq('client_id', clientId).or('status.eq.active,is_active.eq.true').order('version', { ascending: false }).limit(1).maybeSingle(),
    getClientKeywords(clientId, 100, { strict: true }),
  ])
  if (brief.error) throw new Error('client_product_scope_read_failed')
  const scope = deriveTravelScope(normalizeOperatingProducts(brief.data?.products), keywords.keywords)
  return travelMarketTerms(scope.market_ids)
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function queryList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map(item => item.trim()).slice(0, 10)
}

/** Admin-only bounded entry point for non-competitor WI channels. */
export async function POST(req: Request, { params }: Context) {
  const { id } = await params
  const access = await requirePaidClientAccess(id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  if (access.role !== 'admin') return NextResponse.json({ error: 'Administrator required' }, { status: 403 })
  if (!allowedClient(id)) return NextResponse.json({ error: 'Client is not enabled for Web Intelligence.' }, { status: 403 })

  try {
    const body = await req.json() as ExternalRequest
    const sourceId = text(body.source_id)
    if (!sourceId) return NextResponse.json({ error: 'source_id is required.' }, { status: 400 })
    const observedAt = new Date().toISOString()
    const maxResults = typeof body.max_results === 'number' && Number.isFinite(body.max_results)
      ? Math.min(Math.max(Math.floor(body.max_results), 1), 50)
      : 25

    const siteUrl = text(body.site_url) ?? sourceDefaultUrls(sourceId)[0]
    const relevanceTerms = INDUSTRY_SOURCES.has(sourceId) ? await loadRelevanceTerms(id) : []
    if (INDUSTRY_SOURCES.has(sourceId) && !relevanceTerms.length) return NextResponse.json({ error: '当前客户没有可确认的目的地范围，暂不读取行业媒体。' }, { status: 422 })
    const collection = INDUSTRY_SOURCES.has(sourceId)
      ? await collectAndRecordExternalObservations({
        sourceId, clientId: id, observedAt,
        actorId: 'automation-lab/news-article-extractor',
        actorInput: { startUrls: siteUrl ? [siteUrl] : [], maxArticles: Math.max(maxResults, 50), extractFullContent: true, includeImages: false },
        relevanceTerms,
      })
      : sourceId === 'seek-nz'
        ? await collectAndRecordExternalObservations({
          sourceId, clientId: id, observedAt,
          actorId: 'vewdUX0xT82kKEPPd',
          actorInput: { searchQueries: queryList(body.queries), siteKey: 'NZ-Main', where: text(body.location) ?? 'All New Zealand', maxItems: maxResults, includeDescriptions: true },
          enrich: analyzeJobSignals,
        })
        : null

    if (!collection) return NextResponse.json({ error: 'This external source is not enabled yet.' }, { status: 400 })
    return NextResponse.json({
      ok: !collection.error && collection.writeFailures === 0,
      source_id: sourceId,
      returned: collection.observations.length + collection.rejected,
      persisted: collection.persisted,
      duplicates: collection.duplicates,
      rejected: collection.rejected,
      filtered: collection.filtered,
      write_failures: collection.writeFailures,
      run_id: collection.runId,
      error: collection.error ?? null,
    }, { status: collection.error || collection.writeFailures > 0 ? 502 : 200 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'External intelligence collection failed.' }, { status: 502 })
  }
}
