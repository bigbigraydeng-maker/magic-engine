/**
 * GET  /api/clients/[id]/assets       — list client's asset library
 * POST /api/clients/[id]/assets       — upload one or more images (multipart/form-data)
 *
 * Phase 21.B.2 — Visual Asset Intelligence upload & list
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
const MAX_SIZE_BYTES = 50 * 1024 * 1024 // 50 MB per file
const BUCKET = 'visual-assets'

type RouteContext = { params: { id: string } }

async function ensureBucket() {
  const { error } = await supabaseAdmin.storage.createBucket(BUCKET, { public: true })
  if (error && !error.message.toLowerCase().includes('already exists')) throw error
  await supabaseAdmin.storage.updateBucket(BUCKET, { public: true, fileSizeLimit: null })
}

// ─── GET — list assets ────────────────────────────────────────────────────────

export async function GET(req: NextRequest, { params }: RouteContext) {
  const { id: clientId } = params

  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }

  const { data, error } = await supabaseAdmin
    .from('client_assets')
    .select('id, storage_url, original_filename, status, vision_metadata, hook_score, middle_score, cta_score, recommended_use, created_at')
    .eq('client_id', clientId)
    .is('archived_at', null)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[assets/GET] db error:', error.message)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, assets: data ?? [] })
}

// ─── POST — upload ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id: clientId } = params

  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid form data' }, { status: 400 })
  }

  const files = formData.getAll('files') as File[]
  if (files.length === 0) {
    return NextResponse.json({ success: false, error: 'No files provided' }, { status: 400 })
  }

  await ensureBucket()

  const inserted: { id: string; storage_url: string; original_filename: string }[] = []
  const errors: string[] = []

  for (const file of files) {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      errors.push(`${file.name}: unsupported type ${file.type}`)
      continue
    }
    if (file.size > MAX_SIZE_BYTES) {
      errors.push(`${file.name}: exceeds 50 MB limit`)
      continue
    }

    try {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
      const storagePath = `${clientId}/assets/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

      const bytes = await file.arrayBuffer()
      const { error: uploadErr } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(storagePath, bytes, { contentType: file.type, upsert: false })

      if (uploadErr) throw uploadErr

      const { data: { publicUrl } } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(storagePath)

      const { data: row, error: dbErr } = await supabaseAdmin
        .from('client_assets')
        .insert({
          client_id: clientId,
          storage_url: publicUrl,
          original_filename: file.name,
          file_size_bytes: file.size,
          mime_type: file.type,
          status: 'pending',
        })
        .select('id, storage_url, original_filename')
        .single()

      if (dbErr) throw dbErr
      inserted.push(row)

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${file.name}: ${msg}`)
    }
  }

  return NextResponse.json({
    success: inserted.length > 0,
    uploaded: inserted,
    errors,
  }, { status: inserted.length > 0 ? 201 : 400 })
}
