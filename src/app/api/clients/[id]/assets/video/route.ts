import { createHash, randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { supabaseAdmin } from '@/lib/supabase'
import { assetIdSchema, usableVideo, type VideoAsset } from '@/lib/campaign/video-handoff'

const BUCKET = 'visual-assets'
const MAX_BYTES = 50 * 1024 * 1024
type Context = { params: { id: string } }

export async function GET(req: NextRequest, { params }: Context) {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const id = assetIdSchema.safeParse(req.nextUrl.searchParams.get('asset_id'))
  if (!id.success) return NextResponse.json({ error: 'INVALID_ASSET_ID' }, { status: 400 })
  const { data, error } = await supabaseAdmin.from('client_assets')
    .select('id, storage_url, original_filename, mime_type, status, archived_at')
    .eq('client_id', params.id).eq('id', id.data).maybeSingle<VideoAsset>()
  if (error) return NextResponse.json({ error: 'ASSET_READ_FAILED' }, { status: 503 })
  if (!usableVideo(data)) return NextResponse.json({ error: 'VIDEO_NOT_AVAILABLE' }, { status: 404 })
  return NextResponse.json({ asset: data, approval: 'NOT_REVIEWED' })
}

export async function POST(req: NextRequest, { params }: Context) {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const admin = await requireGlobalAdmin()
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status })
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!file || typeof file === 'string' || file.type !== 'video/mp4' || !/\.mp4$/i.test(file.name)) {
    return NextResponse.json({ error: 'MP4_REQUIRED' }, { status: 400 })
  }
  if (file.size < 16 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'VIDEO_SIZE_INVALID_MAX_50_MB' }, { status: 400 })
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (String.fromCharCode(...bytes.slice(4, 8)) !== 'ftyp') {
    return NextResponse.json({ error: 'INVALID_MP4_HEADER' }, { status: 400 })
  }
  const prefix = createHash('sha256').update(params.id).digest('hex').slice(0, 16)
  const path = `${prefix}/assets/${randomUUID()}.mp4`
  const storage = supabaseAdmin.storage.from(BUCKET)
  const uploaded = await storage.upload(path, bytes, { contentType: 'video/mp4', upsert: false })
  if (uploaded.error) return NextResponse.json({ error: 'VIDEO_UPLOAD_FAILED' }, { status: 503 })
  const { data: { publicUrl } } = storage.getPublicUrl(path)
  const { data, error } = await supabaseAdmin.from('client_assets').insert({
    client_id: params.id, storage_url: publicUrl, original_filename: file.name,
    file_size_bytes: file.size, mime_type: 'video/mp4', status: 'analyzed',
    source: 'unknown', ownership: 'client_exclusive',
    vision_metadata: { kind: 'video', analyzed: false, source: 'external_finished_video', rights_review: 'pending',
      uploaded_at: new Date().toISOString(), uploaded_by: admin.user.id },
  }).select('id, storage_url, original_filename, mime_type, status, archived_at').single()
  if (error) {
    await storage.remove([path])
    return NextResponse.json({ error: 'VIDEO_REGISTRATION_FAILED' }, { status: 503 })
  }
  return NextResponse.json({ asset: data, approval: 'NOT_REVIEWED' }, { status: 201 })
}
