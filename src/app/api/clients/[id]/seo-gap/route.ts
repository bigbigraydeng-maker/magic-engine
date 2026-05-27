/**
 * POST /api/clients/[id]/seo-gap
 *   JSON body: { title?: string }
 *   Auto-fetches keyword gap via DataForSEO (no CSV upload required)
 *   Pipeline: getSerpCompetitors → getKeywordsGap → analyzeSeoGap → DOCX
 *   Returns: { success, analysis_id, summary, docx_base64 }
 *
 * GET /api/clients/[id]/seo-gap
 *   Returns list of previous analyses for this client.
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { getSerpCompetitors, getKeywordsGap } from '@/lib/dataforseo/labs'
import type { LabsKeyword } from '@/lib/dataforseo/labs'
import { analyzeSeoGap } from '@/lib/seo-gap/analyzer'
import { generateSeoGapDocx } from '@/lib/seo-gap/docx-generator'
import type { ParsedKeyword } from '@/lib/seo-gap/csv-parser'
import { getActiveBrief } from '@/lib/content/brief-injector'

const LOCATION_CODE_BY_DB: Record<string, number> = { au: 2036, nz: 2554 }

const GENERIC_DOMAIN_BLOCKLIST = new Set([
  'facebook.com', 'instagram.com', 'youtube.com', 'twitter.com', 'x.com',
  'reddit.com', 'linkedin.com', 'pinterest.com', 'tiktok.com', 'snapchat.com',
  'google.com', 'google.com.au', 'google.co.nz',
  'wikipedia.org', 'wikimedia.org',
  'amazon.com', 'amazon.com.au', 'ebay.com', 'ebay.com.au',
  'yelp.com', 'trustpilot.com', 'glassdoor.com',
  'apple.com', 'microsoft.com',
  // Travel aggregators — high-DA sites that co-rank on travel terms but are not direct competitors
  'tripadvisor.com', 'tripadvisor.com.au', 'tripadvisor.co.nz',
  'booking.com', 'expedia.com', 'expedia.com.au', 'expedia.co.nz',
  'hotels.com', 'agoda.com', 'airbnb.com', 'hostelworld.com',
])

interface ClientRow {
  id: string
  name: string
  domain: string | null
  semrush_db: string | null
}

function labsKeywordToParsed(kw: LabsKeyword, competitorDomains: string[]): ParsedKeyword {
  return {
    keyword: kw.keyword,
    volume: kw.search_volume ?? 0,
    kd: kw.keyword_difficulty ?? 0,
    cpc: kw.cpc ?? 0,
    intent: kw.intent,
    competitors: competitorDomains,
  }
}

// ─── GET: List analyses ───────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('seo_analyses')
      .select('id, title, csv_count, competitor_count, total_keywords, b2c_keywords, cost_usd, status, report_url, created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) {
      console.error('[seo-gap GET]', error)
      return NextResponse.json({ success: false, error: 'Failed to list analyses' }, { status: 500 })
    }

    return NextResponse.json({ success: true, analyses: data ?? [] })
  } catch (err) {
    console.error('[seo-gap GET] unexpected', err)
    return NextResponse.json({ success: false, error: 'Unexpected error' }, { status: 500 })
  }
}

// ─── POST: Run analysis pipeline ─────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  let analysisId: string | null = null

  try {
    // ── 1. Load client ────────────────────────────────────────────────────────
    const { data: client } = await supabaseAdmin
      .from('clients')
      .select('id, name, domain, semrush_db')
      .eq('id', clientId)
      .single<ClientRow>()

    if (!client) {
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 })
    }

    if (!client.domain) {
      return NextResponse.json({ success: false, error: 'Client has no domain configured' }, { status: 400 })
    }

    // ── 2. Parse request body ─────────────────────────────────────────────────
    const body = await req.json().catch(() => ({})) as { title?: string }
    const title = body.title ?? 'SEO Gap Analysis'
    const locationCode = LOCATION_CODE_BY_DB[client.semrush_db ?? 'au'] ?? LOCATION_CODE_BY_DB.au

    // ── 3. Create pending DB record ───────────────────────────────────────────
    const { data: record, error: insertErr } = await supabaseAdmin
      .from('seo_analyses')
      .insert({
        client_id: clientId,
        title,
        csv_count: 0,
        status: 'processing',
      })
      .select('id')
      .single()

    if (insertErr || !record) {
      console.error('[seo-gap POST] insert error', insertErr)
      const detail = insertErr?.message ?? 'no record returned'
      return NextResponse.json({ success: false, error: `Failed to create analysis record: ${detail}` }, { status: 500 })
    }

    analysisId = record.id

    // ── 4. Determine competitors (priority: active brief → filtered DataForSEO)
    const activeBrief = await getActiveBrief(clientId)
    const knownDomains: string[] = ((activeBrief?.competitor_domains as string[] | null) ?? [])
      .map(d => d.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase())

    let competitorDomains: string[]
    if (knownDomains.length >= 3) {
      // Skip SERP call — enough known competitors in active brief
      competitorDomains = knownDomains.filter(d => !GENERIC_DOMAIN_BLOCKLIST.has(d)).slice(0, 3)
    } else {
      const rawSerp = await getSerpCompetitors(client.domain, locationCode, 20)
      const filteredSerp = rawSerp.filter(c => !GENERIC_DOMAIN_BLOCKLIST.has(c.domain))
      const knownFiltered = knownDomains.filter(d => !GENERIC_DOMAIN_BLOCKLIST.has(d))
      const knownSet = new Set(knownFiltered)
      const extras = filteredSerp
        .filter(c => !knownSet.has(c.domain))
        .slice(0, Math.max(0, 3 - knownFiltered.length))
      competitorDomains = [...knownFiltered, ...extras.map(c => c.domain)].slice(0, 3)
    }

    const gapKeywords: LabsKeyword[] = competitorDomains.length > 0
      ? await getKeywordsGap(client.domain, competitorDomains, locationCode, 100)
      : []

    if (gapKeywords.length === 0) {
      await failAnalysis(analysisId!, 'No keyword gap data returned from DataForSEO.')
      return NextResponse.json({ success: false, error: 'No gap keywords found' }, { status: 422 })
    }

    const parsedKeywords = gapKeywords.map(kw => labsKeywordToParsed(kw, competitorDomains))

    // ── 5. AI analysis ────────────────────────────────────────────────────────
    const analysis = await analyzeSeoGap({
      rawKeywords: parsedKeywords,
      competitors: competitorDomains,
      clientDomain: client.domain,
      clientName: client.name,
    })

    // ── 6. Generate DOCX ──────────────────────────────────────────────────────
    const reportDate = new Date().toLocaleDateString('en-AU', {
      day: 'numeric', month: 'long', year: 'numeric',
    })
    const docxBuffer = await generateSeoGapDocx(analysis, client.name, reportDate)
    const docxBase64 = docxBuffer.toString('base64')

    // ── 7. Upload DOCX to Supabase Storage ────────────────────────────────────
    const filename = `${clientId}/seo-gap-${analysisId}.docx`
    const bucket = 'reports'

    await supabaseAdmin.storage.createBucket(bucket, { public: false }).catch(() => {})

    await supabaseAdmin.storage.from(bucket).upload(filename, docxBuffer, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      upsert: true,
    })

    const { data: signedData } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUrl(filename, 60 * 60 * 24 * 7) // 7 days

    const reportUrl = signedData?.signedUrl ?? null

    // ── 8. Update DB record ───────────────────────────────────────────────────
    await supabaseAdmin.from('seo_analyses').update({
      status: 'completed',
      competitor_count: analysis.competitors.length,
      total_keywords: analysis.total_keywords_raw,
      b2c_keywords: analysis.total_keywords_b2c,
      analysis_json: analysis as unknown as Record<string, unknown>,
      report_url: reportUrl,
      cost_usd: analysis.cost_usd,
    }).eq('id', analysisId)

    // ── 9. Return response ────────────────────────────────────────────────────
    return NextResponse.json({
      success: true,
      analysis_id: analysisId,
      report_url: reportUrl,
      docx_base64: docxBase64,
      summary: {
        total_keywords_raw:  analysis.total_keywords_raw,
        total_keywords_b2c:  analysis.total_keywords_b2c,
        competitors:         analysis.competitors.length,
        tier_a_count:        analysis.tier_a.length,
        tier_b_count:        analysis.tier_b.length,
        tier_c_count:        analysis.tier_c.length,
        clusters:            analysis.clusters.map(c => ({ name: c.name, volume: c.total_volume })),
        executive_summary:   analysis.ai_insights.executive_summary,
        cost_usd:            analysis.cost_usd,
      },
    })
  } catch (err: unknown) {
    console.error('[seo-gap POST] pipeline error', err)
    if (analysisId) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      await failAnalysis(analysisId, message)
    }
    return NextResponse.json({ success: false, error: 'Analysis pipeline failed' }, { status: 500 })
  }
}

async function failAnalysis(id: string, message: string) {
  await supabaseAdmin
    .from('seo_analyses')
    .update({ status: 'failed', error_message: message.slice(0, 500) })
    .eq('id', id)
}
