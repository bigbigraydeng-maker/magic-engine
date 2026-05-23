'use client'

import { useState, useEffect, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface StyleScores {
  energy: number
  luxury: number
  authenticity: number
  emotional: number
  humor: number
  urgency: number
  offer_signal: number
}

type ContentGoal = 'brand' | 'sales' | 'ugc' | 'education'

interface ViralReference {
  id: string
  source_url: string
  platform: 'youtube' | 'facebook' | 'tiktok' | 'instagram' | 'upload'
  industry: string
  content_goal: ContentGoal
  analysis_status: 'pending' | 'analyzing' | 'done' | 'error'
  analysis_error: string | null
  style_scores: StyleScores | null
  style_tags: string[] | null
  style_description: string | null
  persona_fit: string[] | null
  key_techniques: string[] | null
  view_count: number | null
  like_count: number | null
  published_at: string | null
  video_title: string | null
  channel_title: string | null
  notes: string | null
  created_at: string
  analyzed_at: string | null
}

const GOAL_CONFIG: Record<ContentGoal, { label: string; emoji: string; cls: string }> = {
  brand:     { label: 'Brand',     emoji: '🎨', cls: 'bg-purple-900/60 text-purple-300' },
  sales:     { label: 'Sales',     emoji: '💰', cls: 'bg-amber-900/60 text-amber-300' },
  ugc:       { label: 'UGC',       emoji: '📱', cls: 'bg-teal-900/60 text-teal-300' },
  education: { label: 'Education', emoji: '🎓', cls: 'bg-sky-900/60 text-sky-300' },
}

function formatViews(n: number | null): string | null {
  if (n == null) return null
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

// ─── Score bar ────────────────────────────────────────────────────────────────

const SCORE_LABELS: Record<keyof StyleScores, string> = {
  energy: 'Energy',
  luxury: 'Luxury',
  authenticity: 'Authentic',
  emotional: 'Emotional',
  humor: 'Humor',
  urgency: 'Urgency',
  offer_signal: 'Offer',
}

const SCORE_COLORS: Record<keyof StyleScores, string> = {
  energy:       'bg-orange-500',
  luxury:       'bg-purple-500',
  authenticity: 'bg-green-500',
  emotional:    'bg-pink-500',
  humor:        'bg-yellow-500',
  urgency:      'bg-red-500',
  offer_signal: 'bg-blue-500',
}

function ScoreBar({ dimension, value }: { dimension: keyof StyleScores; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400 w-20 shrink-0">{SCORE_LABELS[dimension]}</span>
      <div className="flex-1 bg-gray-700 rounded-full h-1.5">
        <div
          className={`${SCORE_COLORS[dimension]} h-1.5 rounded-full transition-all`}
          style={{ width: `${(value / 10) * 100}%` }}
        />
      </div>
      <span className="text-xs text-gray-300 w-6 text-right">{value}</span>
    </div>
  )
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ViralReference['analysis_status'] }) {
  const config = {
    pending:   { label: 'Pending',   cls: 'bg-gray-700 text-gray-300' },
    analyzing: { label: 'Analyzing…', cls: 'bg-yellow-900 text-yellow-300 animate-pulse' },
    done:      { label: 'Done',      cls: 'bg-green-900 text-green-300' },
    error:     { label: 'Error',     cls: 'bg-red-900 text-red-300' },
  }
  const { label, cls } = config[status]
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{label}</span>
  )
}

// ─── Platform badge ───────────────────────────────────────────────────────────

