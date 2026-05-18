/**
 * Master Brief generation pipeline.
 *
 * Orchestrates:
 * 1. Parallel: Jina website scrape + file downloads + SEMrush domain snapshot
 * 2. Claude generation with combined context
 * 3. JSON parse with retry
 * 4. INSERT into master_briefs (draft status)
 *
 * Called by POST /api/clients/[id]/brief/generate
 */

import { fetchMultipleUrls } from './jina'
import { downloadBriefFile } from './storage'
import { getDomainOverviewSnapshot } from '../semrush/client'
import { callClaudeWithDocs, parseJsonResponse, MODEL_SONNET } from '../anthropic/client'
import type { ClaudeDocInput } from '../anthropic/client'
import { buildBriefUserMessage, BRIEF_SYSTEM_PROMPT } from './prompts'
import { supabaseAdmin } from '../supabase'
import type { MasterBrief } from '@/types/magic-engine'

export interface PipelineInput {
  clientId: string
  websiteUrls: string[]       // max 5
  storagePaths: string[]      // Supabase Storage paths, already uploaded
  domain?: string             // for SEMrush lookup
  // Visual DNA overrides — if supplied, take precedence over AI-inferred vi_* fields
  visualStyle?: string
  brandColors?: string[]
  visualAvoid?: string[]
  // P8.11.F.1: discovery-derived anchors. When present, they OVERRIDE the
  // Claude-inferred keyword_seeds / competitor_domains so high-confidence
  // 张骞 output isn't lost in regeneration.
  seedKeywords?: string[]
  competitorDomains?: string[]
}

export interface PipelineResult {
  success: boolean
  briefId?: string
  brief?: MasterBrief
  inputTokens?: number
  costUsd?: number
  error?: string
  warnings?: string[]         // non-fatal issues (e.g. jina partial failure)
}

// Max number of tokens for the brief generation response
const MAX_OUTPUT_TOKENS = 8096

/**
 * Run the full Master Brief generation pipeline.
 * This is designed to be called from an API route; it may take 30–120 seconds.
 */
