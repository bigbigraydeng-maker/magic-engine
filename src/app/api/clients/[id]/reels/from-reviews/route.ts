/**
 * /api/clients/[id]/reels/from-reviews
 *
 * Generate FB Reels scripts from GBP customer reviews and store them as
 * reels_drafts records.
 *
 *   POST → accepts an array of GBP reviews (or fetches them automatically),
 *          generates Seedance-ready scripts via Claude (social_proof angle),
 *          stores each script as a reels_drafts row, returns the draft records.
 *
 * Body (all optional):
 *   reviews?:      GBPReview[]  — if omitted, fetched from GBP API automatically
 *   reels_count?:  number       — max reels to generate (default: all reviews, max 5)
 *
 * Auth: requireDashboardClientAccess
 */

import { type NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { getBusinessReviewDetails } from '@/lib/places/client'
import { generateReelsFromReviews } from '@/lib/social/reviews-to-reels'
import type { GBPReview } from '@/lib/places/client'

interface RouteContext {
  params: { id: string }
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: RouteContext) {
  const clientId = params.id

  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let body: { reviews?: GBPReview[]; reels_count?: number } = {}
  try {
    body = await req.json()
  } catch {
    // empty body is fine — we'll fetch reviews automatically
  }

  // Fetch client record for brand context
  const { data: client, error: clientErr } = await supabaseAdmin
    .from('clients')
    .select('name, city, country, industry')
    .eq('id', clientId)
    .single()

  if (clientErr || !client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  // Resolve reviews — use provided ones or fetch from GBP
  let reviews: GBPReview[] = body.reviews ?? []

  if (reviews.length === 0) {
    if (!process.env.GOOGLE_PLACES_API_KEY) {
      return NextResponse.json(
        { error: 'No reviews provided and GOOGLE_PLACES_API_KEY not configured' },
        { status: 400 },
      )
    }

    const queryParts: string[] = [client.name]
    if (client.city) queryParts.push(client.city)
    if (client.country) queryParts.push(client.country)
    const query = queryParts.join(' ')

    try {
      const details = await getBusinessReviewDetails(query)
      if (!details || details.reviews.length === 0) {
        return NextResponse.json(
          { error: `No GBP reviews found for "${query}"` },
          { status: 404 },
        )
      }
      reviews = details.reviews
    } catch (err) {
      console.error('[reels/from-reviews] GBP fetch error:', err)
      return NextResponse.json(
        { error: 'Failed to fetch GBP reviews' },
        { status: 502 },
      )
    }
  }

  // Limit to reels_count (max 5)
  const limit = Math.min(body.reels_count ?? reviews.length, 5)
  const targetReviews = reviews.slice(0, limit)

  // Generate Reels scripts
  let result
  try {
    result = await generateReelsFromReviews(targetReviews, {
      brandName: client.name,
      industry: client.industry ?? 'tourism',
      city: client.city ?? '',
    })
  } catch (err) {
    console.error('[reels/from-reviews] generation error:', err)
    return NextResponse.json(
      { error: 'Reels generation failed' },
      { status: 500 },
    )
  }

  if (result.reels.length === 0) {
    return NextResponse.json(
      { error: 'No usable reviews (reviews must have ≥20 characters of text)' },
      { status: 422 },
    )
  }

  // Store each script as a reels_draft row
  const draftRows = result.reels.map(reel => ({
    client_id: clientId,
    // opening_frame_prompt: first scene's visual description (for image generation)
    opening_frame_prompt: extractVisualDescription(reel.scene_structure[0] ?? ''),
    // closing_frame_prompt: brand panel description
    closing_frame_prompt: reel.scene_structure[8] ?? '',
    i2v_video_prompt: reel.seedance_i2v_prompt,
    fb_caption: reel.fb_caption,
    status: 'draft' as const,
    // Store full source in chat_history so FDE can see the original review
    chat_history: [
      {
        role: 'assistant',
        content: JSON.stringify({
          type: 'gbp_review_reel',
          source_review: reel.source_review,
          title: reel.title,
          hook_line: reel.hook_line,
          scene_names: reel.scene_names,
          scene_structure: reel.scene_structure,
          style_guide: reel.style_guide,
          hashtags: reel.hashtags,
          generated_at: result.generated_at,
        }),
      },
    ],
  }))

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('reels_drafts')
    .insert(draftRows)
    .select('id, client_id, fb_caption, status, created_at, chat_history')

  if (insertErr) {
    console.error('[reels/from-reviews] insert error:', insertErr)
    return NextResponse.json(
      { error: 'Failed to save reels drafts' },
      { status: 500 },
    )
  }

  return NextResponse.json({
    drafts: inserted,
    count: inserted?.length ?? 0,
    generated_at: result.generated_at,
  })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract the Thumbnail description from a scene_structure string. */
function extractVisualDescription(sceneStr: string): string {
  const thumbnailMatch = sceneStr.match(/Thumbnail:\s*9:16 vertical\s*—\s*([^|]+)/i)
  if (thumbnailMatch) return thumbnailMatch[1].trim()
  // Fallback: take everything before the first pipe
  const firstPipe = sceneStr.indexOf('|')
  return firstPipe > 0 ? sceneStr.slice(0, firstPipe).trim() : sceneStr.trim()
}
