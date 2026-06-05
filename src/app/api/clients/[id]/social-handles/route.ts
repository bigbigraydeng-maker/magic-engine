/**
 * Social handles — single write entry for clients.{instagram_handle,
 * facebook_page_url, tiktok_handle}.
 *
 * GET   → returns the three persisted values (null when unset).
 * PATCH → replaces all three. Sparse update: missing keys leave existing
 *         value unchanged; explicit null clears.
 *
 * Why this exists:
 *   social-collector.ts reads clients.{instagram_handle, facebook_page_url,
 *   tiktok_handle} to drive the social diagnostic dimension. When all three
 *   are null, the dimension returns score=null and the diagnostic run
 *   reports it as "skipped" — every client across the platform was missing
 *   social score until this route + the matching Settings panel landed.
 *
 * Validation:
 *   - instagram_handle / tiktok_handle: strip leading @, lowercase, max 64
 *   - facebook_page_url: must parse as http(s) URL, max 500 chars
 *   - empty string → null (clears the field)
 *
 * Mirrors: src/app/api/clients/[id]/primary-keywords/route.ts and
 *          src/app/api/clients/[id]/brand-aliases/route.ts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

const HANDLE_MAX = 64
const URL_MAX    = 500

interface PatchBody {
  instagram_handle?:   unknown
  facebook_page_url?:  unknown
  tiktok_handle?:      unknown
}

function normaliseHandle(raw: unknown): string | null | 'INVALID' {
  if (raw === null) return null
  if (typeof raw !== 'string') return 'INVALID'
  const trimmed = raw.trim().replace(/^@+/, '').toLowerCase()
  if (trimmed === '') return null
  if (trimmed.length > HANDLE_MAX) return 'INVALID'
  // Lax: allow letters / digits / underscore / dot / hyphen
  if (!/^[a-z0-9._-]+$/.test(trimmed)) return 'INVALID'
  return trimmed
}

function normaliseFacebookUrl(raw: unknown): string | null | 'INVALID' {
  if (raw === null) return null
  if (typeof raw !== 'string') return 'INVALID'
  const trimmed = raw.trim()
  if (trimmed === '') return null
  if (trimmed.length > URL_MAX) return 'INVALID'
  try {
    const u = new URL(trimmed)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'INVALID'
    return trimmed
  } catch {
    return 'INVALID'
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('instagram_handle, facebook_page_url, tiktok_handle')
    .eq('id', clientId)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  return NextResponse.json({
    instagram_handle:   (data.instagram_handle  as string | null) ?? null,
    facebook_page_url:  (data.facebook_page_url as string | null) ?? null,
    tiktok_handle:      (data.tiktok_handle     as string | null) ?? null,
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clientId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Sparse update: only include keys present in the body.
  // Each field is independently validated; one invalid → 400 with details.
  const update: Record<string, string | null> = {}
  const errors: string[] = []

  if ('instagram_handle' in body) {
    const v = normaliseHandle(body.instagram_handle)
    if (v === 'INVALID') errors.push('instagram_handle: 用户名格式非法（仅允许字母数字._-，最长 64 字符）')
    else update.instagram_handle = v
  }
  if ('facebook_page_url' in body) {
    const v = normaliseFacebookUrl(body.facebook_page_url)
    if (v === 'INVALID') errors.push('facebook_page_url: 须为合法 http(s) URL，最长 500 字符')
    else update.facebook_page_url = v
  }
  if ('tiktok_handle' in body) {
    const v = normaliseHandle(body.tiktok_handle)
    if (v === 'INVALID') errors.push('tiktok_handle: 用户名格式非法（仅允许字母数字._-，最长 64 字符）')
    else update.tiktok_handle = v
  }

  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join('; ') }, { status: 400 })
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: 'Body must include at least one of: instagram_handle, facebook_page_url, tiktok_handle' },
      { status: 400 },
    )
  }

  const { error: updateErr } = await supabaseAdmin
    .from('clients')
    .update(update)
    .eq('id', clientId)

  if (updateErr) {
    return NextResponse.json(
      { error: `Failed to update social handles: ${updateErr.message}` },
      { status: 500 },
    )
  }

  // Re-fetch the canonical row so the response reflects DB state
  // (including any fields the caller didn't touch).
  const { data: fresh } = await supabaseAdmin
    .from('clients')
    .select('instagram_handle, facebook_page_url, tiktok_handle')
    .eq('id', clientId)
    .single()

  try {
    revalidatePath(`/dashboard/clients/${clientId}/settings`)
  } catch {
    // best-effort during dev / non-Next runtime
  }

  return NextResponse.json({
    success: true,
    instagram_handle:   (fresh?.instagram_handle  as string | null) ?? null,
    facebook_page_url:  (fresh?.facebook_page_url as string | null) ?? null,
    tiktok_handle:      (fresh?.tiktok_handle     as string | null) ?? null,
  })
}
