import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireBearerToken } from '@/lib/validation-utils'
import {
  GenerateSocialSuggestionsError,
  generateSocialSuggestions,
} from '@/lib/blog/generate-social-suggestions'

/**
 * POST /api/clients/[id]/blog/[postId]/social-suggestions
 * Generates 3 social media content ideas (Facebook / Instagram / LinkedIn)
 * from an approved blog post and writes them to content_strategy_items.
 *
 * Thin wrapper around the shared `generateSocialSuggestions` lib.  The PATCH
 * route on /blog/[postId] calls the lib directly (see QA-清理-1).  This HTTP
 * endpoint remains for explicit server-to-server invocation only.
 *
 * Security: requires Bearer INTERNAL_API_KEY.
 * Reference: ROADMAP.md P8.2.4, QA-清理-1
 */

export const maxDuration = 60

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; postId: string } }
) {
  const auth = requireBearerToken(req.headers.get('authorization') ?? undefined)
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  try {
    const { id: clientId, postId } = params
    const result = await generateSocialSuggestions(supabaseAdmin, clientId, postId)
    return NextResponse.json({ success: true, items: result.items })
  } catch (err: unknown) {
    if (err instanceof GenerateSocialSuggestionsError) {
      return NextResponse.json({ success: false, error: err.message }, { status: err.status })
    }
    console.error('[social-suggestions POST] Unexpected error:', err)
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}
