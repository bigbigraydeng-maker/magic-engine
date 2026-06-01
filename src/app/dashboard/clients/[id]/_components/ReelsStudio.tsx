'use client'

/**
 * Reels Studio Tab — two-column layout
 *
 * Left  (7 cols): draft list + active draft editor (4 editable fields + frame uploads + video)
 * Right (5 cols): AI chat panel for field-level refinement
 *
 * Reference: ROADMAP.md P8.R.6
 */

import { useState, useEffect, useCallback, useRef } from 'react'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ReelsDraft {
  id: string
  status: 'draft' | 'images_ready' | 'video_generating' | 'video_ready'
  opening_frame_prompt: string | null
  closing_frame_prompt: string | null
  i2v_video_prompt: string | null
  fb_caption: string | null
  opening_frame_url: string | null
  closing_frame_url: string | null
  video_url: string | null
  chat_history: Array<{ role: 'user' | 'assistant'; content: string }>
  campaign_brief_id: string | null
  source_storyboard_id: string | null
  created_at: string
}

interface CampaignBrief {
  id: string
  name: string
  status: string
}

interface Props {
  clientId: string
  /** Pre-select this campaign in the dropdown — keeps generated reels on-campaign. */
  defaultCampaignId?: string
  /** Fired after a new draft is generated — lets a host (Content Studio) link it back. */
  onDraftGenerated?: () => void
  /** When true, hides the Generate button — used for autonomous flywheel tasks. */
  readonly?: boolean
}

// ─── Status badge ──────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<ReelsDraft['status'], string> = {
  draft: 'Draft',
  images_ready: 'Frames Ready',
  video_generating: 'Generating…',
  video_ready: 'Video Ready ✓',
}

const STATUS_COLORS: Record<ReelsDraft['status'], string> = {
  draft: 'bg-me-ivory text-me-charcoal/60',
  images_ready: 'bg-blue-100 text-blue-700',
  video_generating: 'bg-me-ochre/15 text-me-ochre',
  video_ready: 'bg-[#5C8A4A]/12 text-[#5C8A4A]',
}

// ─── Field labels ──────────────────────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  opening_frame_prompt: '🖼️ Opening Frame Prompt',
  closing_frame_prompt: '🖼️ Closing Frame Prompt',
  i2v_video_prompt: '🎬 Video Prompt (I2V)',
  fb_caption: '📝 Facebook Caption',
}

// ─── Main component ────────────────────────────────────────────────────────────

