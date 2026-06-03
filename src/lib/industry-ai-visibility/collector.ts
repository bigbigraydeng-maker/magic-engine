/**
 * Industry AI Visibility — collector.
 *
 * Given a Question + a Platform, runs the platform and returns a structured
 * CollectionResult. Pure function over (question, platform) — no DB writes
 * here; persistence is handled by the orchestrator.
 *
 * Platforms covered today:
 *   - chatgpt           — OpenAI gpt-4o-mini via existing CF AI Gateway wrapper
 *   - google_ai_overview + google_serp — single DataForSEO SERP call returns BOTH
 *                                        (so we save cost by reusing one fetch)
 *
 * Future platforms (xiaohongshu via Apify) extend this same interface.
 */

import { getOpenAIClient } from '@/lib/ai/openai-client'
import { parseRanking } from '@/lib/ai-tracker/parser'
import { getSerpPage } from '@/lib/dataforseo/serp'
import { supabaseAdmin } from '@/lib/supabase'
import { extractDomainBrandsFromOrganic } from './domain-normalise'
import { standardiseBrandList } from './brand-standardiser'
import type {
  CollectionResult,
  Platform,
  Question,
} from './types'

// ─── ChatGPT pricing (gpt-4o-mini, per 1M tokens) ────────────────────────────
const CHATGPT_MODEL = 'gpt-4o-mini'
const CHATGPT_PRICE_INPUT_PER_M  = 0.15
const CHATGPT_PRICE_OUTPUT_PER_M = 0.60

const DATAFORSEO_COST_PER_CALL = 0.005  // empirical, matches DfSEO docs

// Asking ChatGPT a buyer-intent question — we want a realistic "consumer
// asking ChatGPT for recommendations" answer, NOT a meta-analysis.
const CHATGPT_SYSTEM_PROMPT = `You are a helpful AI assistant answering a consumer's question.
Provide a concrete, useful answer with specific company or business names where appropriate.
Do not give meta-commentary about how to search. Answer as you would normally.`

// ─── Helpers ─────────────────────────────────────────────────────────────────

function emptyResult(platform: Platform, model: string): Omit<CollectionResult, 'ok' | 'error_code' | 'error_message'> {
  return {
    raw_response: null,
    brands_mentioned: [],
    top3_brands: [],
    ai_answer_text: platform === 'google_serp' ? null : null,
    ai_citation_sources: null,
    serp_organic_top10: null,
    serp_local_pack: null,
    serp_paid_domains: null,
    serp_people_also_ask: null,
    model_version: model,
    tokens_used: null,
    cost_usd: 0,
    parse_confidence: null,
  }
}

// ─── ChatGPT platform ────────────────────────────────────────────────────────

export async function collectChatGPT(question: Question): Promise<CollectionResult> {
  const base = emptyResult('chatgpt', CHATGPT_MODEL)

  try {
    const client = getOpenAIClient()
    const completion = await client.chat.completions.create({
      model: CHATGPT_MODEL,
      max_tokens: 800,
      messages: [
        { role: 'system', content: CHATGPT_SYSTEM_PROMPT },
        { role: 'user',   content: question.question_text },
      ],
    })

    const answer = completion.choices[0]?.message?.content ?? ''
    const inputTok  = completion.usage?.prompt_tokens     ?? 0
    const outputTok = completion.usage?.completion_tokens ?? 0
    const callCost  =
      (inputTok / 1_000_000) * CHATGPT_PRICE_INPUT_PER_M +
      (outputTok / 1_000_000) * CHATGPT_PRICE_OUTPUT_PER_M

    // Reuse existing parser. For industry-level we don't have a single
    // "client brand" — pass an empty string and ignore client_brand_rank.
    const parsed = await parseRanking({ rawResponse: answer, clientBrandName: '___NONE___' })

    const brands = parsed.brands.map(b => b.brand)
    const top3 = parsed.brands
      .filter(b => b.rank > 0)
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 3)
      .map(b => b.brand)

    return {
      ...base,
      ok: true,
      raw_response: { completion } as unknown as Record<string, unknown>,
      brands_mentioned: brands,
      top3_brands: top3,
      ai_answer_text: answer,
      ai_citation_sources: [],
      tokens_used: inputTok + outputTok,
      cost_usd: callCost + parsed.parse_cost_usd,
      parse_confidence: brands.length > 0 ? 1 : 0,
      error_code: null,
      error_message: null,
    }
  } catch (err) {
    return {
      ...base,
      ok: false,
      error_code: 'chatgpt_error',
      error_message: err instanceof Error ? err.message : String(err),
    }
  }
}

// ─── DataForSEO: returns BOTH google_ai_overview AND google_serp in one call ─

interface SerpPair {
  google_ai_overview: CollectionResult
  google_serp:        CollectionResult
}

