'use client'

import { useState, useEffect, useCallback } from 'react'
import { InsightsPanel } from './InsightsPanel'

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

interface OpeningHook {
  type: string
  script: string
  feel: string
}

interface ViralReference {
  id: string
  source_url: string
  platform: 'youtube' | 'facebook' | 'tiktok' | 'instagram' | 'upload'
  industry: string
  detected_industry: string | null
  opening_hook: OpeningHook | null
  content_goal: ContentGoal
  detected_content_goal: ContentGoal | null
  is_our_video: boolean
  is_learnable: boolean
  view_threshold_min: number
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
  brand:     { label: 'Brand',     emoji: '🎨', cls: 'bg-me-ochre/50 text-me-ochre/70' },
  sales:     { label: 'Sales',     emoji: '💰', cls: 'bg-me-ochre/50 text-me-gold' },
  ugc:       { label: 'UGC',       emoji: '📱', cls: 'bg-me-ochre/60 text-me-gold' },
  education: { label: 'Education', emoji: '🎓', cls: 'bg-me-ochre/50 text-me-gold' },
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
  energy:       'bg-me-ochre',
  luxury:       'bg-me-ochre',
  authenticity: 'bg-status-track',
  emotional:    'bg-status-rej',
  humor:        'bg-me-ochre',
  urgency:      'bg-status-rej',
  offer_signal: 'bg-me-ochre',
}

function ScoreBar({ dimension, value }: { dimension: keyof StyleScores; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-me-ivory/50 w-20 shrink-0">{SCORE_LABELS[dimension]}</span>
      <div className="flex-1 bg-me-charcoal/80 rounded-full h-1.5">
        <div
          className={`${SCORE_COLORS[dimension]} h-1.5 rounded-full transition-all`}
          style={{ width: `${(value / 10) * 100}%` }}
        />
      </div>
      <span className="text-xs text-me-ivory/40 w-6 text-right">{value}</span>
    </div>
  )
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ViralReference['analysis_status'] }) {
  const config = {
    pending:   { label: 'Pending',   cls: 'bg-me-charcoal/60 text-me-ivory/40' },
    analyzing: { label: 'Analyzing…', cls: 'bg-me-ochre/70 text-me-gold animate-pulse' },
    done:      { label: 'Done',      cls: 'bg-status-track/30 text-status-track' },
    error:     { label: 'Error',     cls: 'bg-status-rej/30 text-status-rej' },
  }
  const { label, cls } = config[status]
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{label}</span>
  )
}

// ─── Platform badge ───────────────────────────────────────────────────────────

