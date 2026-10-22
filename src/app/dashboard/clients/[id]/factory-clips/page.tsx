'use client'

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'

type Clip = {
  id: string; title: string | null; scene_tag: string; motion_type: string | null; track: 'a_real' | 'b_generated'
  duration_seconds: number; media_type: 'video' | 'image'; mime_type: string | null; tags: string[]
  source_author: string | null; source_url: string | null; license_name: string | null; license_url: string | null
  license_status: 'unknown' | 'verified' | 'not_required' | 'rejected'; license_reviewed_by: string | null
  license_reviewed_at: string | null; license_review_note: string | null; sha256: string | null; status: string
  storage_url: string; aspect_ratio: string | null; usage_count: number; last_used_at: string | null
  reviewed_by: string | null; reviewed_at: string | null; review_note: string | null; created_at: string
}

type MediaInfo = { name: string; size: number; durationSeconds: number; aspectRatio: '9:16' | '16:9' | '1:1' | 'unknown' }
type Editor = { title: string; sceneTag: string; motionType: string; tags: string; sourceAuthor: string; sourceUrl: string; licenseName: string; licenseUrl: string }

const emptyEditor: Editor = { title: '', sceneTag: '', motionType: '', tags: '', sourceAuthor: '', sourceUrl: '', licenseName: '', licenseUrl: '' }
const statusLabels: Record<string, string> = { pending_review: '待审核', active: '已激活', quarantined: '已打回', archived: '已归档' }
const licenseLabels: Record<string, string> = { unknown: '未核验', verified: '已核验', not_required: '无需许可', rejected: '许可拒绝' }
const batchLimit = 20

function publicUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  return base ? `${base}/storage/v1/object/public/content-factory/${path.replace(/^\/+/, '')}` : ''
}

async function readVideoInfo(file: File): Promise<MediaInfo> {
  const url = URL.createObjectURL(file)
  try {
    const dimensions = await new Promise<{ duration: number; width: number; height: number }>((resolve, reject) => {
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.onloadedmetadata = () => resolve({ duration: video.duration, width: video.videoWidth, height: video.videoHeight })
      video.onerror = () => reject(new Error(`${file.name} 无法读取视频时长或画幅`))
      video.src = url
    })
    const ratio = dimensions.width / dimensions.height
    const aspectRatio: MediaInfo['aspectRatio'] = Math.abs(ratio - 9 / 16) < 0.04 ? '9:16'
      : Math.abs(ratio - 16 / 9) < 0.04 ? '16:9'
        : Math.abs(ratio - 1) < 0.04 ? '1:1' : 'unknown'
    return { name: file.name, size: file.size, durationSeconds: dimensions.duration, aspectRatio }
  } finally { URL.revokeObjectURL(url) }
}

