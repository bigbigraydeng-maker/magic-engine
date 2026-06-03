/**
 * Shared library for generating social media suggestions from an approved
 * blog post.  Called by:
 *   - POST /api/clients/[id]/blog/[postId]/social-suggestions  (the public
 *     endpoint, gated by requireBearerToken for server-to-server use)
 *   - PATCH /api/clients/[id]/blog/[postId]                    (fire-and-forget
 *     direct invocation when a post is approved — no internal HTTP self-call)
 *
 * This file replaces the internal HTTP self-call pattern that PR #297 root-
 * caused on zhangqian/connectors: previously the PATCH route fetched the
 * social-suggestions endpoint with Authorization: Bearer INTERNAL_API_KEY,
 * which silently 401'd whenever the env var was missing on Render.  Both
 * routes now share this in-process function.
 *
 * Reference: ROADMAP.md QA-清理-1 (post PR #297 cleanup)
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getAnthropicClient, MODEL_SONNET } from '@/lib/anthropic/client'
import type { StrategyItem } from '@/lib/strategy/types'

// ---------------------------------------------------------------------------
// Custom error type — lets the wrapper route translate failures into HTTP
// status codes (404 / 403 / 500) without leaking lib internals.
// ---------------------------------------------------------------------------

export class GenerateSocialSuggestionsError extends Error {
  constructor(public readonly status: 404 | 403 | 500, message: string) {
    super(message)
    this.name = 'GenerateSocialSuggestionsError'
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SuggestionRaw {
  platform: string
  proposed_title: string
  rationale: string
  content_angle: string
}

type Platform = 'facebook' | 'instagram' | 'linkedin'

export interface GenerateSocialSuggestionsResult {
  items: StrategyItem[]
}

// ---------------------------------------------------------------------------
// Prompt builder + parser — exported for testability.
// ---------------------------------------------------------------------------

export function buildSocialSuggestionsPrompt(title: string, keyword: string): string {
  return `You are a social media strategist for an AU/NZ marketing agency.
A blog post titled "${title}" (primary keyword: "${keyword}") has just been approved.
Generate 3 social media content ideas — one for Facebook, Instagram, and LinkedIn.
Facebook: community-focused, longer-form, NZ/AU audience.
Instagram: visual, punchy hook, concise caption idea.
LinkedIn: professional insight angle, B2B-friendly.
For each: proposed_title (max 80 chars), rationale (1-2 sentences), content_angle (1 sentence).
Use Australian/New Zealand English. Return JSON array only, no extra text.`
}

/** Extract the outermost JSON array from a Claude response string. */
export function parseArrayResponse(text: string): SuggestionRaw[] {
  const trimmed = text.trim()
  const start = trimmed.indexOf('[')
  const end = trimmed.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`No JSON array found in response. Preview: ${trimmed.slice(0, 300)}`)
  }
  return JSON.parse(trimmed.slice(start, end + 1)) as SuggestionRaw[]
}

// ---------------------------------------------------------------------------
// Main entry — generate + persist social suggestions for an approved blog post.
// Throws GenerateSocialSuggestionsError on any expected failure (404 / 403 /
// 500).  Caller is responsible for wrapping in try/catch and mapping to HTTP.
// ---------------------------------------------------------------------------

export async function generateSocialSuggestions(
  supabase: SupabaseClient,
  clientId: string,
  postId: string,
): Promise<GenerateSocialSuggestionsResult> {
  // 1. Verify blog post exists and belongs to this client
  const { data: post, error: postError } = await supabase
    .from('blog_posts')
    .select('id, title, primary_keyword, client_id')
    .eq('id', postId)
    .single()

  if (postError || !post) {
    if (postError) console.error('[generate-social-suggestions] Supabase fetch error:', postError)
    throw new GenerateSocialSuggestionsError(404, 'Blog post not found')
  }

  if (post.client_id !== clientId) {
    throw new GenerateSocialSuggestionsError(403, 'Forbidden')
  }

  const title = (post.title as string) ?? 'Untitled'
  const keyword = (post.primary_keyword as string) ?? title

  // 2. Call Anthropic — client initialised inside function per CLAUDE.md
  const anthropic = getAnthropicClient()
  const message = await anthropic.messages.create({
    model: MODEL_SONNET,
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: buildSocialSuggestionsPrompt(title, keyword),
      },
    ],
  })

  const rawText = message.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join('')

  let suggestions: SuggestionRaw[]
  try {
    suggestions = parseArrayResponse(rawText)
  } catch (parseErr) {
    console.error('[generate-social-suggestions] JSON parse error:', parseErr, 'Raw:', rawText.slice(0, 500))
    throw new GenerateSocialSuggestionsError(500, 'Failed to parse AI response')
  }

  // 3. Build content_strategy_items rows (best-effort — use first 3 valid)
  const strategyRunId = crypto.randomUUID()
  const rows = suggestions
    .filter((s): s is SuggestionRaw =>
      typeof s.platform === 'string' &&
      typeof s.proposed_title === 'string' &&
      typeof s.rationale === 'string' &&
      typeof s.content_angle === 'string'
    )
    .slice(0, 3)
    .map(s => {
      const platform = (s.platform.toLowerCase() as Platform)
      return {
        action_type: 'social_content' as const,
        content_mode: 'unified' as const,
        status: 'pending' as const,
        priority: 'medium' as const,
        priority_score: 50,
        linked_blog_post_id: postId,
        client_id: clientId,
        strategy_run_id: strategyRunId,
        proposed_title: s.proposed_title.slice(0, 80),
        rationale: `${platform.toUpperCase()}: ${s.rationale}`,
        content_angle: s.content_angle,
        source_page_id: null,
        source_query_id: null,
        source_keyword: null,
        keyword_volume: null,
        keyword_kd: null,
      }
    })

  if (rows.length === 0) {
    console.error('[generate-social-suggestions] No valid suggestions parsed from AI response')
    throw new GenerateSocialSuggestionsError(500, 'AI returned no valid suggestions')
  }

  // 4. Persist
  const { data: inserted, error: insertError } = await supabase
    .from('content_strategy_items')
    .insert(rows)
    .select('*')

  if (insertError) {
    console.error('[generate-social-suggestions] Supabase insert error:', insertError)
    throw new GenerateSocialSuggestionsError(500, 'Failed to save strategy items')
  }

  return { items: (inserted ?? []) as StrategyItem[] }
}