export async function runBriefPipeline(input: PipelineInput): Promise<PipelineResult> {
  const warnings: string[] = []

  // ── 1. Parallel data collection ──────────────────────────────────────────────
  const [jinaResult, filesResult, semrushResult] = await Promise.allSettled([
    fetchMultipleUrls(input.websiteUrls),
    downloadFiles(input.storagePaths),
    input.domain
      ? getDomainOverviewSnapshot(input.domain)
      : Promise.resolve(null),
  ])

  // Collect website pages
  const websitePages = jinaResult.status === 'fulfilled' ? jinaResult.value.results : []
  if (jinaResult.status === 'fulfilled' && jinaResult.value.errors.length > 0) {
    warnings.push(
      `Jina fetch errors: ${jinaResult.value.errors.map(e => `${e.url}: ${e.error}`).join('; ')}`
    )
  }
  if (jinaResult.status === 'rejected') {
    warnings.push(`Website scraping failed: ${jinaResult.reason?.message ?? 'unknown'}`)
  }

  // Collect document buffers
  const docs: ClaudeDocInput[] = []
  if (filesResult.status === 'fulfilled') {
    for (const { path, buffer, contentType } of filesResult.value) {
      const filename = path.split('/').pop() ?? path
      if (contentType === 'application/pdf') {
        docs.push({
          type: 'pdf',
          content: buffer.toString('base64'),
          filename,
        })
      } else {
        // text/plain, .docx text extraction (treat as text blob)
        docs.push({
          type: 'text',
          content: buffer.toString('utf-8'),
          filename,
        })
      }
    }
  } else if (filesResult.status === 'rejected') {
    warnings.push(`File download errors: ${filesResult.reason?.message ?? 'unknown'}`)
  }

  // SEMrush snapshot
  const semrushSnapshot = semrushResult.status === 'fulfilled' ? semrushResult.value : null
  if (semrushResult.status === 'rejected') {
    warnings.push(`SEMrush snapshot failed: ${semrushResult.reason?.message ?? 'unknown'}`)
  }

  // Safety check: need at least one data source
  const hasData = websitePages.length > 0 || docs.length > 0 || semrushSnapshot !== null
  if (!hasData) {
    return {
      success: false,
      error: 'No data sources available — all of website scraping, file download, and SEMrush failed.',
      warnings,
    }
  }

  // ── 2. Build Claude prompt ────────────────────────────────────────────────────
  const userMessage = buildBriefUserMessage({
    websitePages,
    semrushSnapshot,
    domain: input.domain,
    discoverySeedKeywords: input.seedKeywords,
    discoveryCompetitorDomains: input.competitorDomains,
  })

  // ── 3. Call Claude ────────────────────────────────────────────────────────────
  let claudeResult
  try {
    claudeResult = await callClaudeWithDocs({
      systemPrompt: BRIEF_SYSTEM_PROMPT,
      userMessage,
      docs,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    })
  } catch (err) {
    return {
      success: false,
      error: `Claude API error: ${(err as Error).message}`,
      warnings,
    }
  }

  // ── 4. Parse JSON response ────────────────────────────────────────────────────
  let briefData: Partial<MasterBrief>
  try {
    briefData = parseJsonResponse<Partial<MasterBrief>>(claudeResult.text)
  } catch {
    // Retry with extraction hint
    try {
      const jsonMatch = claudeResult.text.match(/\{[\s\S]+\}/)
      if (!jsonMatch) throw new Error('No JSON found in response')
      briefData = JSON.parse(jsonMatch[0]) as Partial<MasterBrief>
    } catch {
      return {
        success: false,
        error: 'Claude returned invalid JSON. Please try again.',
        warnings,
      }
    }
  }

  // ── 5. Insert into Supabase ───────────────────────────────────────────────────
  const insertPayload = {
    client_id: input.clientId,
    status: 'draft' as const,
    version: 1,
    // Structured AI fields
    brand_name: briefData.brand_name ?? null,
    core_proposition: briefData.core_proposition ?? null,
    content_pillars: briefData.content_pillars ?? null,
    brand_voice: briefData.brand_voice ?? null,
    target_audience: briefData.target_audience ?? null,
    platform_strategy: briefData.platform_strategy ?? null,
    // Discovery-supplied anchors take precedence over Claude-inferred values
    keyword_seeds: input.seedKeywords?.length
      ? input.seedKeywords
      : (briefData.keyword_seeds ?? null),
    competitor_domains: input.competitorDomains?.length
      ? input.competitorDomains
      : (briefData.competitor_domains ?? null),
    // User-supplied visual DNA takes precedence over AI-inferred fields
    vi_colors: input.brandColors?.length
      ? { primary: input.brandColors[0], secondary: input.brandColors[1], accent: input.brandColors[2] }
      : (briefData.vi_colors ?? null),
    vi_style_keywords: input.visualStyle
      ? input.visualStyle.split(',').map(s => s.trim()).filter(Boolean)
      : (briefData.vi_style_keywords ?? null),
    vi_dos: briefData.vi_dos ?? null,
    vi_donts: input.visualAvoid?.length
      ? input.visualAvoid
      : (briefData.vi_donts ?? null),
    brand_story_md: briefData.brand_story_md ?? null,
    style_guide_md: briefData.style_guide_md ?? null,
    competitive_notes_md: briefData.competitive_notes_md ?? null,
    // Source tracking
    source_website_urls: input.websiteUrls.length > 0 ? input.websiteUrls : null,
    source_file_urls: input.storagePaths.length > 0 ? input.storagePaths : null,
    semrush_snapshot: semrushSnapshot
      ? {
          top_keywords: semrushSnapshot.top_keywords,
          competitor_domains: semrushSnapshot.competitor_domains,
        }
      : null,
    // Generation metadata
    generated_by: 'claude',
    input_tokens: claudeResult.input_tokens + claudeResult.output_tokens,
    model_used: MODEL_SONNET,
  }

  const { data: inserted, error: dbError } = await supabaseAdmin
    .from('master_briefs')
    .insert(insertPayload)
    .select()
    .single()

  if (dbError || !inserted) {
    return {
      success: false,
      error: `Database insert failed: ${dbError?.message ?? 'unknown'}`,
      warnings,
    }
  }

  return {
    success: true,
    briefId: inserted.id,
    brief: inserted as MasterBrief,
    inputTokens: claudeResult.input_tokens + claudeResult.output_tokens,
    costUsd: claudeResult.cost_usd,
    warnings: warnings.length > 0 ? warnings : undefined,
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface DownloadedFile {
  path: string
  buffer: Buffer
  contentType: string
}

/**
 * Download multiple files from Supabase Storage.
 * Uses parallel requests; individual failures are logged but don't block.
 */
async function downloadFiles(storagePaths: string[]): Promise<DownloadedFile[]> {
  if (storagePaths.length === 0) return []

  const results = await Promise.allSettled(
    storagePaths.map(async (path): Promise<DownloadedFile> => {
      const buffer = await downloadBriefFile(path)
      const ext = path.split('.').pop()?.toLowerCase() ?? ''
      const contentType = guessContentType(ext)
      return { path, buffer, contentType }
    })
  )

  return results
    .filter((r): r is PromiseFulfilledResult<DownloadedFile> => r.status === 'fulfilled')
    .map(r => r.value)
}

function guessContentType(ext: string): string {
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    txt: 'text/plain',
    md: 'text/plain',
  }
  return map[ext] ?? 'text/plain'
}
