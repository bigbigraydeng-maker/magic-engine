import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { fetchYouTubeObservation } from '@/lib/reels/youtube-metadata'
import { manifestFor } from './manifest'
import { linksFor, mergeLinks, objectOf, validateLinks } from './model'

export const dynamic = 'force-dynamic'
type Context = { params: { id: string } }
const headers = { 'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store' }

export async function GET(_req: NextRequest, { params }: Context) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status, headers })
  const manifest = manifestFor(params.id)
  if (!manifest) return NextResponse.json({ name: '', episodes: [] }, { headers })
  const { data, error } = await supabaseAdmin.from('clients').select('factory_config').eq('id', params.id).single()
  if (error || !data) return NextResponse.json({ error: '无法读取系列设置，请重试' }, { status: 503, headers })
  const episodes = await Promise.all(manifest.episodes.map(async episode => {
    const links = linksFor(data.factory_config, episode.key)
    const id = links.youtube ? new URL(links.youtube).searchParams.get('v') : null
    const youtube = id ? await fetchYouTubeObservation(id)
      : { status: 'unlinked' as const, views: null, likes: null, observedAt: null }
    return { ...episode, links, youtube }
  }))
  return NextResponse.json({ name: manifest.name, voice: manifest.voice, style: manifest.style, seasonalNote: manifest.seasonalNote, cadence: manifest.cadence, episodes }, { headers })
}

/** Saves references only. No scheduling, provider writes, generation or budget. */
export async function POST(req: NextRequest, { params }: Context) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status, headers })
  const manifest = manifestFor(params.id)
  const body = objectOf(await req.json().catch(() => null))
  if (!manifest || !manifest.episodes.some(e => e.key === body.episodeKey)) {
    return NextResponse.json({ error: '未找到本客户的这集视频' }, { status: 404, headers })
  }
  const links = validateLinks(body.links)
  const expectedLinks = validateLinks(body.expectedLinks)
  if (!links || !expectedLinks) return NextResponse.json({ error: '请填写有效的 YouTube / TikTok 视频链接及 HTTPS 成片链接；不填写的项目请留空' }, { status: 400, headers })
  const { data, error } = await supabaseAdmin.from('clients').select('factory_config').eq('id', params.id).single()
  if (error || !data) return NextResponse.json({ error: '无法读取系列设置，请重试' }, { status: 503, headers })
  if (JSON.stringify(linksFor(data.factory_config, body.episodeKey as string)) !== JSON.stringify(expectedLinks)) {
    return NextResponse.json({ error: '这集链接已被更新，请刷新后重新编辑' }, { status: 409, headers })
  }
  let update = supabaseAdmin.from('clients').update({ factory_config: mergeLinks(data.factory_config, body.episodeKey as string, links) }).eq('id', params.id)
  // Compare the complete original object, including unrelated settings and null.
  update = data.factory_config === null ? update.is('factory_config', null)
    : update.filter('factory_config', 'eq', JSON.stringify(data.factory_config))
  const saved = await update.select('id')
  if (saved.error) return NextResponse.json({ error: '保存失败，请重试' }, { status: 503, headers })
  if (!saved.data?.length) return NextResponse.json({ error: '设置已在别处更新，请刷新后重新保存' }, { status: 409, headers })
  return NextResponse.json({ ok: true, no_publish: true }, { headers })
}