async function collectDataForSeoPair(question: Question): Promise<SerpPair> {
  const country = (question.country ?? 'au') as 'au' | 'nz'
  const aiBase   = emptyResult('google_ai_overview', 'dataforseo-serp-advanced')
  const serpBase = emptyResult('google_serp',        'dataforseo-serp-advanced')

  // C1+C2 fix: forward city + language to DataForSEO instead of silently
  // dropping them. Without this, city questions get country-level SERP and
  // zh questions get English-locale SERP — both errors would be permanently
  // locked into the time series by locked_at on first successful collection.
  const language = question.language === 'zh' ? 'zh-CN' : 'en'

  try {
    const serp = await getSerpPage(question.question_text, country, {
      city: question.city,
      language,
    })
    const half = DATAFORSEO_COST_PER_CALL / 2  // amortize one API call across two snapshot rows

    // ─── google_ai_overview snapshot ───
    // B-2 fix: when Google did not return an AI Overview block (very common
    // for commercial queries), record it as a structured non-error condition
    // ('no_ai_overview'). The UI now distinguishes "AI Overview did not
    // appear" from "AI Overview appeared but mentioned no brands", which
    // were previously indistinguishable empty arrays.
    let aiResult: CollectionResult
    if (!serp.ai_overview_text) {
      aiResult = {
        ...aiBase,
        ok: true,                            // still a successful collection
        raw_response: { ai_overview_text: null, sources: serp.ai_overview_sources } as unknown as Record<string, unknown>,
        brands_mentioned: [],
        top3_brands: [],
        ai_answer_text: null,
        ai_citation_sources: serp.ai_overview_sources,
        tokens_used: null,
        cost_usd: half,
        parse_confidence: null,
        error_code: 'no_ai_overview',
        error_message: 'Google did not surface an AI Overview for this query',
      }
    } else {
      const parsed = await parseRanking({
        rawResponse: serp.ai_overview_text,
        clientBrandName: '___NONE___',
      })
      const aiBrands = parsed.brands.map(b => b.brand)
      const aiTop3 = parsed.brands
        .filter(b => b.rank > 0)
        .sort((a, b) => a.rank - b.rank)
        .slice(0, 3)
        .map(b => b.brand)

      aiResult = {
        ...aiBase,
        ok: true,
        raw_response: { ai_overview_text: serp.ai_overview_text, sources: serp.ai_overview_sources } as unknown as Record<string, unknown>,
        brands_mentioned: aiBrands,
        top3_brands: aiTop3,
        ai_answer_text: serp.ai_overview_text,
        ai_citation_sources: serp.ai_overview_sources,
        tokens_used: null,
        cost_usd: half + parsed.parse_cost_usd,
        parse_confidence: aiBrands.length > 0 ? 1 : 0,
        error_code: null,
        error_message: null,
      }
    }

    // ─── google_serp snapshot ───
    // B-3 fix: previously `organic_results.title` was stored verbatim, which
    // surfaced SEO article titles ("Best Small Group Tours | Intrepid Travel AU")
    // as if they were brands. New pipeline:
    //   1. local_pack.name  (Google Maps merchant names — already real brands)
    //   2. domain-normalise organic URLs ("ctstours.co.nz" → "ctstours")
    //   3. LLM-standardise the merged list ("ctstours" → "CTS Tours"),
    //      cached per (industry_code, raw) to avoid repeated LLM calls.
    const serpBrandsFromLocalPack = (serp.local_pack ?? [])
      .map(lp => lp.name)
      .filter(Boolean)
    const serpBrandsFromDomains = extractDomainBrandsFromOrganic(serp.organic_results)
    const rawSerpCandidates = [...serpBrandsFromLocalPack, ...serpBrandsFromDomains]

    const standardised = await standardiseBrandList(rawSerpCandidates, {
      supabase: supabaseAdmin,
      industryCode: question.industry_code,
    })

    const serpResult: CollectionResult = {
      ...serpBase,
      ok: true,
      raw_response: serp as unknown as Record<string, unknown>,
      brands_mentioned: standardised.brands,
      top3_brands: standardised.brands.slice(0, 3),
      ai_answer_text: null,
      ai_citation_sources: null,
      serp_organic_top10: serp.organic_results,
      serp_local_pack: serp.local_pack ?? null,
      serp_paid_domains: serp.paid_advertiser_domains,
      serp_people_also_ask: serp.people_also_ask ?? null,
      tokens_used: null,
      cost_usd: half + standardised.total_cost_usd,
      parse_confidence: standardised.brands.length > 0 ? 1 : 0,
      error_code: null,
      error_message: null,
    }

    return { google_ai_overview: aiResult, google_serp: serpResult }
  } catch (err) {
    const errCode = 'dataforseo_error'
    const errMsg  = err instanceof Error ? err.message : String(err)
    return {
      google_ai_overview: { ...aiBase, ok: false, error_code: errCode, error_message: errMsg },
      google_serp:        { ...serpBase, ok: false, error_code: errCode, error_message: errMsg },
    }
  }
}

// ─── Public surface ──────────────────────────────────────────────────────────

/**
 * Run a single (question, platform). For DataForSEO platforms, call
 * collectQuestionAllDataForSeo instead — it returns both AI Overview and
 * SERP from a single API call (saves money).
 */
export async function collectQuestion(
  question: Question,
  platform: Platform,
): Promise<CollectionResult> {
  switch (platform) {
    case 'chatgpt':
      return collectChatGPT(question)

    case 'google_ai_overview': {
      const { google_ai_overview } = await collectDataForSeoPair(question)
      return google_ai_overview
    }

    case 'google_serp': {
      const { google_serp } = await collectDataForSeoPair(question)
      return google_serp
    }

    case 'xiaohongshu':
      // Future — needs Apify rednote actor + xhs cookie management
      return {
        ...emptyResult('xiaohongshu', 'apify-rednote'),
        ok: false,
        error_code: 'not_implemented',
        error_message: 'Xiaohongshu collector not yet implemented',
      }

    default: {
      const exhaustive: never = platform
      throw new Error(`Unknown platform: ${exhaustive as string}`)
    }
  }
}

/**
 * Efficient combo: one DataForSEO call yields both AI Overview + SERP rows.
 * Use this from the orchestrator instead of two separate collectQuestion calls.
 */
export async function collectQuestionGooglePair(
  question: Question,
): Promise<SerpPair> {
  return collectDataForSeoPair(question)
}
