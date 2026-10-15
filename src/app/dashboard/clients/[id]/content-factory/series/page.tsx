'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import type { EpisodeLinks, Observation, SeriesBoard, SeriesEpisode } from './types'

const STATUS: Record<string, string> = { editorial_final: '内容已定稿', planned: '选题候选' }
const DATA_STATE: Record<Observation['status'], string> = {
  ok: '已读取', unlinked: '未关联平台视频', missing_key: 'YouTube 数据连接未就绪',
  unavailable: '视频不可读取（可能私有、删除或不可用）', upstream_error: '平台读取失败，请稍后重试',
}
const numberOf = (n: number | null) => n === null ? '—' : n.toLocaleString('zh-CN')

function EpisodeCard({ episode, save }: { episode: SeriesEpisode; save: (key: string, links: EpisodeLinks, expectedLinks: EpisodeLinks) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [links, setLinks] = useState(episode.links)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const doSave = async () => {
    setSaving(true); setError('')
    try { await save(episode.key, links, episode.links); setEditing(false) }
    catch (e) { setError(e instanceof Error ? e.message : '保存失败') }
    finally { setSaving(false) }
  }
  return (
    <article className="bg-white rounded-2xl border border-me-stone overflow-hidden">
      {episode.cover && <a href={episode.cover.fullUrl} target="_blank" rel="noreferrer" aria-label={`${episode.title} 高清封面`}>
        <Image src={episode.cover.url} alt={`${episode.location} — ${episode.title} 封面`} width={960} height={540} unoptimized className="w-full aspect-video object-cover" />
      </a>}
      <div className="p-5">
        <div className="flex flex-wrap gap-2 text-xs mb-3">
          <span className="bg-me-ivory rounded-full px-2 py-1">{episode.series}</span>
          <span className="bg-me-ivory rounded-full px-2 py-1">{episode.location}</span>
          <span className="text-me-taupe py-1">{STATUS[episode.status] ?? episode.status}</span>
        </div>
        <h2 className="font-display text-lg font-bold">{episode.title}</h2>
        {episode.cover && <div className="text-xs text-me-taupe mt-2">
          <span>{episode.cover.status === 'approved' ? '封面已确认' : '封面草稿'}</span>
          <a className="underline ml-3" href={episode.cover.fullUrl} target="_blank" rel="noreferrer">查看高清封面</a>
          <a className="underline ml-3" href={episode.cover.creditUrl} target="_blank" rel="noreferrer">图片来源与授权</a>
          {episode.cover.photoNote && <p className="mt-1">{episode.cover.photoNote}</p>}
        </div>}
        <p className="text-sm mt-2">{episode.angle}</p>
        <p className="text-xs text-me-taupe mt-3">{episode.format} · {episode.derivatives}</p>
        {episode.links.preview ? (
          <video className="mt-4 rounded-lg w-full bg-black" controls preload="none" src={episode.links.preview} aria-label={`${episode.title} 成片预览`} />
        ) : <p className="text-xs bg-me-ivory rounded-lg p-3 mt-4">{episode.status === 'editorial_final' ? '已定稿，待关联托管成片预览' : '制作规划中，暂无成片预览'}</p>}
        <details className="text-sm mt-4">
          <summary className="cursor-pointer text-me-charcoal">查看内容与素材准备</summary>
          <p className="mt-2">场景：{episode.scenes.join(' / ')}</p>
          <p className="mt-2">Kiwi 视角：{episode.kiwi}</p>
          <p className="mt-2 text-me-taupe">素材与核验：{episode.materialGap}</p>
        </details>
        <div className="border-t border-me-stone mt-5 pt-4">
          <div className="flex justify-between items-center text-sm font-medium"><span>YouTube</span>
            {episode.links.youtube && <a href={episode.links.youtube} target="_blank" rel="noreferrer" className="underline text-xs">查看平台视频 ↗</a>}
          </div>
          <div className="grid grid-cols-2 gap-3 mt-2">
            <div><span className="text-xs text-me-taupe">累计播放</span><div className="text-xl tabular-nums">{numberOf(episode.youtube.views)}</div></div>
            <div><span className="text-xs text-me-taupe">点赞</span><div className="text-xl tabular-nums">{numberOf(episode.youtube.likes)}</div></div>
          </div>
          <p className="text-xs text-me-taupe mt-2">{DATA_STATE[episode.youtube.status]}</p>
          {episode.youtube.observedAt && <p className="text-xs text-me-taupe mt-1">读取时间：{new Date(episode.youtube.observedAt).toLocaleString('zh-CN', { timeZone: 'Pacific/Auckland' })}（新西兰时间）</p>}
          <div className="flex justify-between text-sm mt-4"><span>TikTok</span>
            {episode.links.tiktok && <a href={episode.links.tiktok} target="_blank" rel="noreferrer" className="underline text-xs">查看平台视频 ↗</a>}
          </div>
          <p className="text-xs text-me-taupe mt-1">{episode.links.tiktok ? '播放 — · 当前尚未接入视频数据读取' : '未关联平台视频 · 播放 —'}</p>
        </div>
        <button onClick={() => { setLinks(episode.links); setError(''); setEditing(!editing) }} className="mt-4 border border-me-stone rounded-full px-3 py-1.5 text-xs hover:border-me-ochre">{editing ? '收起链接设置' : '关联成片与平台链接'}</button>
        {editing && <div className="mt-3 space-y-3">
          {(['preview', 'youtube', 'tiktok'] as const).map(key => <label key={key} className="block text-xs">
            {{ preview: '托管成片链接（HTTPS）', youtube: 'YouTube 视频链接', tiktok: 'TikTok 视频链接' }[key]}
            <input type="url" className="mt-1 w-full border border-me-stone rounded-lg p-2" value={links[key]} onChange={e => setLinks({ ...links, [key]: e.target.value })} />
          </label>)}
          <p className="text-xs text-me-taupe">这里仅保存关联，不会上传、发布或排期。链接可留空。</p>
          {error && <p role="alert" className="text-sm text-status-rej">{error}</p>}
          <button disabled={saving} onClick={() => void doSave()} className="rounded-lg bg-me-charcoal text-white px-4 py-2 text-xs disabled:opacity-50">{saving ? '保存中…' : '保存关联'}</button>
        </div>}
      </div>
    </article>
  )
}

export default function DocumentarySeriesPage() {
  const params = useParams<{ id: string }>()
  return params?.id ? <SeriesWorkspace key={params.id} clientId={params.id} /> : null
}

function SeriesWorkspace({ clientId }: { clientId: string }) {
  const [board, setBoard] = useState<SeriesBoard | null>(null)
  const [series, setSeries] = useState('all')
  const [status, setStatus] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    if (!clientId) return
    setLoading(true); setError('')
    try {
      const r = await fetch(`/api/clients/${clientId}/content-factory/series`, { cache: 'no-store' })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error ?? '读取失败')
      setBoard(data as SeriesBoard)
    } catch (e) { setError(e instanceof Error ? e.message : '读取失败'); setBoard(null) }
    finally { setLoading(false) }
  }, [clientId])
  useEffect(() => { setBoard(null); setSeries('all'); setStatus('all'); void load() }, [load])
  const save = async (episodeKey: string, links: EpisodeLinks, expectedLinks: EpisodeLinks) => {
    const r = await fetch(`/api/clients/${clientId}/content-factory/series`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ episodeKey, links, expectedLinks }),
    })
    if (!r.ok) throw new Error((await r.json()).error ?? '保存失败')
    await load()
  }
  const episodes = board?.episodes.filter(e => (series === 'all' || e.series === series) && (status === 'all' || e.status === status)) ?? []
  return <div className="p-6 max-w-[1400px] mx-auto text-me-charcoal">
    <Link href={`/dashboard/clients/${clientId}/content-factory`} className="text-xs underline">← 内容工厂</Link>
    <div className="flex items-center justify-between gap-3 mt-4"><h1 className="text-2xl font-display font-bold">系列视频与播放数据</h1>
      <button disabled={loading} onClick={() => void load()} className="border border-me-stone rounded-full px-4 py-2 text-xs disabled:opacity-50">{loading ? '读取中…' : '刷新数据'}</button>
    </div>
    <p className="text-sm text-me-taupe mt-2">制作进度与平台数据分别展示。播放为平台公开累计计数；不代表留存率、封面点击率或新增询盘。</p>
    {error && <p role="alert" className="mt-4 text-status-rej">{error}</p>}
    {loading && <p className="mt-6 text-me-taupe">正在读取系列与数据…</p>}
    {board && !loading && <>
      {board.episodes.length === 0 ? <p className="mt-6 text-me-taupe">该客户尚未配置系列视频。</p> : <>
        <div className="bg-me-ivory border border-me-stone rounded-2xl p-4 mt-5">
          <h2 className="font-display font-semibold">{board.name}</h2>
          <p className="text-sm mt-1">{board.voice} · {board.style}</p>
          <p className="text-xs text-me-taupe mt-2">{board.cadence}</p>
          <p className="text-xs text-me-taupe mt-2">{board.seasonalNote}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 my-5">
          <label className="text-sm">系列 <select aria-label="系列" value={series} onChange={e => setSeries(e.target.value)} className="border rounded-lg p-2 ml-2">
            <option value="all">全部系列</option>{Array.from(new Set(board.episodes.map(e => e.series))).map(s => <option key={s}>{s}</option>)}
          </select></label>
          <label className="text-sm">制作状态 <select aria-label="制作状态" value={status} onChange={e => setStatus(e.target.value)} className="border rounded-lg p-2 ml-2"><option value="all">全部状态</option><option value="editorial_final">内容已定稿</option><option value="planned">选题候选</option></select></label>
          <span className="text-xs text-me-taupe">{episodes.length} 集</span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">{episodes.map(e => <EpisodeCard key={`${clientId}:${e.key}`} episode={e} save={save} />)}</div>
        {episodes.length === 0 && <p className="text-sm text-me-taupe">没有符合筛选条件的视频。</p>}
      </>}
    </>}
  </div>
}
