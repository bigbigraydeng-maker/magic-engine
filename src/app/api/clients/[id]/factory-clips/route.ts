import { createHash, randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { parseClipUploadMetadata } from '@/lib/factory/clip-library'
import { FACTORY_BUCKET, validateClipPath } from '@/lib/factory/worker-guard'
import { readLimitedBody } from '@/lib/uploads/read-limited-body'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MAX_FILE_BYTES = 200 * 1024 * 1024
const MAX_BATCH_BYTES = 400 * 1024 * 1024
const MAX_FILES = 20
const VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm'])
const CATALOG_FIELDS = 'id, title, scene_tag, motion_type, track, duration_seconds, media_type, mime_type, tags, source_author, source_url, license_name, license_url, license_status, license_reviewed_by, license_reviewed_at, license_review_note, sha256, status, storage_url, aspect_ratio, usage_count, last_used_at, reviewed_by, reviewed_at, review_note, created_at'

type Context = { params: Promise<{ id: string }> }

async function adminAccess(clientId: string) {
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) return { response: NextResponse.json({ error: access.error }, { status: access.status }) }
  if (access.tier !== 'admin') return { response: NextResponse.json({ error: '仅 ME 管理员可维护工厂素材与审核许可' }, { status: 403 }) }
  return { access }
}

export async function GET(req: NextRequest, { params }: Context) {
  const { id: clientId } = await params
  const auth = await adminAccess(clientId)
  if (auth.response) return auth.response

  const status = req.nextUrl.searchParams.get('status')
  const allowedStatuses = ['pending_review', 'active', 'quarantined', 'archived']
  const rawLimit = Number(req.nextUrl.searchParams.get('limit') ?? '50')
  const rawOffset = Number(req.nextUrl.searchParams.get('offset') ?? '0')
  const limit = Number.isInteger(rawLimit) ? Math.min(100, Math.max(1, rawLimit)) : 50
  const offset = Number.isInteger(rawOffset) ? Math.max(0, rawOffset) : 0

  let query = supabaseAdmin.from('video_clips').select(CATALOG_FIELDS, { count: 'exact' })
    .eq('client_id', clientId).order('created_at', { ascending: false }).range(offset, offset + limit - 1)
  if (status && allowedStatuses.includes(status)) query = query.eq('status', status)
  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: '素材库暂不可用，请确认视频工厂素材库迁移已安装', code: 'factory_clip_catalog_unavailable' }, { status: 500 })
  return NextResponse.json({ clips: data ?? [], total: count ?? 0, limit, offset })
}

export async function POST(req: NextRequest, { params }: Context) {
  const { id: clientId } = await params
  const auth = await adminAccess(clientId)
  if (auth.response) return auth.response

  const declaredLength = Number(req.headers.get('content-length') ?? '0')
  if (declaredLength > MAX_BATCH_BYTES) return NextResponse.json({ error: '一批最多 400 MB，请拆成多批上传' }, { status: 413 })
  if (!declaredLength && req.body) {
    const bytes = await readLimitedBody(req.body, MAX_BATCH_BYTES)
    if (!bytes) return NextResponse.json({ error: '一批最多 400 MB，请拆成多批上传' }, { status: 413 })
    req = new NextRequest(req.url, { method: req.method, headers: req.headers, body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer })
  }

  let form: FormData
  try { form = await req.formData() } catch {
    return NextResponse.json({ error: '上传表单无效' }, { status: 400 })
  }
  const files = form.getAll('files').filter((entry): entry is File => entry instanceof File)
  const metadata = parseClipUploadMetadata(form.get('metadata'))
  if (!metadata || files.length < 1 || files.length > MAX_FILES || files.length !== metadata.media.length) {
    return NextResponse.json({ error: '素材信息不完整；每批 1–20 个视频，且每个视频都要有时长和画幅信息' }, { status: 400 })
  }
  if (files.some((file, index) => file.name !== metadata.media[index].name || file.size !== metadata.media[index].size)) {
    return NextResponse.json({ error: '表单中的视频与素材信息不匹配，请重新选择文件' }, { status: 400 })
  }
  for (const file of files) {
    if (!VIDEO_TYPES.has(file.type)) return NextResponse.json({ error: `${file.name}: 仅支持 MP4、MOV、WebM 视频` }, { status: 400 })
    if (file.size < 1 || file.size > MAX_FILE_BYTES) return NextResponse.json({ error: `${file.name}: 单文件上限 200 MB` }, { status: 413 })
  }

  const { data: client, error: clientError } = await supabaseAdmin.from('clients').select('id').eq('id', clientId).maybeSingle()
  if (clientError || !client) return NextResponse.json({ error: '客户不存在' }, { status: 404 })

  const uploaded: Array<{ id: string; title: string; status: string }> = []
  const errors: string[] = []
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]
    const info = metadata.media[index]
    let uploadedPath: string | null = null
    try {
      const bytes = Buffer.from(await file.arrayBuffer())
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      const { data: duplicate, error: duplicateError } = await supabaseAdmin.from('video_clips')
        .select('id').eq('client_id', clientId).eq('sha256', sha256).maybeSingle()
      if (duplicateError) throw duplicateError
      if (duplicate) {
        errors.push(`${file.name}: 此客户素材库已存在相同文件`)
        continue
      }

      const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'mp4'
      const folder = metadata.track === 'a_real' ? 'a-real' : 'b-generated'
      const path = `clips/${folder}/${clientId}/${randomUUID()}.${ext}`
      const safePath = validateClipPath(path, clientId, metadata.track)
      if (!safePath) throw new Error('工厂素材路径校验失败')
      uploadedPath = safePath

      const { error: uploadError } = await supabaseAdmin.storage.from(FACTORY_BUCKET)
        .upload(safePath, bytes, { contentType: file.type, upsert: false })
      if (uploadError) throw uploadError

      const title = file.name.replace(/\.[^.]+$/, '').slice(0, 200) || '未命名素材'
      const { data: inserted, error: insertError } = await supabaseAdmin.from('video_clips').insert({
        client_id: clientId,
        title,
        scene_tag: metadata.sceneTag,
        motion_type: metadata.motionType,
        track: metadata.track,
        duration_seconds: info.durationSeconds,
        media_type: 'video',
        mime_type: file.type,
        tags: metadata.tags,
        source_author: metadata.sourceAuthor,
        source_url: metadata.sourceUrl,
        license_name: metadata.licenseName,
        license_url: metadata.licenseUrl,
        license_status: 'unknown',
        sha256,
        storage_url: safePath,
        aspect_ratio: info.aspectRatio,
        status: 'pending_review',
        usage_count: 0,
        source_meta: { intake: 'me_factory_clip_library', original_filename: file.name, is_still_image: false },
      }).select('id, title, status').single()
      if (insertError) {
        await supabaseAdmin.storage.from(FACTORY_BUCKET).remove([safePath])
        uploadedPath = null
        if (insertError.code === '23505') errors.push(`${file.name}: 此客户素材库已存在相同文件`)
        else throw insertError
      } else if (inserted) uploaded.push(inserted)
    } catch (error) {
      if (uploadedPath) await supabaseAdmin.storage.from(FACTORY_BUCKET).remove([uploadedPath]).catch(() => undefined)
      console.error('[factory-clips/POST]', clientId, file.name, error instanceof Error ? error.message : error)
      errors.push(`${file.name}: 上传或入库失败`)
    }
  }

  return NextResponse.json({ uploaded, errors, note: '新素材均进入待审核状态，不会自动参与出片' }, { status: uploaded.length ? 201 : 400 })
}