function PlatformBadge({ platform }: { platform: ViralReference['platform'] }) {
  const config = {
    youtube:   { label: 'YouTube',   cls: 'bg-status-rej/30 text-status-rej' },
    facebook:  { label: 'Facebook',  cls: 'bg-me-ochre/30 text-me-gold' },
    tiktok:    { label: 'TikTok',    cls: 'bg-me-charcoal/60 text-me-ivory/60' },
    instagram: { label: 'Instagram', cls: 'bg-status-rej/30 text-status-rej' },
    upload:    { label: 'Uploaded',  cls: 'bg-status-track/30 text-status-track' },
  }
  const { label, cls } = config[platform] ?? { label: platform, cls: 'bg-me-charcoal/60 text-me-ivory/50' }
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${cls}`}>{label}</span>
  )
}

// ─── Reference card ───────────────────────────────────────────────────────────

const KNOWN_INDUSTRIES = ['travel', 'flooring', 'real_estate', 'food', 'fashion', 'fitness', 'tech', 'beauty']

function ReferenceCard({ item: r, onRetry, onUpdateIndustry, learnableAvgScores }: {
  item: ViralReference
  onRetry: (id: string) => void
  onUpdateIndustry: (id: string, industry: string) => Promise<void>
  learnableAvgScores: StyleScores | null
}) {
  const [editingIndustry, setEditingIndustry] = useState(false)
  const [industryDraft, setIndustryDraft] = useState(r.industry)
  const [savingIndustry, setSavingIndustry] = useState(false)

  const saveIndustry = async () => {
    if (industryDraft === r.industry) { setEditingIndustry(false); return }
    setSavingIndustry(true)
    await onUpdateIndustry(r.id, industryDraft)
    setSavingIndustry(false)
    setEditingIndustry(false)
  }

  const hasMismatch =
    r.analysis_status === 'done' &&
    r.detected_industry &&
    r.detected_industry !== r.industry

  const shortUrl = r.source_url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 50)
  const goalCfg = GOAL_CONFIG[r.content_goal]
  const views = formatViews(r.view_count)
  const isOurs = r.is_our_video
  const showGap = isOurs && r.style_scores && learnableAvgScores

  return (
    <div className={`rounded-xl p-4 border space-y-3 ${
      isOurs
        ? 'bg-status-rej/20 border-status-rej/40'
        : !r.is_learnable && r.analysis_status === 'done'
          ? 'bg-me-charcoal/60 border-me-charcoal opacity-60'
          : 'bg-me-charcoal/60 border-me-charcoal'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <PlatformBadge platform={r.platform} />
            <StatusBadge status={r.analysis_status} />
            {isOurs && (
              <span className="text-xs px-2 py-0.5 rounded font-bold bg-status-rej text-white">
                🎯 OUR VIDEO
              </span>
            )}
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${goalCfg.cls}`}>
              {goalCfg.emoji} {goalCfg.label}
            </span>
            {editingIndustry ? (
              <span className="flex items-center gap-1">
                <select
                  value={industryDraft}
                  onChange={e => setIndustryDraft(e.target.value)}
                  className="bg-white/8 border border-me-ochre rounded px-1.5 py-0.5 text-xs text-white focus:outline-none"
                  autoFocus
                >
                  {KNOWN_INDUSTRIES.map(ind => (
                    <option key={ind} value={ind}>{ind}</option>
                  ))}
                </select>
                <button
                  onClick={saveIndustry}
                  disabled={savingIndustry}
                  className="text-xs px-1.5 py-0.5 bg-me-ochre hover:bg-me-ochre text-white rounded disabled:opacity-40"
                >
                  {savingIndustry ? '…' : '✓'}
                </button>
                <button
                  onClick={() => { setEditingIndustry(false); setIndustryDraft(r.industry) }}
                  className="text-xs px-1.5 py-0.5 bg-me-charcoal/60 hover:bg-me-charcoal/50 text-me-ivory/50 rounded"
                >
                  ✕
                </button>
              </span>
            ) : (
              <button
                onClick={() => { setIndustryDraft(r.industry); setEditingIndustry(true) }}
                title="点击修改行业分类"
                className={`text-xs capitalize hover:text-white transition-colors ${
                  hasMismatch ? 'text-me-gold font-semibold' : 'text-me-ivory/35'
                }`}
              >
                {r.industry}
                {hasMismatch && (
                  <span className="ml-1 text-[10px] bg-status-exec/30 text-me-gold px-1.5 py-0.5 rounded" title={`AI 识别为 "${r.detected_industry}"，与录入行业不符`}>
                    ⚠ AI: {r.detected_industry}
                  </span>
                )}
                <span className="ml-1 text-[10px] text-me-ivory/35">✏</span>
              </button>
            )}
            {views && (
              <span className="text-xs text-me-gold font-medium">
                ▶ {views}
              </span>
            )}
            {!isOurs && !r.is_learnable && r.analysis_status === 'done' && (
              <span className="text-xs px-2 py-0.5 rounded bg-me-charcoal/60 text-me-ivory/40" title={`view count below threshold (${r.view_threshold_min})`}>
                ⊘ Not learnable
              </span>
            )}
          </div>
          {r.video_title && (
            <p className="mt-1.5 text-xs text-me-ivory/50 truncate" title={r.video_title}>
              {r.video_title}
            </p>
          )}
          <a
            href={r.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="block mt-0.5 text-xs text-me-ochre/80 hover:text-me-ochre/80 truncate"
          >
            {r.channel_title ? `${r.channel_title} · ${shortUrl}` : shortUrl}
          </a>
        </div>
      </div>

      {/* Error */}
      {r.analysis_status === 'error' && (
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs text-status-rej bg-status-rej/15 rounded p-2 flex-1">
            {r.analysis_error ?? 'Unknown error'}
          </p>
          {(r.platform === 'youtube' || r.platform === 'upload') && (
            <button
              onClick={() => onRetry(r.id)}
              className="shrink-0 px-2.5 py-1.5 bg-me-charcoal/60 hover:bg-me-charcoal/50 text-xs text-white rounded-lg transition-colors"
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
            <p className="text-sm text-me-ivory/60 leading-relaxed">{r.style_description}</p>
          )}

          {/* Opening hook */}
          {r.opening_hook?.type && (
            <div className="flex items-start gap-2 bg-me-charcoal/50 rounded-lg px-3 py-2">
              <span className="text-[10px] text-me-ivory/40 mt-0.5 shrink-0">🎣 Hook</span>
              <div className="min-w-0">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-status-exec/30 text-me-gold font-medium">
                  {r.opening_hook.type.replace(/_/g, ' ')}
                </span>
                {r.opening_hook.feel && (
                  <span className="ml-1.5 text-[10px] text-me-ivory/40">
                    {r.opening_hook.feel === 'abrupt-cut' ? '⚡ abrupt' : '🌊 smooth'}
                  </span>
                )}
                {r.opening_hook.script && (
                  <p className="text-xs text-me-ivory/50 italic mt-1 line-clamp-1">
                    "{r.opening_hook.script}"
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Gap analysis (only for OUR videos) */}
          {showGap && (
            <div className="rounded-lg border border-status-rej/30 bg-status-rej/10 p-3">
              <p className="text-xs font-semibold text-status-rej mb-2">
                Gap vs Top Viral References ({r.industry} {r.content_goal})
              </p>
              <div className="space-y-1">
                {(Object.keys(r.style_scores) as Array<keyof StyleScores>).map(dim => {
                  const ours = r.style_scores![dim]
                  const avg = learnableAvgScores![dim]
                  const diff = ours - avg
                  const sign = diff > 0 ? '+' : ''
                  const cls = Math.abs(diff) < 1 ? 'text-me-ivory/40'
                            : diff > 0 ? 'text-status-track' : 'text-me-gold'
                  return (
                    <div key={dim} className="flex justify-between text-xs">
                      <span className="text-me-ivory/50 capitalize">{SCORE_LABELS[dim]}</span>
                      <span className={`font-mono ${cls}`}>
                        {ours.toFixed(1)} vs {avg.toFixed(1)} ({sign}{diff.toFixed(1)})
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
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
                <p className="text-[10px] text-me-ivory/40 uppercase tracking-widest mb-1">Key Techniques</p>
                <div className="flex flex-wrap gap-1.5">
                  {r.key_techniques.map(t => (
                    <span key={t} className="text-xs bg-status-exec/25 text-me-gold px-2 py-0.5 rounded">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {r.style_tags && r.style_tags.length > 0 && (
              <div>
                <p className="text-[10px] text-me-ivory/40 uppercase tracking-widest mb-1">Style Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {r.style_tags.map(t => (
                    <span key={t} className="text-xs bg-me-charcoal/60 text-me-ivory/50 px-2 py-0.5 rounded">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {r.persona_fit && r.persona_fit.length > 0 && (
              <div>
                <p className="text-[10px] text-me-ivory/40 uppercase tracking-widest mb-1">Persona Fit</p>
                <div className="flex flex-wrap gap-1.5">
                  {r.persona_fit.map(p => (
                    <span key={p} className="text-xs bg-status-track/25 text-status-track px-2 py-0.5 rounded">
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

const PAGE_SIZE = 50

export default function ViralReferencesPage() {
  const [refs, setRefs] = useState<ViralReference[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [triggering, setTriggering] = useState(false)
  const [triggerMsg, setTriggerMsg] = useState('')
  const [detectingIndustry, setDetectingIndustry] = useState(false)
  const [detectMsg, setDetectMsg] = useState('')
  const [filter, setFilter] = useState<'all' | 'done' | 'pending' | 'analyzing' | 'error'>('all')
  const [sortBy, setSortBy] = useState<'newest' | 'views' | 'industry'>('newest')

  // InsightsPanel uses a separate lightweight fetch (all done records, minimal fields)
  const [insightRefs, setInsightRefs] = useState<import('./InsightsPanel').ViralReferenceForInsights[]>([])

  // Add video form
  const [addUrls, setAddUrls] = useState('')
  const [addIndustry, setAddIndustry] = useState('travel')
  const [addGoal, setAddGoal] = useState<ContentGoal | 'auto'>('auto')
  const [addIsOur, setAddIsOur] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addMsg, setAddMsg] = useState('')

  // Upload file form
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState('')

  // Auto-discover form
  const [discoverKeywords, setDiscoverKeywords] = useState('')
  const [discoverMinViews, setDiscoverMinViews] = useState(50000)
  const [discoverLimit, setDiscoverLimit] = useState(20)
  const [discovering, setDiscovering] = useState(false)
  const [discoverMsg, setDiscoverMsg] = useState('')

  // Paginated card list
  const fetchRefs = useCallback(async (p = page) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page:     String(p),
        pageSize: String(PAGE_SIZE),
        status:   filter,
        sort:     sortBy,
      })
      const res  = await fetch(`/api/admin/viral-references?${params}`)
      const data = await res.json()
      if (data.success) {
        setRefs(data.references ?? [])
        setTotal(data.total ?? 0)
        setFetchError(null)
      } else {
        setFetchError(data.error ?? 'API returned success: false')
      }
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setLoading(false)
    }
  }, [page, filter, sortBy])

  // Lightweight fetch for InsightsPanel (all done records, minimal fields)
  const fetchInsightRefs = useCallback(async () => {
    try {
      const res  = await fetch('/api/admin/viral-references?summary=1')
      const data = await res.json()
      if (data.success) setInsightRefs(data.references ?? [])
    } catch { /* non-critical */ }
  }, [])

  // Initial load
  useEffect(() => { fetchRefs(1); fetchInsightRefs() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch cards when filter/sort/page changes
  useEffect(() => { fetchRefs(page) }, [filter, sortBy, page])  // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-poll while any on current page are analyzing
  useEffect(() => {
    const hasAnalyzing = refs.some(r => r.analysis_status === 'analyzing')
    if (!hasAnalyzing) return
    const t = setInterval(() => { fetchRefs(page); fetchInsightRefs() }, 5000)
    return () => clearInterval(t)
  }, [refs, page, fetchRefs, fetchInsightRefs])

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
          videos: urls.map(url => ({
            url,
            industry: addIndustry,
            ...(addGoal !== 'auto' && { content_goal: addGoal }),
            is_our_video: addIsOur,
          })),
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
      if (addGoal !== 'auto') fd.append('content_goal', addGoal)
      fd.append('is_our_video', String(addIsOur))

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

  const discoverVideos = async () => {
    const kw = discoverKeywords.trim()
    if (!kw) { setDiscoverMsg('请输入搜索关键词'); return }

    setDiscovering(true)
    setDiscoverMsg('')
    try {
      const res = await fetch('/api/admin/viral-references/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keywords:     kw,
          industry:     addIndustry,
          ...(addGoal !== 'auto' && { content_goal: addGoal }),
          min_views:    discoverMinViews,
          limit:        discoverLimit,
          is_our_video: addIsOur,
        }),
      })
      const data = await res.json()
      if (data.success) {
        const parts: string[] = []
        if (data.queued > 0)          parts.push(`✅ ${data.queued} 条新视频已加入分析队列`)
        if (data.skipped > 0)         parts.push(`${data.skipped} 条已在库中（跳过）`)
        if (data.below_threshold > 0) parts.push(`${data.below_threshold} 条播放量不足（跳过）`)
        if (data.queued === 0)        parts.push('未发现符合条件的新视频，可尝试调整关键词或降低最低播放量')
        setDiscoverMsg(parts.join(' · '))
        if (data.queued > 0) fetchRefs()
      } else {
        setDiscoverMsg(`❌ ${data.error}`)
      }
    } catch {
      setDiscoverMsg('❌ 网络错误，请重试')
    } finally {
      setDiscovering(false)
    }
  }

  const handleRetry = async (id: string) => {
    await fetch(`/api/admin/viral-references/${id}/retry`, { method: 'POST' })
    fetchRefs()
  }

  const handleDetectIndustryBatch = async () => {
    setDetectingIndustry(true)
    setDetectMsg('')
    try {
      const res = await fetch('/api/admin/viral-references/detect-industry-batch', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setDetectMsg(`✅ ${data.message}`)
        if (data.updated > 0) fetchRefs()
      } else {
        setDetectMsg(`❌ ${data.error}`)
      }
    } catch {
      setDetectMsg('❌ 网络错误，请重试')
    } finally {
      setDetectingIndustry(false)
    }
  }

  const handleUpdateIndustry = async (id: string, industry: string) => {
    await fetch(`/api/admin/viral-references/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ industry }),
    })
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

  // Stats — fetched separately so they always show full counts regardless of current filter
  const [stats, setStats] = useState({ total: 0, done: 0, pending: 0, analyzing: 0, errors: 0 })
  useEffect(() => {
    async function loadStats() {
      try {
        const [all, done, pending, analyzing, errors] = await Promise.all([
          fetch('/api/admin/viral-references?pageSize=1').then(r => r.json()),
          fetch('/api/admin/viral-references?pageSize=1&status=done').then(r => r.json()),
          fetch('/api/admin/viral-references?pageSize=1&status=pending').then(r => r.json()),
          fetch('/api/admin/viral-references?pageSize=1&status=analyzing').then(r => r.json()),
          fetch('/api/admin/viral-references?pageSize=1&status=error').then(r => r.json()),
        ])
        setStats({
          total:     all.total     ?? 0,
          done:      done.total    ?? 0,
          pending:   pending.total ?? 0,
          analyzing: analyzing.total ?? 0,
          errors:    errors.total  ?? 0,
        })
      } catch { /* non-critical */ }
    }
    loadStats()
  }, [refs]) // re-run when refs change (after add/analyze)

  // filtered is already the current page from API — sorting is done server-side
  const filtered = refs

  const totalPages = Math.ceil(total / PAGE_SIZE)

  // Compute avg scores per (industry, content_goal) from learnable references
  // Used for gap analysis on OUR videos
  const learnableAvgByKey = new Map<string, StyleScores>()
  const learnable = refs.filter(r =>
    r.analysis_status === 'done' &&
    r.is_learnable &&
    !r.is_our_video &&
    r.style_scores
  )
  const groupKey = (ind: string, goal: ContentGoal) => `${ind}::${goal}`
  const groups = new Map<string, ViralReference[]>()
  for (const r of learnable) {
    const k = groupKey(r.industry, r.content_goal)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(r)
  }
  for (const [k, arr] of Array.from(groups.entries())) {
    if (arr.length === 0) continue
    const sum: StyleScores = { energy: 0, luxury: 0, authenticity: 0, emotional: 0, humor: 0, urgency: 0, offer_signal: 0 }
    for (const r of arr) {
      const s = r.style_scores!
      sum.energy += s.energy
      sum.luxury += s.luxury
      sum.authenticity += s.authenticity
      sum.emotional += s.emotional
      sum.humor += s.humor
      sum.urgency += s.urgency
      sum.offer_signal += s.offer_signal
    }
    const n = arr.length
    learnableAvgByKey.set(k, {
      energy: sum.energy / n,
      luxury: sum.luxury / n,
      authenticity: sum.authenticity / n,
      emotional: sum.emotional / n,
      humor: sum.humor / n,
      urgency: sum.urgency / n,
      offer_signal: sum.offer_signal / n,
    })
  }
  const avgFor = (r: ViralReference): StyleScores | null =>
    learnableAvgByKey.get(groupKey(r.industry, r.content_goal)) ?? null

  return (
    <div className="min-h-screen bg-me-black">
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white">Viral Reference Library</h1>
          <p className="text-sm text-me-ivory/50 mt-1">
            爆款视频风格参考库 — FDE 参考使用 · 分析结果自动注入 Reel 生成
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={handleDetectIndustryBatch}
            disabled={detectingIndustry}
            className="px-4 py-2 bg-me-ochre hover:bg-me-ochre disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
            title="用 AI 文字推断所有缺少 detected_industry 的已分析视频的行业（无需重新下载视频）"
          >
            {detectingIndustry ? '推断中…' : '🏷 补全行业识别'}
          </button>
          <button
            onClick={triggerAnalysis}
            disabled={triggering || stats.pending === 0}
            className="px-4 py-2 bg-me-ochre hover:bg-me-ochre disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            {triggering ? 'Starting…' : `Analyze Pending (${stats.pending})`}
          </button>
        </div>
      </div>

      {/* Add Video Panel */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-white">投喂新视频</p>
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={addIsOur}
              onChange={e => setAddIsOur(e.target.checked)}
              className="w-4 h-4 rounded border-me-charcoal/60 bg-me-charcoal/50 accent-status-rej"
            />
            <span className={addIsOur ? 'text-status-rej font-medium' : 'text-me-ivory/40'}>
              🎯 This is OUR video (gap analysis, not learning)
            </span>
          </label>
        </div>
        <div className="flex gap-3">
          <textarea
            value={addUrls}
            onChange={e => setAddUrls(e.target.value)}
            placeholder={"每行粘贴一条链接：\nhttps://youtube.com/shorts/...\nhttps://www.facebook.com/share/..."}
            rows={3}
            className="flex-1 bg-me-charcoal/70 border border-me-charcoal rounded-lg px-3 py-2 text-sm text-white placeholder:text-me-ivory/30 resize-none focus:outline-none focus:border-me-ochre"
          />
          <div className="flex flex-col gap-2 shrink-0 w-44">
            <select
              value={addIndustry}
              onChange={e => setAddIndustry(e.target.value)}
              className="bg-me-charcoal/70 border border-me-charcoal rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-me-ochre"
            >
              {KNOWN_INDUSTRIES.map(ind => (
                <option key={ind} value={ind}>
                  {ind === 'travel' ? '✈️' : ind === 'flooring' ? '🪵' : ind === 'real_estate' ? '🏠' : ind === 'food' ? '🍽️' : ind === 'fashion' ? '👗' : ind === 'fitness' ? '💪' : ind === 'tech' ? '💻' : '💄'} {ind.charAt(0).toUpperCase() + ind.slice(1).replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <select
              value={addGoal}
              onChange={e => setAddGoal(e.target.value as ContentGoal | 'auto')}
              className="bg-me-charcoal/70 border border-me-charcoal rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-me-ochre"
              title="Auto-detect 让 AI 自动判断内容目标。选择 Force 可以强制指定。"
            >
              <option value="auto">🤖 Auto-detect (推荐)</option>
              <option value="brand">🎨 Force: Brand</option>
              <option value="sales">💰 Force: Sales</option>
              <option value="ugc">📱 Force: UGC</option>
              <option value="education">🎓 Force: Education</option>
            </select>
            <button
              onClick={addVideos}
              disabled={adding || !addUrls.trim()}
              className="px-4 py-2 bg-me-ochre hover:bg-me-ochre disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
            >
              {adding ? 'Adding…' : 'Add & Analyze'}
            </button>
          </div>
        </div>
        {addMsg && (
          <p className={`text-sm ${addMsg.startsWith('✅') ? 'text-status-track' : 'text-status-rej'}`}>
            {addMsg}
          </p>
        )}
      </div>

      {/* Upload File Panel */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-white">📁 直接上传视频文件</p>
          <p className="text-xs text-me-ivory/35">
            行业 / 类型用上方的选择 · 适合 Facebook 短链 / 私密视频 / 手机录屏
          </p>
        </div>
        <div className="flex gap-3 items-center">
          <input
            id="viral-upload-input"
            type="file"
            accept="video/mp4,video/quicktime,video/webm,video/x-matroska,video/mpeg"
            onChange={e => setUploadFile(e.target.files?.[0] ?? null)}
            className="flex-1 text-sm text-me-ivory/50 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-me-charcoal/60 file:text-white hover:file:bg-me-charcoal/50 file:cursor-pointer"
          />
          <button
            onClick={uploadVideo}
            disabled={uploading || !uploadFile}
            className="shrink-0 px-4 py-2 bg-status-track hover:bg-status-track/80 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            {uploading ? 'Uploading…' : 'Upload & Analyze'}
          </button>
        </div>
        {uploadFile && !uploadMsg && (
          <p className="text-xs text-me-ivory/50">
            已选：{uploadFile.name} ({(uploadFile.size / 1024 / 1024).toFixed(1)} MB)
          </p>
        )}
        {uploadMsg && (
          <p className={`text-sm ${uploadMsg.startsWith('✅') ? 'text-status-track' : 'text-status-rej'}`}>
            {uploadMsg}
          </p>
        )}
      </div>

      {/* Auto-Discover Panel */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-white">🔍 YouTube 自动发现</p>
          <p className="text-xs text-me-ivory/35">
            使用上方选择的行业 / 类型 · 约 120 配额/次 · 免费额度 10,000/天
          </p>
        </div>
        <div className="flex gap-3 flex-wrap">
          {/* Keywords */}
          <input
            type="text"
            value={discoverKeywords}
            onChange={e => setDiscoverKeywords(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && discoverVideos()}
            placeholder="搜索关键词，如：luxury travel New Zealand tour"
            className="flex-1 min-w-64 bg-me-charcoal/70 border border-me-charcoal rounded-lg px-3 py-2 text-sm text-white placeholder:text-me-ivory/30 focus:outline-none focus:border-me-ochre"
          />
          {/* Min views */}
          <select
            value={discoverMinViews}
            onChange={e => setDiscoverMinViews(Number(e.target.value))}
            className="bg-me-charcoal/70 border border-me-charcoal rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-me-ochre"
            title="最低播放量过滤"
          >
            <option value={10000}>▶ 1万+</option>
            <option value={50000}>▶ 5万+</option>
            <option value={100000}>▶ 10万+</option>
            <option value={500000}>▶ 50万+</option>
            <option value={1000000}>▶ 100万+</option>
          </select>
          {/* Limit */}
          <select
            value={discoverLimit}
            onChange={e => setDiscoverLimit(Number(e.target.value))}
            className="bg-me-charcoal/70 border border-me-charcoal rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-me-ochre"
            title="最多抓取数量"
          >
            <option value={10}>10 条</option>
            <option value={20}>20 条</option>
            <option value={30}>30 条</option>
          </select>
          <button
            onClick={discoverVideos}
            disabled={discovering || !discoverKeywords.trim()}
            className="px-4 py-2 bg-me-ochre hover:bg-me-ochre disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors shrink-0"
          >
            {discovering ? '搜索中…' : '🔍 Discover & Analyze'}
          </button>
        </div>
        {discoverMsg && (
          <p className={`text-sm ${discoverMsg.startsWith('✅') ? 'text-status-track' : discoverMsg.startsWith('❌') ? 'text-status-rej' : 'text-me-gold'}`}>
            {discoverMsg}
          </p>
        )}
      </div>

      {/* Fetch error */}
      {fetchError && (
        <p className="text-sm text-status-rej bg-status-rej/15 rounded-lg px-4 py-2.5">
          API Error: {fetchError}
        </p>
      )}

      {/* Trigger message */}
      {triggerMsg && (
        <p className="text-sm text-me-ochre/80 bg-me-ochre/50 rounded-lg px-4 py-2.5">
          {triggerMsg}
        </p>
      )}

      {/* Detect industry message */}
      {detectMsg && (
        <p className={`text-sm rounded-lg px-4 py-2.5 ${detectMsg.startsWith('✅') ? 'text-status-track bg-status-track/15' : 'text-status-rej bg-status-rej/15'}`}>
          {detectMsg}
        </p>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total',     value: stats.total,     cls: 'text-white' },
          { label: 'Analyzed',  value: stats.done,      cls: 'text-status-track' },
          { label: 'Analyzing', value: stats.analyzing, cls: 'text-me-gold' },
          { label: 'Errors',    value: stats.errors,    cls: 'text-status-rej' },
        ].map(s => (
          <div key={s.label} className="bg-me-charcoal/60 rounded-xl p-4 border border-me-charcoal text-center">
            <p className={`text-2xl font-bold ${s.cls}`}>{s.value}</p>
            <p className="text-xs text-me-ivory/40 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Insights Panel */}
      <InsightsPanel refs={insightRefs} />

      {/* Filter tabs + sort */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {([
            { key: 'all',       label: `All (${stats.total})` },
            { key: 'done',      label: `Done (${stats.done})` },
            { key: 'analyzing', label: `Analyzing (${stats.analyzing})` },
            { key: 'pending',   label: `Pending (${stats.pending})` },
            { key: 'error',     label: `Errors (${stats.errors})` },
          ] as const).map(f => (
            <button
              key={f.key}
              onClick={() => { setFilter(f.key); setPage(1) }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filter === f.key
                  ? 'bg-me-charcoal/80 text-white'
                  : 'text-me-ivory/40 hover:text-me-ivory/70'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <select
          value={sortBy}
          onChange={e => { setSortBy(e.target.value as typeof sortBy); setPage(1) }}
          className="bg-me-charcoal/70 border border-me-charcoal rounded-lg px-3 py-1.5 text-sm text-me-ivory/60 focus:outline-none focus:border-me-ochre"
        >
          <option value="newest">↓ 最新添加</option>
          <option value="views">↓ 播放量</option>
          <option value="industry">A→Z 行业</option>
        </select>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="text-center py-12 text-me-ivory/35">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-me-ivory/35">No references found.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map(r => (
            <ReferenceCard
              key={r.id}
              item={r}
              onRetry={handleRetry}
              onUpdateIndustry={handleUpdateIndustry}
              learnableAvgScores={avgFor(r)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-me-ivory/35">
            第 {page} 页 / 共 {totalPages} 页 · 共 {total} 条
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 rounded-lg text-sm bg-me-charcoal/60 border border-me-charcoal text-me-ivory/60 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              ← 上一页
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 rounded-lg text-sm bg-me-charcoal/60 border border-me-charcoal text-me-ivory/60 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              下一页 →
            </button>
          </div>
        </div>
      )}
    </div>
    </div>
  )
}
