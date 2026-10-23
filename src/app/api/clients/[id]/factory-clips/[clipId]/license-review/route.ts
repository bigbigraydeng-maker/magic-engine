import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { REQUIRED_LICENSE_SCOPES, serializeLicenseReviewEvidence, type LicenseScope } from '@/lib/factory/clip-library'
import { supabaseAdmin } from '@/lib/supabase'

type Context = { params: Promise<{ id: string; clipId: string }> }

export async function POST(req: NextRequest, { params }: Context) {
  const { id: clientId, clipId } = await params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  if (access.tier !== 'admin') return NextResponse.json({ error: '仅 ME 管理员可核验素材许可' }, { status: 403 })

  let body: Record<string, unknown>
  try {
    const parsed: unknown = await req.json()
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('bad body')
    body = parsed as Record<string, unknown>
  } catch { return NextResponse.json({ error: '请求内容无效' }, { status: 400 }) }
  const status = body.status
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : ''
  const rawScopes = body.permittedScopes
  const permittedScopes = Array.isArray(rawScopes) && rawScopes.every((scope) =>
    typeof scope === 'string' && REQUIRED_LICENSE_SCOPES.includes(scope as LicenseScope),
  ) ? Array.from(new Set(rawScopes as LicenseScope[])) : null
  if (status !== 'verified' && status !== 'not_required' && status !== 'rejected') {
    return NextResponse.json({ error: '许可结论必须是已核实、无需许可或拒绝' }, { status: 400 })
  }
  if (status === 'verified' && note.length < 30) {
    return NextResponse.json({ error: '请记录许可证据页及授权范围（至少 30 个字符）' }, { status: 400 })
  }
  if (status !== 'verified' && note.length < 20) {
    return NextResponse.json({ error: '请填写至少 20 个字符的许可结论依据' }, { status: 400 })
  }
  if (status === 'verified' && (!permittedScopes || REQUIRED_LICENSE_SCOPES.some((scope) => !permittedScopes.includes(scope)))) {
    return NextResponse.json({ error: '必须确认商业使用、剪辑/改编和网络平台发布范围' }, { status: 400 })
  }

  const { data: clip, error: readError } = await supabaseAdmin.from('video_clips')
    .select('id, source_author, source_url, license_name, license_url, license_status, status, sha256')
    .eq('client_id', clientId).eq('id', clipId).maybeSingle()
  if (readError) return NextResponse.json({ error: '素材库暂不可用，请确认迁移已安装' }, { status: 500 })
  if (!clip) return NextResponse.json({ error: '素材不存在' }, { status: 404 })
  if (status === 'verified' && (!clip.source_author || !clip.source_url || !clip.license_name || !clip.license_url)) {
    return NextResponse.json({ error: '已核实必须填写来源作者、来源页面、许可名称和许可证明页面' }, { status: 400 })
  }
  const reviewer = access.user.email ?? access.user.id
  let update = supabaseAdmin.from('video_clips').update({
    license_status: status,
    license_reviewed_by: reviewer,
    license_reviewed_at: new Date().toISOString(),
    license_review_note: serializeLicenseReviewEvidence(note, status === 'verified' ? permittedScopes ?? [] : []),
    status: 'pending_review',
    reviewed_by: null,
    reviewed_at: null,
  }).eq('client_id', clientId).eq('id', clipId)
  for (const [field, value] of [
    ['source_author', clip.source_author],
    ['source_url', clip.source_url],
    ['license_name', clip.license_name],
    ['license_url', clip.license_url],
  ] as const) {
    update = value === null ? update.is(field, null) : update.eq(field, value)
  }
  update = update.eq('license_status', clip.license_status)
    .eq('status', clip.status)
  update = clip.sha256 === null ? update.is('sha256', null) : update.eq('sha256', clip.sha256)
  const { data: updated, error } = await update.select('id').maybeSingle()
  if (error) return NextResponse.json({ error: '保存许可审核失败' }, { status: 500 })
  if (!updated) return NextResponse.json({ error: '素材信息已变化，请刷新后重新核验许可' }, { status: 409 })
  return NextResponse.json({ success: true, license_status: status })
}
