import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { activationBlocker, type ActivatableClip, type ClipTrack, type LicenseReviewStatus } from '@/lib/factory/clip-library'
import { supabaseAdmin } from '@/lib/supabase'

type Context = { params: Promise<{ id: string; clipId: string }> }

export async function POST(req: NextRequest, { params }: Context) {
  const { id: clientId, clipId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  if (access.tier !== 'admin') return NextResponse.json({ error: '仅 ME 管理员可审核工厂素材' }, { status: 403 })

  let body: Record<string, unknown>
  try {
    const parsed: unknown = await req.json()
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('bad body')
    body = parsed as Record<string, unknown>
  } catch { return NextResponse.json({ error: '请求内容无效' }, { status: 400 }) }
  if (body.decision !== 'approve' && body.decision !== 'reject') {
    return NextResponse.json({ error: '审核决定无效' }, { status: 400 })
  }
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : ''
  if (body.decision === 'reject' && !note) return NextResponse.json({ error: '打回素材请填写原因' }, { status: 400 })

  const { data: clip, error: readError } = await supabaseAdmin.from('video_clips')
    .select('track, scene_tag, motion_type, tags, source_author, source_url, license_name, license_url, duration_seconds, media_type, sha256, license_status, license_review_note, license_reviewed_by')
    .eq('client_id', clientId).eq('id', clipId).maybeSingle()
  if (readError) return NextResponse.json({ error: '素材库暂不可用，请确认迁移已安装' }, { status: 500 })
  if (!clip) return NextResponse.json({ error: '素材不存在' }, { status: 404 })

  let nextStatus: 'active' | 'quarantined' = 'quarantined'
  if (body.decision === 'approve') {
    const reviewer = access.user.email ?? access.user.id
    if (clip.license_reviewed_by && clip.license_reviewed_by.toLowerCase() === reviewer.toLowerCase()) {
      return NextResponse.json({ error: '许可声明和最终激活必须由不同管理员完成' }, { status: 403 })
    }
    const { data: client, error: clientError } = await supabaseAdmin.from('clients').select('factory_config').eq('id', clientId).maybeSingle()
    if (clientError || !client) return NextResponse.json({ error: '客户配置不可用，无法完成审核' }, { status: 500 })
    const config = (client.factory_config ?? {}) as Record<string, unknown>
    const candidate: ActivatableClip = {
      track: clip.track as ClipTrack,
      sceneTag: clip.scene_tag,
      motionType: clip.motion_type,
      tags: clip.tags ?? [],
      sourceAuthor: clip.source_author,
      sourceUrl: clip.source_url,
      licenseName: clip.license_name,
      licenseUrl: clip.license_url,
      mediaType: clip.media_type,
      durationSeconds: Number(clip.duration_seconds),
      sha256: clip.sha256,
      licenseStatus: clip.license_status as LicenseReviewStatus,
      licenseReviewNote: clip.license_review_note,
    }
    const blocker = activationBlocker(candidate, config.allow_b_track_landmark_ads === true)
    if (blocker) return NextResponse.json({ error: `暂不能激活：${blocker}` }, { status: 400 })
    nextStatus = 'active'
  }

  let update = supabaseAdmin.from('video_clips').update({
    status: nextStatus,
    reviewed_by: access.user.email ?? access.user.id,
    reviewed_at: new Date().toISOString(),
    review_note: note || null,
  }).eq('client_id', clientId).eq('id', clipId)
  if (body.decision === 'approve') {
    // The checks above use a read snapshot. Compare the fields that authorize
    // activation in the UPDATE itself so a concurrent licence rejection or
    // metadata edit cannot be overwritten by a stale approval.
    update = update.eq('status', 'pending_review')
      .eq('license_status', clip.license_status)
    update = clip.license_reviewed_by === null
      ? update.is('license_reviewed_by', null)
      : update.eq('license_reviewed_by', clip.license_reviewed_by)
    update = clip.sha256 === null ? update.is('sha256', null) : update.eq('sha256', clip.sha256)
  }
  const { data: updated, error } = await update.select('id').maybeSingle()
  if (error) return NextResponse.json({ error: '保存审核结果失败' }, { status: 500 })
  if (!updated) return NextResponse.json({ error: '素材审核状态已变化，请刷新后重新审核' }, { status: 409 })
  return NextResponse.json({ success: true, status: nextStatus })
}
