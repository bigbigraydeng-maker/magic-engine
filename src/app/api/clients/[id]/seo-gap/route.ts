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
import { requireBearerToken } from '@/lib/validation-utils'
import { getSerpCompetitors, getKeywordsGap } from '@/lib/dataforseo/labs'
import type { LabsKeyword } from '@/lib/dataforseo/labs'
import { analyzeSeoGap } from '@/lib/seo-gap/analyzer'
import { generateSeoGapDocx } from '@/lib/seo-gap/docx-generator'
import type { ParsedKeyword } from '@/lib/seo-gap/csv-parser'

const LOCATION_CODE_BY_DB: Record<string, number> = { au: 2036, nz: 2554 }

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
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('seo_analyses')
      .select('id, title, csv_count, competitor_count, total_keywords, b2c_keywords, cost_usd, status, report_url, created_at')
      .eq('client_id', params.id)
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
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  const clientId = params.id
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
      return NextResponse.json({ success: false, error: 'Failed to create analysis record' }, { status: 500 })
    }

    analysisId = record.id

    // ── 4. Fetch competitors + keyword gap from DataForSEO ────────────────────
    const serpCompetitors = await getSerpCompetitors(client.domain, locationCode, 5)
    const competitorDomains = serpCompetitors.slice(0, 3).map(c => c.domain)

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