export default function FactoryClipsPage() {
  const params = useParams<{ id: string }>()
  const clientId = params.id
  const [clips, setClips] = useState<Clip[]>([])
  const [status, setStatus] = useState('pending_review')
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [total, setTotal] = useState(0)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [media, setMedia] = useState<MediaInfo[]>([])
  const [track, setTrack] = useState<'a_real' | 'b_generated'>('a_real')
  const [sceneTag, setSceneTag] = useState('')
  const [tags, setTags] = useState('')
  const [motionType, setMotionType] = useState('')
  const [sourceAuthor, setSourceAuthor] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [licenseName, setLicenseName] = useState('')
  const [licenseUrl, setLicenseUrl] = useState('')
  const [editing, setEditing] = useState<Clip | null>(null)
  const [editor, setEditor] = useState<Editor>(emptyEditor)
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({})

  const load = useCallback(async (reset = false, requestedOffset = 0) => {
    const nextOffset = reset ? 0 : requestedOffset
    const query = new URLSearchParams({ limit: String(batchLimit), offset: String(nextOffset) })
    if (status) query.set('status', status)
    setBusy(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/factory-clips?${query}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '素材库加载失败')
      setClips((current) => reset ? (data.clips ?? []) : [...current, ...(data.clips ?? [])])
      setOffset(nextOffset + (data.clips?.length ?? 0))
      setTotal(data.total ?? 0)
    } catch (error) { setMessage(error instanceof Error ? error.message : '素材库加载失败') }
    finally { setBusy(false) }
  }, [clientId, status])

  useEffect(() => { void load(true) }, [load])

  const visibleClips = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return clips
    return clips.filter((clip) => [clip.title, clip.scene_tag, ...(clip.tags ?? [])].join(' ').toLowerCase().includes(q))
  }, [clips, search])

  async function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const allSelected = Array.from(event.target.files ?? [])
    const selected = allSelected.slice(0, batchLimit)
    setFiles(selected)
    setMedia([])
    setMessage(selected.length ? '正在读取所选视频的时长和画幅…' : '')
    try {
      const infos = await Promise.all(selected.map(readVideoInfo))
      setMedia(infos)
      setMessage(allSelected.length > batchLimit ? `一批最多 ${batchLimit} 个视频，已选取前 ${batchLimit} 个` : '')
    } catch (error) { setFiles([]); setMessage(error instanceof Error ? error.message : '无法读取视频信息') }
  }

  async function upload(event: FormEvent) {
    event.preventDefault()
    if (!files.length || media.length !== files.length) return
    setBusy(true); setMessage('正在上传…')
    try {
      const form = new FormData()
      files.forEach((file) => form.append('files', file))
      form.set('metadata', JSON.stringify({
        track, sceneTag, tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean), motionType,
        sourceAuthor, sourceUrl, licenseName, licenseUrl, media,
      }))
      const res = await fetch(`/api/clients/${clientId}/factory-clips`, { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok && !(data.uploaded?.length)) throw new Error(data.error ?? data.errors?.join('；') ?? '上传失败')
      const outcome = [...(data.uploaded ?? []).map((clip: { title: string }) => `${clip.title}：已入库待审核`), ...(data.errors ?? [])]
      setMessage(outcome.join('；') || data.note || '上传完成')
      setFiles([]); setMedia([])
      const input = document.getElementById('factory-clip-files') as HTMLInputElement | null
      if (input) input.value = ''
      setOffset(0); await load(true)
    } catch (error) { setMessage(error instanceof Error ? error.message : '上传失败') }
    finally { setBusy(false) }
  }

  function startEdit(clip: Clip) {
    setEditing(clip)
    setEditor({ title: clip.title ?? clip.scene_tag, sceneTag: clip.scene_tag, motionType: clip.motion_type ?? '', tags: (clip.tags ?? []).join(', '), sourceAuthor: clip.source_author ?? '', sourceUrl: clip.source_url ?? '', licenseName: clip.license_name ?? '', licenseUrl: clip.license_url ?? '' })
  }

  async function saveEdit() {
    if (!editing) return
    await mutateClip(editing.id, '', { method: 'PATCH', body: JSON.stringify({ ...editor, tags: editor.tags.split(',').map((tag) => tag.trim()).filter(Boolean) }) })
    setEditing(null)
  }

  async function mutateClip(clipId: string, action: string, options: RequestInit) {
    setBusy(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/factory-clips/${clipId}${action}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) } })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '操作失败')
      setMessage(data.note ?? '已保存')
      setOffset(0); await load(true)
    } catch (error) { setMessage(error instanceof Error ? error.message : '操作失败') }
    finally { setBusy(false) }
  }

  async function licenseReview(clip: Clip, decision: 'verified' | 'not_required' | 'rejected') {
    const note = reviewNotes[clip.id] ?? ''
    if (decision !== 'verified' && !note.trim()) { setMessage('“无需许可”和“许可拒绝”需要写核验说明'); return }
    await mutateClip(clip.id, '/license-review', { method: 'POST', body: JSON.stringify({ status: decision, note }) })
  }

  return <main className="mx-auto max-w-7xl space-y-6 p-6 text-zinc-100">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><Link href={`/dashboard/clients/${clientId}`} className="text-sm text-zinc-400 hover:text-white">← 返回客户工作台</Link><h1 className="mt-2 text-2xl font-semibold">视频工厂素材库</h1><p className="mt-1 text-sm text-zinc-400">来源、许可、场景标签审核后，素材才会进入出片选片池。</p></div>
      <Link href={`/dashboard/factory?client=${clientId}`} className="rounded border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800">打开出片审片台</Link>
    </div>

    <form onSubmit={upload} className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <h2 className="font-medium">批量入库视频</h2>
      <p className="text-sm text-zinc-400">不从文件名推断场景；请人工填写实际场景与证据。许可未核验的视频会保持待审核。</p>
      <label className="block text-sm">视频文件（MP4 / MOV / WebM，每批最多 20 个、每个不超过 200 MB）<input id="factory-clip-files" className="mt-2 block w-full rounded border border-zinc-700 bg-zinc-950 p-2" type="file" accept="video/mp4,video/quicktime,video/webm" multiple onChange={selectFiles} /></label>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm">素材轨道<select value={track} onChange={(e) => setTrack(e.target.value as 'a_real' | 'b_generated')} className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 p-2"><option value="a_real">A 轨：真实拍摄</option><option value="b_generated">B 轨：生成 / 授权素材</option></select></label>
        <label className="text-sm">场景标签（英文小写，可用下划线）<input required value={sceneTag} onChange={(e) => setSceneTag(e.target.value)} placeholder="例如 chongqing_river_view" className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 p-2" /></label>
        <label className="text-sm">动作 / 镜头类型<input value={motionType} onChange={(e) => setMotionType(e.target.value)} placeholder="例如 walking / aerial" className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 p-2" /></label>
        <label className="text-sm md:col-span-3">检索标签（逗号分隔）<input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="例如 chongqing, night, skyline, river" className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 p-2" /></label>
        <label className="text-sm">来源作者 / 机构<input value={sourceAuthor} onChange={(e) => setSourceAuthor(e.target.value)} className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 p-2" /></label>
        <label className="text-sm">来源页面 HTTPS URL<input type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 p-2" /></label>
        <label className="text-sm">许可名称<input value={licenseName} onChange={(e) => setLicenseName(e.target.value)} placeholder="例如 CC BY 4.0" className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 p-2" /></label>
        <label className="text-sm md:col-span-2">许可证明页面 HTTPS URL<input type="url" value={licenseUrl} onChange={(e) => setLicenseUrl(e.target.value)} className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 p-2" /></label>
      </div>
      {media.length > 0 && <p className="text-xs text-zinc-400">已读取 {media.length} 个视频元数据：{media.map((item) => `${item.name} (${item.durationSeconds.toFixed(1)} 秒，${item.aspectRatio})`).join(' · ')}</p>}
      <button disabled={busy || !files.length || media.length !== files.length || !sceneTag.trim()} className="rounded bg-orange-500 px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40">上传并加入待审核</button>
    </form>

    {message && <div role="status" className="rounded border border-zinc-700 bg-zinc-900 p-3 text-sm">{message}</div>}

    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3"><h2 className="font-medium">已入库素材（{total}）</h2><select value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); setClips([]) }} className="rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm"><option value="pending_review">待审核</option><option value="active">已激活</option><option value="quarantined">已打回</option><option value="archived">已归档</option><option value="">全部</option></select><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="按标题和标签筛选当前列表" className="min-w-56 flex-1 rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm" /></div>
      {visibleClips.length === 0 && <p className="rounded border border-zinc-800 p-6 text-sm text-zinc-500">当前筛选下没有素材。</p>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{visibleClips.map((clip) => <article key={clip.id} className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
        <video className="aspect-video w-full bg-black object-contain" src={publicUrl(clip.storage_url)} controls preload="metadata" />
        <div className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-2"><div><h3 className="font-medium">{clip.title ?? clip.scene_tag}</h3><p className="mt-1 text-xs text-zinc-400">{statusLabels[clip.status] ?? clip.status} · {clip.track === 'a_real' ? 'A 轨真实素材' : 'B 轨生成/授权'} · {Number(clip.duration_seconds).toFixed(1)} 秒 · {clip.aspect_ratio ?? '画幅未知'}</p></div><button onClick={() => startEdit(clip)} className="rounded border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800">编辑</button></div>
          <div className="flex flex-wrap gap-1">{[clip.scene_tag, ...(clip.tags ?? [])].map((tag) => <span key={tag} className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300">{tag}</span>)}</div>
          <div className="space-y-1 text-xs text-zinc-400"><p>许可：<span className="text-zinc-200">{licenseLabels[clip.license_status] ?? clip.license_status}</span> {clip.license_name ? `· ${clip.license_name}` : ''}</p>{clip.source_author && <p>来源：{clip.source_author}{clip.source_url ? <> · <a className="underline" href={clip.source_url} target="_blank" rel="noreferrer">来源页</a></> : ''}</p>}{clip.license_url && <p><a className="underline" href={clip.license_url} target="_blank" rel="noreferrer">许可证明</a></p>}{clip.license_review_note && <p>许可核验：{clip.license_review_note}</p>}{clip.review_note && <p>素材审核：{clip.review_note}</p>}</div>
          {clip.status === 'pending_review' && <div className="space-y-2 border-t border-zinc-800 pt-3">
            <label className="block text-xs text-zinc-400">许可核验说明<input value={reviewNotes[clip.id] ?? ''} onChange={(e) => setReviewNotes((notes) => ({ ...notes, [clip.id]: e.target.value }))} placeholder="无需许可 / 拒绝许可时必填" className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 p-2 text-sm text-white" /></label>
            <div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => void licenseReview(clip, 'verified')} className="rounded bg-emerald-700 px-2.5 py-1.5 text-xs">核验为有许可</button><button disabled={busy} onClick={() => void licenseReview(clip, 'not_required')} className="rounded bg-zinc-700 px-2.5 py-1.5 text-xs">无需许可</button><button disabled={busy} onClick={() => void licenseReview(clip, 'rejected')} className="rounded bg-red-900 px-2.5 py-1.5 text-xs">许可拒绝</button></div>
            <div className="flex gap-2"><button disabled={busy} onClick={() => void mutateClip(clip.id, '/review', { method: 'POST', body: JSON.stringify({ decision: 'approve' }) })} className="rounded bg-orange-500 px-3 py-1.5 text-xs font-semibold text-black">审核通过并激活</button><button disabled={busy} onClick={() => void mutateClip(clip.id, '/review', { method: 'POST', body: JSON.stringify({ decision: 'reject', note: reviewNotes[clip.id] ?? '' }) })} className="rounded border border-red-800 px-3 py-1.5 text-xs text-red-300">打回隔离</button></div>
          </div>}
          <p className="truncate text-[10px] text-zinc-600">SHA-256：{clip.sha256 ?? '未计算'}</p>
        </div>
      </article>)}</div>
      {offset < total && <button disabled={busy} onClick={() => void load(false, offset)} className="rounded border border-zinc-700 px-4 py-2 text-sm">{busy ? '加载中…' : '加载更多'}</button>}
    </section>

    {editing && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true"><form onSubmit={(event) => { event.preventDefault(); void saveEdit() }} className="max-h-[90vh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 p-5"><h2 className="text-lg font-semibold">编辑素材资料</h2><p className="text-xs text-amber-300">保存后会重置许可核验并回到待审核。</p>{([
      ['title', '标题'], ['sceneTag', '场景标签'], ['tags', '检索标签（逗号分隔）'], ['motionType', '动作 / 镜头类型'], ['sourceAuthor', '来源作者'], ['sourceUrl', '来源页面 HTTPS URL'], ['licenseName', '许可名称'], ['licenseUrl', '许可证明页面 HTTPS URL'],
    ] as const).map(([key, label]) => <label key={key} className="block text-sm">{label}<input value={editor[key]} onChange={(e) => setEditor((current) => ({ ...current, [key]: e.target.value }))} className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 p-2" /></label>)}<div className="flex justify-end gap-2"><button type="button" onClick={() => setEditing(null)} className="rounded border border-zinc-700 px-3 py-2 text-sm">取消</button><button disabled={busy} className="rounded bg-orange-500 px-3 py-2 text-sm font-semibold text-black">保存资料</button></div></form></div>}
  </main>
}
