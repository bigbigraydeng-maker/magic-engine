import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { normalizeClipTags, normalizeSceneTag, normalizeHttpsUrl } from '@/lib/factory/clip-library'
import { supabaseAdmin } from '@/lib/supabase'

type Context = { params: Promise<{ id: string; clipId: string }> }

export async function PATCH(req: NextRequest, { params }: Context) {
  const { id: clientId, clipId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  if (access.tier !== 'admin') return NextResponse.json({ error: '仅 ME 管理员可维护工厂素材' }, { status: 403 })

  let body: Record<string, unknown>
  try {
    const parsed: unknown = await req.json()
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('bad body')
    body = parsed as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: '请求内容无效' }, { status: 400 })
  }
  const sceneTag = normalizeSceneTag(body.sceneTag)
  const tags = normalizeClipTags(body.tags)
  const motionType = nullableText(body.motionType, 60)
  const sourceAuthor = nullableText(body.sourceAuthor, 200)
  const sourceUrl = normalizeHttpsUrl(body.sourceUrl)
  const licenseName = nullableText(body.licenseName, 120)
  const licenseUrl = normalizeHttpsUrl(body.licenseUrl)
  const title = nullableText(body.title, 200)
  if (!sceneTag || !tags || motionType === undefined || sourceAuthor === undefined || sourceUrl === undefined || licenseName === undefined || licenseUrl === undefined || !title) {
    return NextResponse.json({ error: '标题、场景标签或来源/授权字段格式无效' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin.from('video_clips').update({
    title,
    scene_tag: sceneTag,
    tags,
    motion_type: motionType,
    source_author: sourceAuthor,
    source_url: sourceUrl,
    license_name: licenseName,
    license_url: licenseUrl,
    status: 'pending_review',
    license_status: 'unknown',
    license_reviewed_by: null,
    license_reviewed_at: null,
    license_review_note: null,
    reviewed_by: null,
    reviewed_at: null,
  }).eq('client_id', clientId).eq('id', clipId).select('id, status').maybeSingle()
  if (error) return NextResponse.json({ error: '保存素材失败；请确认素材库迁移已安装' }, { status: 500 })
  if (!data) return NextResponse.json({ error: '素材不存在' }, { status: 404 })
  return NextResponse.json({ success: true, clip: data, note: '资料有修改，许可核验与激活审核已重置' })
}

function nullableText(value: unknown, max: number): string | null | undefined {
  if (value === null || value === '') return null
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text.length > max ? undefined : text || null
}
