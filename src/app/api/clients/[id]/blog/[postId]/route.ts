import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { countWords } from '@/lib/blog/generator'
import { generateSocialSuggestions } from '@/lib/blog/generate-social-suggestions'
import { sanitizeInternalLinks } from '@/lib/blog/internal-links-sanitize'
import type { BlogPost, BlogStatus } from '@/types/magic-engine'

/**
 * GET /api/clients/[id]/blog/[postId]
 * Full blog post detail (including html_body + geo_html_snapshot).
 *
 * PATCH /api/clients/[id]/blog/[postId]
 * Update mutable fields: status, featured_image_url, slug, and article content
 * (title, meta_title, meta_description, html_body) for manual FDE edits.
 * Body: { status?, featured_image_url?, slug?, title?, meta_title?, meta_description?, html_body? }
 *
 * DELETE /api/clients/[id]/blog/[postId]
 * Permanently remove a blog post.
 *
 * Security: All endpoints require a valid Bearer token (INTERNAL_API_KEY).
 * Error messages returned to callers are generic — DB schema details are
 * only written to server-side logs.
 *
 * Reference: ROADMAP.md P7.3.9–P7.3.10
 */

/** Upper bound on a manually-edited article body (~200 kB) — rejects oversized payloads. */
const MAX_HTML_BODY_CHARS = 200_000

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; postId: string } }
) {
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
    const { postId } = params

    const { data, error } = await supabaseAdmin
      .from('blog_posts')
      .select('*')
      .eq('id', postId)
      .eq('client_id', clientId)   // ownership check
      .single<BlogPost>()

    if (error || !data) {
      // HIGH-3: log DB error details server-side, return generic 404 to caller
      if (error) console.error('[blog/:postId GET] Supabase error:', error)
      return NextResponse.json({ success: false, error: 'Post not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, post: data })
  } catch (err: unknown) {
    console.error('[blog/:postId GET] Unexpected error:', err)
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; postId: string } }
) {
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
    const { postId } = params
    const body = (await req.json()) as {
      status?: BlogStatus
      featured_image_url?: string
      slug?: string
      title?: string
      meta_title?: string
      meta_description?: string
      html_body?: string
      // P12.R.A4 — manual primary_keyword edit (FDE backfill missing focus keyphrase).
      primary_keyword?: string | null
      // P12.R.B10 — Internal Links Panel toggle resolved flag.
      internal_links?: Array<{ anchor: unknown; target_slug: unknown; resolved?: unknown }>
    }

    const VALID_STATUSES: BlogStatus[] = ['draft', 'approved', 'published', 'rejected']
    if (body.status && !VALID_STATUSES.includes(body.status)) {
      return NextResponse.json(
        { success: false, error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` },
        { status: 400 }
      )
    }

    const patch: Record<string, unknown> = {}
    if (body.status !== undefined)             patch.status = body.status
    if (body.featured_image_url !== undefined) patch.featured_image_url = body.featured_image_url
    if (body.slug !== undefined)               patch.slug = body.slug?.slice(0, 120)
    if (body.status === 'published')           patch.published_at = new Date().toISOString()
    // Manual FDE content edits
    if (body.title !== undefined)              patch.title = body.title.slice(0, 200)
    if (body.meta_title !== undefined)         patch.meta_title = body.meta_title.slice(0, 60)
    if (body.meta_description !== undefined)   patch.meta_description = body.meta_description.slice(0, 155)
    if (body.html_body !== undefined) {
      if (body.html_body.length > MAX_HTML_BODY_CHARS) {
        return NextResponse.json(
          { success: false, error: 'html_body exceeds the maximum allowed size' },
          { status: 400 },
        )
      }
      patch.html_body  = body.html_body
      patch.word_count = countWords(body.html_body)
    }

    // P12.R.A4 — primary_keyword edit. Empty string + explicit null both treated
    // as "clear the field". Caps at 120 chars to match Yoast focus keyphrase
    // length expectations.
    if (body.primary_keyword !== undefined) {
      patch.primary_keyword = body.primary_keyword === null || body.primary_keyword === ''
        ? null
        : String(body.primary_keyword).slice(0, 120)
    }

    // P12.R.B10 — internal_links full-array replace. The UI sends the entire
    // BlogInternalLink[] back with `resolved` toggled. sanitizeInternalLinks
    // returns the safe canonical shape so the column never holds tampered data.
    if (body.internal_links !== undefined) {
      if (!Array.isArray(body.internal_links)) {
        return NextResponse.json(
          { success: false, error: 'internal_links must be an array' },
          { status: 400 },
        )
      }
      patch.internal_links = sanitizeInternalLinks(body.internal_links)
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ success: false, error: 'No valid fields to update' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('blog_posts')
      .update(patch)
      .eq('id', postId)
      .eq('client_id', clientId)
      .select('*')
      .single<BlogPost>()

    if (error || !data) {
      // HIGH-3: log DB details server-side, return generic message to caller
      if (error) console.error('[blog/:postId PATCH] Supabase error:', error)
      return NextResponse.json(
        { success: false, error: 'Failed to update blog post' },
        { status: 500 }
      )
    }

    // Fire-and-forget: generate social suggestions when a post is approved.
    // QA-清理-1: replaced internal HTTP self-call (which 401'd silently
    // whenever INTERNAL_API_KEY was missing) with direct in-process lib call.
    // See PR #297 for the same pattern applied to zhangqian/connectors.
    if (body.status === 'approved') {
      void generateSocialSuggestions(supabaseAdmin, clientId, postId).catch(err => {
        console.error('[blog/:postId PATCH] social suggestions fire-and-forget failed:', err)
      })
    }

    return NextResponse.json({ success: true, post: data })
  } catch (err: unknown) {
    console.error('[blog/:postId PATCH] Unexpected error:', err)
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; postId: string } }
) {
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
    const { postId } = params

    const { error } = await supabaseAdmin
      .from('blog_posts')
      .delete()
      .eq('id', postId)
      .eq('client_id', clientId)

    if (error) {
      // HIGH-3: log DB details server-side, return generic message to caller
      console.error('[blog/:postId DELETE] Supabase error:', error)
      return NextResponse.json({ success: false, error: 'Failed to delete blog post' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    console.error('[blog/:postId DELETE] Unexpected error:', err)
    return NextResponse.json({ success: false, error: 'An unexpected error occurred' }, { status: 500 })
  }
}