export function ReelsStudio({ clientId, defaultCampaignId, onDraftGenerated, readonly = false }: Props) {
  const [drafts, setDrafts] = useState<ReelsDraft[]>([])
  const [activeDraft, setActiveDraft] = useState<ReelsDraft | null>(null)
  const [campaigns, setCampaigns] = useState<CampaignBrief[]>([])
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>(defaultCampaignId ?? '')

  const [generating, setGenerating] = useState(false)
  const [savingField, setSavingField] = useState<string | null>(null)

  // Chat state
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // Frame upload state
  const [uploadingFrame, setUploadingFrame] = useState<'opening' | 'closing' | null>(null)
  const openingFileRef = useRef<HTMLInputElement>(null)
  const closingFileRef = useRef<HTMLInputElement>(null)

  // Frame generation (Visual Studio) stores visual job IDs while polling.
  const [frameJobs, setFrameJobs] = useState<{ opening?: string; closing?: string }>({})
  const [generatingFrame, setGeneratingFrame] = useState<{ opening: boolean; closing: boolean }>({
    opening: false,
    closing: false,
  })

  // Video generation state
  const [generatingVideo, setGeneratingVideo] = useState(false)

  // Publishing Hub modal (video_ready)
  const [reelPubModal, setReelPubModal] = useState(false)
  const [reelAccounts, setReelAccounts] = useState<Array<{ id: string; name: string; provider: string }>>([])
  const [reelScheduleForm, setReelScheduleForm] = useState({ account_id: '', scheduled_at: '', caption: '' })
  const [reelScheduleLoading, setReelScheduleLoading] = useState(false)

  // ─── Fetch helpers ──────────────────────────────────────────────────────────

  const fetchDrafts = useCallback(async () => {
    const res = await fetch(`/api/clients/${clientId}/reels`)
    if (res.ok) {
      const { drafts: list } = await res.json()
      setDrafts(list ?? [])
    }
  }, [clientId])

  const fetchCampaigns = useCallback(async () => {
    const res = await fetch(`/api/clients/${clientId}/campaign?status=active`)
    if (res.ok) {
      const { campaigns: list } = await res.json()
      setCampaigns(list ?? [])
    }
  }, [clientId])

  useEffect(() => {
    fetchDrafts()
    fetchCampaigns()
  }, [fetchDrafts, fetchCampaigns])

  // Scroll chat to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeDraft?.chat_history])

  // Poll frame generation status (Visual Studio)
  useEffect(() => {
    const openingJobId = frameJobs.opening
    const closingJobId = frameJobs.closing
    if (!openingJobId && !closingJobId) return
    if (!activeDraft) return

    const pollFrame = async (frameType: 'opening' | 'closing', jobId: string) => {
      try {
        const res = await fetch(
          `/api/clients/${clientId}/reels/${activeDraft.id}/frame-status?job_id=${jobId}&frame_type=${frameType}`
        )
        if (!res.ok) return
        const data = await res.json()
        if (data.status === 'completed' && data.draft) {
          setActiveDraft(data.draft)
          setDrafts(prev => prev.map(d => d.id === activeDraft.id ? data.draft : d))
          setFrameJobs(prev => { const n = { ...prev }; delete n[frameType]; return n })
          setGeneratingFrame(prev => ({ ...prev, [frameType]: false }))
        } else if (data.status === 'failed') {
          alert(`Visual Studio: ${frameType} frame generation failed — ${data.error ?? 'unknown error'}`)
          setFrameJobs(prev => { const n = { ...prev }; delete n[frameType]; return n })
          setGeneratingFrame(prev => ({ ...prev, [frameType]: false }))
        }
      } catch {
        // Network error — keep polling
      }
    }

    const interval = setInterval(() => {
      if (openingJobId) pollFrame('opening', openingJobId)
      if (closingJobId) pollFrame('closing', closingJobId)
    }, 3000)

    return () => clearInterval(interval)
  }, [frameJobs.opening, frameJobs.closing, activeDraft?.id, clientId])

  // Poll video status while generating (cron updates DB every 2 min; we check every 30s)
  // Also re-checks immediately when the user returns to the browser tab.
  useEffect(() => {
    if (activeDraft?.status !== 'video_generating' || !activeDraft?.id) return

    const checkStatus = async () => {
      try {
        const res = await fetch(
          `/api/clients/${clientId}/reels/${activeDraft.id}/video-status`
        )
        if (!res.ok) return
        const data = await res.json()
        if (data.status === 'completed' || data.status === 'failed') {
          // Refresh the full draft list so state is accurate
          fetchDrafts()
        }
      } catch {
        // Network error — keep polling
      }
    }

    const interval = setInterval(checkStatus, 30_000)

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') checkStatus()
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [activeDraft?.status, activeDraft?.id, clientId, fetchDrafts])

  // ─── Actions ────────────────────────────────────────────────────────────────

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/reels/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_brief_id: selectedCampaignId || undefined }),
      })
      let data: { success: boolean; draft?: ReelsDraft; error?: string }
      try {
        data = await res.json()
      } catch {
        alert(`Server error (${res.status}): the API returned a non-JSON response. Check server logs.`)
        return
      }
      if (data.success && data.draft) {
        setDrafts(prev => [data.draft!, ...prev])
        setActiveDraft(data.draft!)
        onDraftGenerated?.()
      } else {
        alert(data.error ?? 'Generation failed')
      }
    } catch (err) {
      alert(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setGenerating(false)
    }
  }

  const handleFieldSave = async (field: string, value: string) => {
    if (!activeDraft) return
    setSavingField(field)
    try {
      const res = await fetch(`/api/clients/${clientId}/reels/${activeDraft.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      })
      const data = await res.json()
      if (data.success) {
        setActiveDraft(data.draft)
        setDrafts(prev => prev.map(d => d.id === activeDraft.id ? data.draft : d))
      } else {
        alert(data.error ?? 'Failed to save')
      }
    } finally {
      setSavingField(null)
    }
  }

  const handleChat = async () => {
    if (!activeDraft || !chatInput.trim() || chatLoading) return
    const msg = chatInput.trim()
    setChatInput('')
    setChatLoading(true)

    // Optimistic: append user message immediately
    setActiveDraft(prev => prev ? {
      ...prev,
      chat_history: [...(prev.chat_history ?? []), { role: 'user', content: msg }],
    } : prev)

    try {
      const res = await fetch(`/api/clients/${clientId}/reels/${activeDraft.id}/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      })
      let data: { success: boolean; draft?: ReelsDraft; error?: string }
      try {
        data = await res.json()
      } catch {
        alert(`Server error (${res.status}): non-JSON response from refine API.`)
        return
      }
      if (data.success && data.draft) {
        setActiveDraft(data.draft)
        setDrafts(prev => prev.map(d => d.id === activeDraft.id ? data.draft! : d))
      } else {
        alert(data.error ?? 'Refinement failed')
      }
    } catch (err) {
      alert(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setChatLoading(false)
    }
  }

  const handleGenerateFrame = async (frameType: 'opening' | 'closing') => {
    if (!activeDraft) return
    const prompt = frameType === 'opening'
      ? activeDraft.opening_frame_prompt
      : activeDraft.closing_frame_prompt

    if (!prompt?.trim()) {
      alert(`Please write the ${frameType} frame prompt first, then generate.`)
      return
    }

    setGeneratingFrame(prev => ({ ...prev, [frameType]: true }))
    try {
      const res = await fetch(
        `/api/clients/${clientId}/reels/${activeDraft.id}/generate-frame`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ frame_type: frameType }),
        }
      )
      const data = await res.json()
      if (data.success) {
        setFrameJobs(prev => ({ ...prev, [frameType]: data.job_id }))
        // Note: generatingFrame stays true until polling completes
      } else {
        alert(data.error ?? 'Frame generation failed')
        setGeneratingFrame(prev => ({ ...prev, [frameType]: false }))
      }
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : String(err)}`)
      setGeneratingFrame(prev => ({ ...prev, [frameType]: false }))
    }
  }

  const handleFrameUpload = async (frameType: 'opening' | 'closing', file: File) => {
    if (!activeDraft) return
    setUploadingFrame(frameType)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('frame_type', frameType)

      const res = await fetch(
        `/api/clients/${clientId}/reels/${activeDraft.id}/upload-frame`,
        { method: 'POST', body: formData }
      )
      const data = await res.json()
      if (data.success) {
        // Reload draft to get updated URL + status
        const draftRes = await fetch(`/api/clients/${clientId}/reels/${activeDraft.id}`)
        if (draftRes.ok) {
          const { draft } = await draftRes.json()
          setActiveDraft(draft)
          setDrafts(prev => prev.map(d => d.id === activeDraft.id ? draft : d))

          // ⭐ Detect if script needs regeneration due to frame update on old draft
          const draftAgeHours = (Date.now() - new Date(draft.created_at).getTime()) / (1000 * 60 * 60)
          if (draftAgeHours > 24) {
            // 草稿年龄 > 1 天，提示重新生成
            const needsRegen = window.confirm(
              '检测到您上传了新帧。该脚本是根据前一次上传的帧生成的（' +
              Math.floor(draftAgeHours) +
              ' 小时前）。\n\n是否需要根据新帧重新优化视频脚本？'
            )
            if (needsRegen) {
              await handleRegeneratePrompt()
            }
          }
        }
      } else {
        alert(data.error ?? 'Upload failed')
      }
    } finally {
      setUploadingFrame(null)
    }
  }

  const handleRegeneratePrompt = async () => {
    if (!activeDraft) return
    setGenerating(true)
    try {
      const res = await fetch(
        `/api/clients/${clientId}/reels/${activeDraft.id}/regenerate-prompt`,
        { method: 'POST' }
      )
      const data = await res.json()
      if (data.success && data.draft) {
        setActiveDraft(data.draft)
        setDrafts(prev => prev.map(d => d.id === activeDraft.id ? data.draft : d))
      } else {
        alert(data.error ?? 'Failed to regenerate script')
      }
    } finally {
      setGenerating(false)
    }
  }

  const openReelPublish = useCallback(async () => {
    if (!activeDraft?.video_url) return
    const defaultTime = new Date(Date.now() + 3_600_000)
      .toLocaleString('sv-SE', { timeZone: 'Pacific/Auckland' })
      .replace(' ', 'T')
      .slice(0, 16)
    setReelScheduleForm({
      account_id: '',
      scheduled_at: defaultTime,
      caption: activeDraft.fb_caption ?? '',
    })
    setReelPubModal(true)
    try {
      const res = await fetch('/api/publer/accounts')
      if (res.ok) {
        const d = await res.json()
        setReelAccounts(d.accounts ?? [])
      }
    } catch { /* silent — user can still type account id manually */ }
  }, [activeDraft])

  const handleReelPublish = useCallback(async () => {
    if (!activeDraft || !reelScheduleForm.account_id || !reelScheduleForm.scheduled_at) return
    setReelScheduleLoading(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/reels/${activeDraft.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: reelScheduleForm.account_id,
          scheduled_at: new Date(reelScheduleForm.scheduled_at).toISOString(),
          caption: reelScheduleForm.caption,
        }),
      })
      const d = await res.json()
      if (d.success) {
        setReelPubModal(false)
        alert(`✅ 已安排发布！Publishing Hub Job: ${d.job_id}`)
      } else {
        alert('发布失败: ' + (d.error ?? 'Unknown error'))
      }
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setReelScheduleLoading(false)
    }
  }, [activeDraft, clientId, reelScheduleForm])

  const handleGenerateVideo = async () => {
    if (!activeDraft) return
    setGeneratingVideo(true)
    try {
      const res = await fetch(
        `/api/clients/${clientId}/reels/${activeDraft.id}/generate-video`,
        { method: 'POST' }
      )
      const data = await res.json()
      if (data.success) {
        setActiveDraft(prev => prev ? { ...prev, status: 'video_generating' } : prev)
        setDrafts(prev =>
          prev.map(d => d.id === activeDraft?.id ? { ...d, status: 'video_generating' } : d)
        )
      } else {
        alert(data.error ?? 'Video generation failed')
      }
    } finally {
      setGeneratingVideo(false)
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header: campaign selector + generate button */}
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <p className="text-sm font-semibold text-me-charcoal/90">🎬 Reels Studio</p>
          <p className="text-xs text-me-charcoal/55 mt-0.5">
            读取 Master Brief + Campaign Brief → 生成提示词 → 参考帧 → 视频 → Publishing Hub
          </p>
        </div>
        {!readonly && (
          <div className="ml-auto flex items-center gap-2">
            {campaigns.length > 0 && (
              <select
                value={selectedCampaignId}
                onChange={e => setSelectedCampaignId(e.target.value)}
                className="text-xs border border-black/10 rounded-lg px-3 py-2 text-me-charcoal/75 focus:outline-none focus:ring-2 focus:ring-me-ochre"
              >
                <option value="">No campaign (brief only)</option>
                {campaigns.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="bg-me-ochre hover:bg-me-ochre/90 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5"
            >
              {generating ? (
                <>
                  <span className="animate-spin text-base">⏳</span> Generating…
                </>
              ) : (
                '✨ Generate New Reel'
              )}
            </button>
          </div>
        )}
      </div>

      {drafts.length === 0 && !generating ? (
        <div className="bg-white rounded-xl border border-dashed border-black/15 py-16 flex flex-col items-center gap-3">
          <p className="text-3xl">🎬</p>
          <p className="text-sm font-medium text-me-charcoal/75">No Reels yet</p>
          <p className="text-xs text-me-charcoal/45">{readonly ? 'This task was executed automatically.' : 'Click “Generate New Reel” to get started'}</p>
        </div>
      ) : (
        <div className="flex gap-4">
          {/* Draft list — narrow sidebar */}
          <div className="w-56 flex-shrink-0 space-y-2">
            <p className="text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide px-1">
              Drafts
            </p>
            {drafts.map(d => (
              <button
                key={d.id}
                onClick={() => setActiveDraft(d)}
                className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${
                  activeDraft?.id === d.id
                    ? 'border-me-ochre/40 bg-me-ochre/10'
                    : 'border-black/10 bg-white hover:border-me-ochre/30'
                }`}
              >
                <p className="text-xs font-medium text-me-charcoal/75 truncate">
                  {d.fb_caption
                    ? d.fb_caption.slice(0, 40) + '…'
                    : `Reel ${new Date(d.created_at).toLocaleDateString()}`}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <span className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-full ${STATUS_COLORS[d.status]}`}>
                    {STATUS_LABELS[d.status]}
                  </span>
                  {d.source_storyboard_id && (
                    <span className="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700">
                      📋 来自素材库
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>

          {/* Main editor + chat */}
          {activeDraft ? (
            <div className="flex min-w-0 flex-1 flex-col gap-4 lg:flex-row">
              {/* Left: editable fields + frames + video */}
              <div className="flex-1 min-w-0 space-y-4">
                {/* Four editable fields */}
                {(
                  [
                    'opening_frame_prompt',
                    'closing_frame_prompt',
                    'i2v_video_prompt',
                    'fb_caption',
                  ] as const
                ).map(field => (
                  <EditableField
                    key={field}
                    label={FIELD_LABELS[field]}
                    value={activeDraft[field] ?? ''}
                    saving={savingField === field}
                    rows={field === 'fb_caption' ? 5 : field === 'i2v_video_prompt' ? 4 : 3}
                    onSave={val => handleFieldSave(field, val)}
                  />
                ))}

                {/* Reference frames — generate from prompt OR upload manually */}
                <div className="bg-white rounded-xl border border-black/10 p-5">
                  <h3 className="text-sm font-semibold text-me-charcoal/90 mb-0.5">
                    Reference Frames
                  </h3>
                  <p className="text-xs text-me-charcoal/45 mb-4">
                    Generate from prompt with Visual Studio, or upload your own image (9:16)
                  </p>
                  <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                    {(['opening', 'closing'] as const).map(type => {
                      const url = type === 'opening'
                        ? activeDraft.opening_frame_url
                        : activeDraft.closing_frame_url
                      const hasPrompt = !!(type === 'opening'
                        ? activeDraft.opening_frame_prompt
                        : activeDraft.closing_frame_prompt)
                      const fileRef = type === 'opening' ? openingFileRef : closingFileRef
                      const isGenerating = generatingFrame[type]
                      const isUploading = uploadingFrame === type
                      const busy = isGenerating || isUploading

                      return (
                        <div key={type} className="space-y-2">
                          <p className="text-xs font-semibold text-me-charcoal/60 capitalize">
                            {type} Frame
                          </p>

                          {/* Image preview / generating placeholder / empty placeholder */}
                          {url ? (
                            <div className="relative group">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={url}
                                alt={`${type} frame`}
                                className="w-full aspect-[9/16] object-cover rounded-lg border border-black/10"
                              />
                              {/* Hover overlay with replace options */}
                              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex flex-col items-center justify-center gap-2 p-3">
                                <button
                                  onClick={() => handleGenerateFrame(type)}
                                  disabled={!hasPrompt || busy}
                                  className="w-full text-xs font-medium text-white bg-me-ochre/80 hover:bg-me-ochre disabled:opacity-40 py-1.5 rounded-md transition-colors"
                                >
                                  🎨 Regenerate
                                </button>
                                <button
                                  onClick={() => fileRef.current?.click()}
                                  disabled={busy}
                                  className="w-full text-xs font-medium text-white bg-white/20 hover:bg-white/30 disabled:opacity-40 py-1.5 rounded-md transition-colors"
                                >
                                  📸 Replace with upload
                                </button>
                              </div>
                            </div>
                          ) : isGenerating ? (
                            <div className="w-full aspect-[9/16] border-2 border-me-ochre/30 bg-me-ochre/10 rounded-lg flex flex-col items-center justify-center gap-2">
                              <span className="text-3xl animate-spin">⏳</span>
                              <p className="text-xs text-me-ochre text-center px-2">
                                Visual Studio is generating…
                              </p>
                            </div>
                          ) : isUploading ? (
                            <div className="w-full aspect-[9/16] border-2 border-black/10 bg-me-ivory rounded-lg flex flex-col items-center justify-center gap-2">
                              <span className="text-3xl animate-pulse">📤</span>
                              <p className="text-xs text-me-charcoal/45">Uploading…</p>
                            </div>
                          ) : (
                            <div className="w-full aspect-[9/16] border-2 border-dashed border-black/10 rounded-lg flex flex-col items-center justify-center gap-1">
                              <span className="text-3xl">🖼️</span>
                              <p className="text-xs text-me-charcoal/45">No frame yet</p>
                            </div>
                          )}

                          {/* Action buttons (hidden while busy or when image is shown — use hover overlay instead) */}
                          {!url && !busy && (
                            <div className="flex gap-1.5">
                              <button
                                onClick={() => handleGenerateFrame(type)}
                                disabled={!hasPrompt}
                                title={hasPrompt ? 'Generate from prompt' : 'Write a prompt above first'}
                                className="flex-1 text-xs font-medium bg-me-ochre hover:bg-me-ochre/90 disabled:opacity-40 disabled:cursor-not-allowed text-white py-1.5 rounded-md transition-colors"
                              >
                                🎨 Generate
                              </button>
                              <button
                                onClick={() => fileRef.current?.click()}
                                className="flex-1 text-xs font-medium border border-black/15 hover:border-black/25 text-me-charcoal/60 hover:text-me-charcoal/75 py-1.5 rounded-md transition-colors"
                              >
                                📸 Upload
                              </button>
                            </div>
                          )}

                          <input
                            ref={fileRef}
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            className="hidden"
                            onChange={e => {
                              const file = e.target.files?.[0]
                              if (file) handleFrameUpload(type, file)
                              e.target.value = ''
                            }}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Video section */}
                <div className="bg-white rounded-xl border border-black/10 p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-me-charcoal/90">Video Studio</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[activeDraft.status]}`}>
                      {STATUS_LABELS[activeDraft.status]}
                    </span>
                  </div>

                  {activeDraft.status === 'video_ready' && activeDraft.video_url ? (
                    <div className="space-y-3">
                      <video
                        src={activeDraft.video_url}
                        controls
                        className="w-full max-w-xs rounded-lg border border-black/10"
                      />
                      <div className="flex items-center gap-3">
                        <a
                          href={activeDraft.video_url}
                          download
                          target="_blank"
                          rel="noreferrer"
                          className="inline-block text-xs text-me-ochre hover:text-me-ochre font-medium"
                        >
                          ↓ Download video
                        </a>
                        <button
                          onClick={openReelPublish}
                          className="text-xs px-3 py-1.5 bg-[#5C8A4A] hover:bg-[#5C8A4A] text-white rounded-lg font-medium transition-colors"
                        >
                          📅 安排发布
                        </button>
                      </div>
                    </div>
                  ) : activeDraft.status === 'video_generating' ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-me-ochre">
                        <span className="animate-spin text-base">⏳</span>
                        <span className="text-sm font-medium">Video Studio is generating your Reel…</span>
                      </div>
                      <p className="text-xs text-me-charcoal/55">You can safely close this page. We'll notify you when it's ready. Check back in the Content library.</p>
                    </div>
                  ) : (
                    <button
                      onClick={handleGenerateVideo}
                      disabled={
                        generatingVideo ||
                        !activeDraft.opening_frame_url ||
                        !activeDraft.closing_frame_url ||
                        !activeDraft.i2v_video_prompt
                      }
                      className="bg-purple-600 hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                    >
                      {generatingVideo ? 'Starting…' : '🎬 Generate Video'}
                    </button>
                  )}

                  {(!activeDraft.opening_frame_url || !activeDraft.closing_frame_url) && (
                    <p className="text-xs text-me-charcoal/45 mt-2">
                      Upload both reference frames to enable video generation.
                    </p>
                  )}
                </div>
              </div>

              {/* Right: chat panel */}
              <div className="flex w-full flex-shrink-0 flex-col overflow-hidden rounded-xl border border-black/10 bg-white lg:w-80">
                <div className="px-4 py-3 border-b border-black/[.06]">
                  <h3 className="text-sm font-semibold text-me-charcoal/90">✏️ AI Refinement</h3>
                  <p className="text-xs text-me-charcoal/45 mt-0.5">
                    Ask Strategy Engine to change any field
                  </p>
                </div>

                {/* Chat history */}
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0 max-h-[600px]">
                  {(!activeDraft.chat_history || activeDraft.chat_history.length === 0) ? (
                    <div className="text-center py-8">
                      <p className="text-2xl mb-2">💬</p>
                      <p className="text-xs text-me-charcoal/45">
                        e.g. &ldquo;Change opening frame to show a Great Wall sunrise&rdquo;
                      </p>
                      <p className="text-xs text-me-charcoal/45 mt-1">
                        &ldquo;Make the caption more playful&rdquo;
                      </p>
                    </div>
                  ) : (
                    activeDraft.chat_history.map((msg, i) => (
                      <div
                        key={i}
                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                            msg.role === 'user'
                              ? 'bg-me-ochre text-white'
                              : 'bg-me-ivory text-me-charcoal/75'
                          }`}
                        >
                          {msg.content}
                        </div>
                      </div>
                    ))
                  )}
                  {chatLoading && (
                    <div className="flex justify-start">
                      <div className="bg-me-ivory text-me-charcoal/45 text-xs rounded-xl px-3 py-2 animate-pulse">
                        Strategy Engine is thinking…
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* Chat input */}
                <div className="px-4 py-3 border-t border-black/[.06]">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={chatInput}
                      onChange={e => setChatInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          handleChat()
                        }
                      }}
                      placeholder="Change something…"
                      disabled={chatLoading}
                      className="flex-1 text-xs text-me-charcoal/90 border border-black/10 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-me-ochre disabled:opacity-50"
                    />
                    <button
                      onClick={handleChat}
                      disabled={chatLoading || !chatInput.trim()}
                      className="bg-me-ochre hover:bg-me-ochre/90 disabled:opacity-40 text-white px-3 py-2 rounded-lg text-sm transition-colors"
                    >
                      →
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center py-20 text-me-charcoal/45 text-sm">
              Select a draft to edit, or generate a new Reel ↑
            </div>
          )}
        </div>
      )}

      {/* Publishing Hub modal */}
      {reelPubModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-base font-semibold mb-4">📅 安排发布到 Publishing Hub</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-me-charcoal/55 block mb-1">发布账号</label>
                <select
                  value={reelScheduleForm.account_id}
                  onChange={e => setReelScheduleForm(f => ({ ...f, account_id: e.target.value }))}
                  className="w-full border rounded px-2 py-1.5 text-sm text-me-charcoal/90 bg-white"
                >
                  <option value="">选择账号…</option>
                  {reelAccounts.map(a => (
                    <option key={a.id} value={a.id}>{a.name} ({a.provider})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-me-charcoal/55 block mb-1">发布时间（NZT）</label>
                <input
                  type="datetime-local"
                  value={reelScheduleForm.scheduled_at}
                  onChange={e => setReelScheduleForm(f => ({ ...f, scheduled_at: e.target.value }))}
                  className="w-full border rounded px-2 py-1.5 text-sm text-me-charcoal/90 bg-white"
                />
              </div>
              <div>
                <label className="text-xs text-me-charcoal/55 block mb-1">文案（Facebook Caption）</label>
                <textarea
                  value={reelScheduleForm.caption}
                  onChange={e => setReelScheduleForm(f => ({ ...f, caption: e.target.value }))}
                  rows={4}
                  className="w-full border rounded px-2 py-1.5 text-sm text-me-charcoal/90 bg-white resize-none"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-5 justify-end">
              <button
                onClick={() => setReelPubModal(false)}
                className="px-3 py-1.5 text-sm border rounded hover:bg-me-ivory"
              >
                取消
              </button>
              <button
                onClick={handleReelPublish}
                disabled={!reelScheduleForm.account_id || reelScheduleLoading}
                className="px-3 py-1.5 text-sm bg-[#5C8A4A] text-white rounded disabled:opacity-50 hover:bg-[#5C8A4A] flex items-center gap-2"
              >
                {reelScheduleLoading ? (
                  <>
                    <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    排程中…
                  </>
                ) : (
                  '确认发布'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Editable field ────────────────────────────────────────────────────────────

interface EditableFieldProps {
  label: string
  value: string
  saving: boolean
  rows: number
  onSave: (value: string) => void
}

function EditableField({ label, value, saving, rows, onSave }: EditableFieldProps) {
  const [localValue, setLocalValue] = useState(value)
  const [dirty, setDirty] = useState(false)

  // Sync external updates (from chat refinement)
  useEffect(() => {
    setLocalValue(value)
    setDirty(false)
  }, [value])

  return (
    <div className="bg-white rounded-xl border border-black/10 p-4">
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-semibold text-me-charcoal/75">{label}</label>
        {dirty && (
          <button
            onClick={() => { onSave(localValue); setDirty(false) }}
            disabled={saving}
            className="text-xs font-medium text-me-ochre hover:text-me-ochre disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>
      <textarea
        value={localValue}
        rows={rows}
        onChange={e => {
          setLocalValue(e.target.value)
          setDirty(e.target.value !== value)
        }}
        onBlur={() => {
          if (dirty) {
            onSave(localValue)
            setDirty(false)
          }
        }}
        className="w-full text-xs text-me-charcoal/75 border-none outline-none resize-none leading-relaxed placeholder-me-charcoal/35"
        placeholder={`Enter ${label.toLowerCase()}…`}
      />
    </div>
  )
}