function PlatformBadge({ platform }: { platform: ViralReference['platform'] }) {
  const config = {
    youtube:   { label: 'YouTube',   cls: 'bg-red-900/60 text-red-300' },
    facebook:  { label: 'Facebook',  cls: 'bg-blue-900/60 text-blue-300' },
    tiktok:    { label: 'TikTok',    cls: 'bg-gray-700 text-gray-200' },
    instagram: { label: 'Instagram', cls: 'bg-pink-900/60 text-pink-300' },
    upload:    { label: 'Uploaded',  cls: 'bg-emerald-900/60 text-emerald-300' },
  }
  const { label, cls } = config[platform] ?? { label: platform, cls: 'bg-gray-700 text-gray-300' }
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${cls}`}>{label}</span>
  )
}

// ─── Reference card ───────────────────────────────────────────────────────────

function ReferenceCard({ item: r, onRetry }: { item: ViralReference; onRetry: (id: string) => void }) {
  const shortUrl = r.source_url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 50)
  const goalCfg = GOAL_CONFIG[r.content_goal]
  const views = formatViews(r.view_count)

  return (
    <div className="bg-gray-800 rounded-xl p-4 border border-gray-700 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <PlatformBadge platform={r.platform} />
            <StatusBadge status={r.analysis_status} />
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${goalCfg.cls}`}>
              {goalCfg.emoji} {goalCfg.label}
            </span>
            <span className="text-xs text-gray-500 capitalize">{r.industry}</span>
            {views && (
              <span className="text-xs text-yellow-300 font-medium">
                ▶ {views}
              </span>
            )}
          </div>
          {r.video_title && (
            <p className="mt-1.5 text-xs text-gray-300 truncate" title={r.video_title}>
              {r.video_title}
            </p>
          )}
          <a
            href={r.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="block mt-0.5 text-xs text-blue-400 hover:text-blue-300 truncate"
          >
            {r.channel_title ? `${r.channel_title} · ${shortUrl}` : shortUrl}
          </a>
        </div>
      </div>

      {/* Error */}
      {r.analysis_status === 'error' && (
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs text-red-400 bg-red-950/30 rounded p-2 flex-1">
            {r.analysis_error ?? 'Unknown error'}
          </p>
          {r.platform === 'youtube' && (
            <button
              onClick={() => onRetry(r.id)}
              className="shrink-0 px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 text-xs text-white rounded-lg transition-colors"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {/* Analysis results */}
      {r.analysis_status === 'done' && r.style_scores && (
        <>
          {/* Style description */}
          {r.style_description && (
            <p className="text-sm text-gray-200 leading-relaxed">{r.style_description}</p>
          )}

          {/* 7-dim scores */}
          <div className="space-y-1.5">
            {(Object.keys(r.style_scores) as Array<keyof StyleScores>).map(dim => (
              <ScoreBar key={dim} dimension={dim} value={r.style_scores![dim]} />
            ))}
          </div>

          {/* Tags + techniques + personas */}
          <div className="space-y-2">
            {r.key_techniques && r.key_techniques.length > 0 && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Key Techniques</p>
                <div className="flex flex-wrap gap-1.5">
                  {r.key_techniques.map(t => (
                    <span key={t} className="text-xs bg-indigo-900/50 text-indigo-300 px-2 py-0.5 rounded">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {r.style_tags && r.style_tags.length > 0 && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Style Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {r.style_tags.map(t => (
                    <span key={t} className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {r.persona_fit && r.persona_fit.length > 0 && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Persona Fit</p>
                <div className="flex flex-wrap gap-1.5">
                  {r.persona_fit.map(p => (
                    <span key={p} className="text-xs bg-emerald-900/50 text-emerald-300 px-2 py-0.5 rounded">
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ViralReferencesPage() {
  const [refs, setRefs] = useState<ViralReference[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [triggering, setTriggering] = useState(false)
  const [triggerMsg, setTriggerMsg] = useState('')
  const [filter, setFilter] = useState<'all' | 'done' | 'pending' | 'error'>('all')

  // Add video form
  const [addUrls, setAddUrls] = useState('')
  const [addIndustry, setAddIndustry] = useState<'travel' | 'flooring'>('travel')
  const [addGoal, setAddGoal] = useState<ContentGoal>('brand')
  const [adding, setAdding] = useState(false)
  const [addMsg, setAddMsg] = useState('')

  // Upload file form
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState('')

  const fetchRefs = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/viral-references')
      const data = await res.json()
      if (data.success) {
        setRefs(data.references ?? [])
        setFetchError(null)
      } else {
        setFetchError(data.error ?? 'API returned success: false')
      }
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load
  useEffect(() => { fetchRefs() }, [fetchRefs])

  // Auto-poll while any are analyzing
  useEffect(() => {
    const hasAnalyzing = refs.some(r => r.analysis_status === 'analyzing')
    if (!hasAnalyzing) return
    const t = setInterval(fetchRefs, 5000)
    return () => clearInterval(t)
  }, [refs, fetchRefs])

  const addVideos = async () => {
    const urls = addUrls
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.startsWith('http'))

    if (urls.length === 0) {
      setAddMsg('请粘贴至少一条视频链接（每行一条）')
      return
    }

    setAdding(true)
    setAddMsg('')
    try {
      const res = await fetch('/api/admin/viral-references', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videos: urls.map(url => ({ url, industry: addIndustry, content_goal: addGoal })),
        }),
      })
      const data = await res.json()
      if (data.success) {
        setAddMsg(`✅ ${data.queued} 条视频已加入分析队列`)
        setAddUrls('')
        fetchRefs()
      } else {
        setAddMsg(`❌ ${data.error}`)
      }
    } catch {
      setAddMsg('❌ 网络错误，请重试')
    } finally {
      setAdding(false)
    }
  }

  const uploadVideo = async () => {
    if (!uploadFile) {
      setUploadMsg('请先选择视频文件')
      return
    }
    setUploading(true)
    setUploadMsg('')
    try {
      const fd = new FormData()
      fd.append('file', uploadFile)
      fd.append('industry', addIndustry)
      fd.append('content_goal', addGoal)

      const res = await fetch('/api/admin/viral-references/upload', {
        method: 'POST',
        body: fd,
      })
      const data = await res.json()
      if (data.success) {
        setUploadMsg(`✅ ${uploadFile.name} 已上传，正在分析…`)
        setUploadFile(null)
        // Reset the file input
        const input = document.getElementById('viral-upload-input') as HTMLInputElement | null
        if (input) input.value = ''
        fetchRefs()
      } else {
        setUploadMsg(`❌ ${data.error}`)
      }
    } catch {
      setUploadMsg('❌ 上传失败，文件可能太大或网络中断')
    } finally {
      setUploading(false)
    }
  }

  const handleRetry = async (id: string) => {
    await fetch(`/api/admin/viral-references/${id}/retry`, { method: 'POST' })
    fetchRefs()
  }

  const triggerAnalysis = async () => {
    setTriggering(true)
    setTriggerMsg('')
    try {
      const res = await fetch('/api/admin/viral-references/analyze-pending', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setTriggerMsg(data.queued > 0
          ? `${data.queued} videos queued for analysis — refreshing every 5s…`
          : 'No pending videos found.'
        )
        fetchRefs()
      }
    } catch {
      setTriggerMsg('Failed to trigger analysis.')
    } finally {
      setTriggering(false)
    }
  }

  // Stats
  const total     = refs.length
  const done      = refs.filter(r => r.analysis_status === 'done').length
  const pending   = refs.filter(r => r.analysis_status === 'pending').length
  const analyzing = refs.filter(r => r.analysis_status === 'analyzing').length
  const errors    = refs.filter(r => r.analysis_status === 'error').length

  const filtered = filter === 'all' ? refs
    : refs.filter(r => r.analysis_status === filter)

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Viral Reference Library</h1>
          <p className="text-sm text-gray-400 mt-1">
            爆款视频风格参考库 — FDE 参考使用 · 分析结果自动注入 Reel 生成
          </p>
        </div>
        <button
          onClick={triggerAnalysis}
          disabled={triggering || pending === 0}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors shrink-0"
        >
          {triggering ? 'Starting…' : `Analyze Pending (${pending})`}
        </button>
      </div>

      {/* Add Video Panel */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-3">
        <p className="text-sm font-medium text-white">投喂新视频</p>
        <div className="flex gap-3">
          <textarea
            value={addUrls}
            onChange={e => setAddUrls(e.target.value)}
            placeholder={"每行粘贴一条链接：\nhttps://youtube.com/shorts/...\nhttps://www.facebook.com/share/..."}
            rows={3}
            className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 resize-none focus:outline-none focus:border-indigo-500"
          />
          <div className="flex flex-col gap-2 shrink-0 w-44">
            <select
              value={addIndustry}
              onChange={e => setAddIndustry(e.target.value as 'travel' | 'flooring')}
              className="bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="travel">✈️ Travel</option>
              <option value="flooring">🪵 Flooring</option>
            </select>
            <select
              value={addGoal}
              onChange={e => setAddGoal(e.target.value as ContentGoal)}
              className="bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="brand">🎨 Brand / Inspiration</option>
              <option value="sales">💰 Sales / Conversion</option>
              <option value="ugc">📱 UGC / Social Proof</option>
              <option value="education">🎓 Education / How-to</option>
            </select>
            <button
              onClick={addVideos}
              disabled={adding || !addUrls.trim()}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
            >
              {adding ? 'Adding…' : 'Add & Analyze'}
            </button>
          </div>
        </div>
        {addMsg && (
          <p className={`text-sm ${addMsg.startsWith('✅') ? 'text-green-400' : 'text-red-400'}`}>
            {addMsg}
          </p>
        )}
      </div>

      {/* Upload File Panel */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-white">📁 直接上传视频文件</p>
          <p className="text-xs text-gray-500">
            行业 / 类型用上方的选择 · 适合 Facebook 短链 / 私密视频 / 手机录屏
          </p>
        </div>
        <div className="flex gap-3 items-center">
          <input
            id="viral-upload-input"
            type="file"
            accept="video/mp4,video/quicktime,video/webm,video/x-matroska,video/mpeg"
            onChange={e => setUploadFile(e.target.files?.[0] ?? null)}
            className="flex-1 text-sm text-gray-300 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-gray-700 file:text-white hover:file:bg-gray-600 file:cursor-pointer"
          />
          <button
            onClick={uploadVideo}
            disabled={uploading || !uploadFile}
            className="shrink-0 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            {uploading ? 'Uploading…' : 'Upload & Analyze'}
          </button>
        </div>
        {uploadFile && !uploadMsg && (
          <p className="text-xs text-gray-400">
            已选：{uploadFile.name} ({(uploadFile.size / 1024 / 1024).toFixed(1)} MB)
          </p>
        )}
        {uploadMsg && (
          <p className={`text-sm ${uploadMsg.startsWith('✅') ? 'text-green-400' : 'text-red-400'}`}>
            {uploadMsg}
          </p>
        )}
      </div>

      {/* Fetch error */}
      {fetchError && (
        <p className="text-sm text-red-400 bg-red-950/40 rounded-lg px-4 py-2.5">
          API Error: {fetchError}
        </p>
      )}

      {/* Trigger message */}
      {triggerMsg && (
        <p className="text-sm text-indigo-300 bg-indigo-950/40 rounded-lg px-4 py-2.5">
          {triggerMsg}
        </p>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total',     value: total,     cls: 'text-white' },
          { label: 'Analyzed',  value: done,      cls: 'text-green-400' },
          { label: 'Analyzing', value: analyzing, cls: 'text-yellow-400' },
          { label: 'Errors',    value: errors,    cls: 'text-red-400' },
        ].map(s => (
          <div key={s.label} className="bg-gray-800 rounded-xl p-4 border border-gray-700 text-center">
            <p className={`text-2xl font-bold ${s.cls}`}>{s.value}</p>
            <p className="text-xs text-gray-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {(['all', 'done', 'pending', 'error'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize ${
              filter === f
                ? 'bg-gray-700 text-white'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {f === 'all' ? `All (${total})` : f === 'done' ? `Done (${done})` : f === 'pending' ? `Pending (${pending})` : `Errors (${errors})`}
          </button>
        ))}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-500">No references found.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map(r => (
            <ReferenceCard key={r.id} item={r} onRetry={handleRetry} />
          ))}
        </div>
      )}
    </div>
  )
}
