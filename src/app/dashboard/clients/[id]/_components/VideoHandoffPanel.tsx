'use client'

import { useEffect, useState } from 'react'
import type { VideoHandoff } from '@/lib/campaign/video-handoff'

type Video = VideoHandoff & { preview_url: string }
type Props = { clientId: string; campaignId: string; planId: string; revision: string; date: string }
const LABELS = { youtube: 'YouTube', tiktok: 'TikTok', facebook_reels: 'Facebook Reels' }
const ERRORS: Record<string, string> = {
  MP4_REQUIRED: '请上传 MP4 格式的视频。',
  VIDEO_SIZE_INVALID_MAX_50_MB: '视频不能超过 50 MB。',
  INVALID_MP4_HEADER: '文件不是有效的 MP4 视频，请重新导出。',
  PLAN_CHANGED_RELOAD: '计划已更新，请刷新后重新关联。',
  ASSET_CHANGED_RETRY: '素材已更新，请刷新后重试。',
  POOL_CHANGED_RETRY: '广告候选已更新，请重试。',
  CANDIDATE_CONTEXT_CHANGED_REVIEW_REQUIRED: '这段视频已有另一份广告配文，请先核对原候选。',
  VIDEO_NOT_AVAILABLE: '视频不可用，请重新上传。',
  INVALID_HANDOFF: '请检查视频标题、配文和所选日期。',
}

function requestError(res: Response, error: string | undefined): Error {
  if (res.status === 401 || res.status === 403) return new Error('请确认登录状态和客户访问权限。')
  return new Error(ERRORS[error ?? ''] ?? '处理失败，请重试。')
}

export function VideoHandoffPanel({ clientId, campaignId, planId, revision, date }: Props) {
  const [videos, setVideos] = useState<Video[]>([])
  const [platform, setPlatform] = useState<VideoHandoff['platform']>('facebook_reels')
  const [title, setTitle] = useState('')
  const [caption, setCaption] = useState('')
  const [assetId, setAssetId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const base = `/api/clients/${clientId}`
  const current = videos.filter(video => video.date === date)

  useEffect(() => {
    let cancelled = false
    setVideos([]); setAssetId(null); setMessage(''); setTitle(''); setCaption('')
    fetch(`${base}/campaign-daily-plan/video-handoff?campaign_id=${campaignId}`)
      .then(async res => { if (!res.ok) throw new Error('视频读取失败'); return res.json() })
      .then(data => { if (!cancelled) setVideos(data.videos ?? []) })
      .catch(() => { if (!cancelled) setMessage('视频读取失败，请刷新后重试。') })
    return () => { cancelled = true }
  }, [base, campaignId, planId, revision, date])

  async function upload(file: File) {
    setBusy(true); setAssetId(null); setMessage('')
    try {
      const form = new FormData(); form.set('file', file)
      const res = await fetch(`${base}/assets/video`, { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok || !data.asset?.id) throw requestError(res, data.error)
      setAssetId(data.asset.id); setMessage('视频已上传，填写配文后关联计划。')
    } catch (error) { setMessage(error instanceof Error ? error.message : '上传失败') }
    finally { setBusy(false) }
  }

  async function attach() {
    if (!assetId) return
    setBusy(true); setMessage('')
    const command: VideoHandoff = { campaign_id: campaignId, plan_id: planId,
      expected_plan_revision: revision, date, asset_id: assetId, platform, title, caption }
    try {
      const res = await fetch(`${base}/campaign-daily-plan/video-handoff`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command),
      })
      const data = await res.json()
      if (!res.ok) throw requestError(res, data.error)
      setVideos(old => [...old.filter(v => !(v.asset_id === assetId && v.date === date && v.platform === platform)), data.video])
      setAssetId(null); setMessage('已关联每日计划；等待内容和素材权利审核。')
    } catch (error) { setMessage(error instanceof Error ? error.message : '关联失败') }
    finally { setBusy(false) }
  }

  async function addCandidate(video: Video) {
    setBusy(true); setMessage('')
    const { preview_url: _url, ...command } = video
    // GET may return presentation-only fields: send only the strict command.
    const body = Object.fromEntries(['campaign_id', 'plan_id', 'expected_plan_revision', 'date',
      'asset_id', 'platform', 'title', 'caption'].map(key => [key, command[key as keyof VideoHandoff]]))
    try {
      const res = await fetch(`${base}/ad-strategy-config/creative-pool/video`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw requestError(res, data.error)
      setMessage('已加入广告素材候选；尚未投放。')
    } catch (error) { setMessage(error instanceof Error ? error.message : '加入候选失败') }
    finally { setBusy(false) }
  }

  return <section className="mt-3 space-y-3 border-t pt-3" aria-label="成片交接">
    <p className="text-xs font-medium">成片 · 待审核</p>
    {current.map(video => <div key={`${video.asset_id}:${video.platform}`} className="space-y-2">
      <p className="text-xs">{LABELS[video.platform]} · {video.title}</p>
      <video controls preload="metadata" src={video.preview_url} className="max-h-72 w-full rounded" />
      <p className="whitespace-pre-wrap text-xs">{video.caption}</p>
      <button type="button" disabled={busy} onClick={() => addCandidate(video)} className="rounded border px-2 py-1 text-xs">加入广告候选</button>
    </div>)}
    <label className="block text-xs">上传 MP4（最大 50 MB）<input type="file" accept="video/mp4,.mp4" disabled={busy}
      onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file) }} className="block mt-1" /></label>
    <select aria-label="视频平台" value={platform} onChange={event => setPlatform(event.target.value as VideoHandoff['platform'])}>
      {Object.entries(LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select>
    <input aria-label="视频标题" placeholder="内容主题与日期" value={title} onChange={event => setTitle(event.target.value)} className="block w-full border rounded p-1 text-xs" />
    <textarea aria-label="发布配文" placeholder="发布配文与咨询方式" value={caption} onChange={event => setCaption(event.target.value)} className="block w-full border rounded p-1 text-xs" />
    <button type="button" disabled={busy || !assetId || !title.trim() || !caption.trim()} onClick={attach} className="rounded border px-2 py-1 text-xs">关联到 {date}</button>
    {message && <p role="status" className="text-xs">{message}</p>}
    <p className="text-xs text-gray-500">关联与预览不代表行程、价格、素材权利或发布已获批准。</p>
  </section>
}
