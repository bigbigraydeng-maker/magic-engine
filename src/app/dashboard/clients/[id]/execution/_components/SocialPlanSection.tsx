'use client'

/**
 * SocialPlanSection — Phase A Social Plan generator, embedded in ContentStudioDrawer.
 *
 * Shows inside the "社媒视频" tab, above ReelsStudio.
 * Calls POST /api/clients/[id]/social-plan and renders:
 *   • Strategy card (theme + tone + campaign focus)
 *   • Sub-tabs: Reels (3) | Posts (5) | Stories (3)
 *
 * Reel cards show the 9-panel storyboard production flow:
 *   Step 1 → storyboard_image_prompt (copy → ChatGPT Image → 9-panel storyboard)
 *   Step 2 → seedance_i2v_prompt (upload storyboard + copy → Seedance 2.0 → 15s video)
 *
 * Plan history is loaded on mount from GET /api/clients/[id]/social-plan.
 * Generating a new plan prepends it to history (old plans stay visible).
 */

import { useState, useEffect, useCallback } from 'react'
import type { SocialPlanOutput, ReelsScript, Post, Story } from '@/lib/social/social-plan-templates'

interface Props {
  clientId: string
  campaignId: string | undefined
  campaignName: string | undefined
}

interface PlanRecord {
  id: string
  wave_number: number
  created_at: string
  plan_data: SocialPlanOutput
}

type PlanTab = 'reels' | 'posts' | 'stories'

export function SocialPlanSection({ clientId, campaignId, campaignName }: Props) {
  const [loading, setLoading]               = useState(false)
  const [plan, setPlan]                     = useState<SocialPlanOutput | null>(null)
  const [planId, setPlanId]                 = useState<string | null>(null)
  const [error, setError]                   = useState<string | null>(null)
  const [planTab, setPlanTab]               = useState<PlanTab>('reels')
  const [planHistory, setPlanHistory]       = useState<PlanRecord[]>([])
  const [historyLoaded, setHistoryLoaded]   = useState(false)

  // Load history on mount / when campaign changes
  useEffect(() => {
    if (!campaignId) { setHistoryLoaded(true); return }
    setHistoryLoaded(false)
    const url = `/api/clients/${clientId}/social-plan?campaign_id=${campaignId}`
    fetch(url)
      .then(r => r.json() as Promise<{ success: boolean; plans?: PlanRecord[] }>)
      .then(data => {
        const records = data.plans ?? []
        if (records.length) {
          setPlanHistory(records)
          setPlan(records[0].plan_data)
          setPlanId(records[0].id)
        }
      })
      .catch(() => { /* non-fatal */ })
      .finally(() => setHistoryLoaded(true))
  }, [clientId, campaignId])

  async function generate() {
    if (!campaignId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/social-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_brief_id: campaignId }),
      })
      const json = await res.json() as {
        success: boolean
        plan?: SocialPlanOutput
        plan_id?: string
        error?: string
      }
      if (!json.success) throw new Error(json.error ?? 'Generation failed')

      setPlan(json.plan!)
      setPlanId(json.plan_id ?? null)

      // Prepend new record to history (keep existing records)
      if (json.plan_id) {
        const record: PlanRecord = {
          id: json.plan_id,
          wave_number: planHistory.length + 1,
          created_at: new Date().toISOString(),
          plan_data: json.plan!,
        }
        setPlanHistory(prev => [record, ...prev])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mb-6 rounded-xl border border-indigo-100 bg-white shadow-sm overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 bg-gradient-to-r from-indigo-50 to-white border-b border-indigo-100">
        <div>
          <h3 className="text-sm font-bold text-indigo-900">📋 Social Plan Studio</h3>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Strategy → 3 Reels Storyboard · 5 Posts · 3 Stories · 一键生成
          </p>
        </div>
        {campaignId ? (
          <button
            onClick={generate}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            {loading ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                生成中…（约 50s）
              </>
            ) : (
              <>✦ {plan ? '重新生成' : '生成 Social Plan'}</>
            )}
          </button>
        ) : (
          <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-1.5">
            ⚠ 请先设置活跃 Campaign
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="px-5 py-3 text-xs text-red-700 bg-red-50 border-b border-red-100">
          ⚠ {error}
        </div>
      )}

      {/* Loading state (first generation, no plan yet) */}
      {loading && !plan && (
        <div className="px-5 py-10 text-center text-sm text-gray-400">
          <div className="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          Strategy Engine 制定策略中，Content Engine 生成9格分镜内容…
        </div>
      )}

      {/* Results */}
      {plan && (
        <div className="px-5 py-4 space-y-4">

          {/* History pill selector */}
          {planHistory.length > 1 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <span className="text-[10px] font-bold text-gray-400 uppercase shrink-0">历史:</span>
              {planHistory.map((rec, i) => (
                <button
                  key={rec.id}
                  onClick={() => { setPlan(rec.plan_data); setPlanId(rec.id) }}
                  className={`shrink-0 text-[10px] font-medium rounded-full px-2.5 py-1 border transition-colors ${
                    planId === rec.id
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-gray-500 border-gray-200 hover:border-indigo-300'
                  }`}
                >
                  #{planHistory.length - i}&nbsp;
                  {new Date(rec.created_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                </button>
              ))}
            </div>
          )}

          {/* Storyboard workflow notice */}
          <div className="rounded-lg bg-amber-50 border border-amber-100 px-3.5 py-2.5 text-[11px] text-amber-800 leading-relaxed">
            📌 以下为 <strong>9格 Storyboard 制作流程</strong>（推荐）。帧图模式请使用下方 <strong>Reels Studio</strong>。
          </div>

          {/* Strategy card */}
          <div className="rounded-lg bg-indigo-50 border border-indigo-100 p-4 space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-bold text-indigo-800 uppercase tracking-wide">
              <span>🎯 Strategy</span>
              {planId && (
                <span className="ml-auto font-normal text-indigo-400 normal-case">
                  plan_id: {planId.slice(0, 8)}…
                </span>
              )}
            </div>
            <p className="text-sm text-gray-800 font-medium leading-snug">{plan.strategy.theme}</p>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {(plan.strategy.content_pillars ?? []).map((p, i) => (
                <span key={i} className="text-[11px] bg-white border border-indigo-200 text-indigo-700 rounded-full px-2.5 py-0.5">
                  {p}
                </span>
              ))}
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              <strong>Tone:</strong> {plan.strategy.tone_guidance}
            </p>
            {campaignName && (
              <p className="text-[11px] text-gray-500">
                <strong>Campaign:</strong> {campaignName}
              </p>
            )}
          </div>

          {/* Sub-tabs */}
          <div className="flex gap-1 border-b border-gray-200 -mx-5 px-5">
            {([
              ['reels',   `🎬 Reels (${plan.reels.length})`],
              ['posts',   `📝 Posts (${plan.posts.length})`],
              ['stories', `⚡ Stories (${plan.stories.length})`],
            ] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setPlanTab(val)}
                className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
                  planTab === val
                    ? 'border-indigo-600 text-indigo-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {planTab === 'reels' && (
            <div className="space-y-3">
              {plan.reels.map((reel, i) => (
                <ReelCard key={i} index={i} reel={reel} clientId={clientId} campaignId={campaignId} />
              ))}
            </div>
          )}

          {planTab === 'posts' && (
            <div className="space-y-3">
              {plan.posts.map((post, i) => (
                <PostCard key={i} post={post} />
              ))}
            </div>
          )}

          {planTab === 'stories' && (
            <div className="space-y-2">
              {plan.stories.map((story, i) => (
                <StoryCard key={i} index={i} story={story} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!loading && !plan && !error && campaignId && historyLoaded && (
        <div className="px-5 py-6 text-center text-xs text-gray-400">
          点击"生成 Social Plan"一键产出本月 Facebook 内容策略（9格分镜 + Posts + Stories）
        </div>
      )}

      {/* History loading spinner */}
      {!historyLoaded && (
        <div className="px-5 py-4 flex justify-center">
          <div className="w-5 h-5 border-2 border-indigo-300 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
      .catch(() => { /* silent */ })
  }, [text])
  return (
    <button
      onClick={handleCopy}
      className="text-[10px] font-semibold border rounded px-1.5 py-0.5 transition-colors text-indigo-500 border-indigo-200 hover:text-indigo-700 hover:border-indigo-400"
      title="Copy to clipboard"
    >
      {copied ? '✓ Copied' : label}
    </button>
  )
}

const ANGLE_TAG_COLOR: Record<string, string> = {
  price_attack:  'bg-rose-50 text-rose-700 border-rose-200',
  speed_attack:  'bg-orange-50 text-orange-700 border-orange-200',
  trust_attack:  'bg-emerald-50 text-emerald-700 border-emerald-200',
  pet_floor:     'bg-purple-50 text-purple-700 border-purple-200',
  scarcity:      'bg-amber-50 text-amber-700 border-amber-200',
  seasonal:      'bg-sky-50 text-sky-700 border-sky-200',
}

// Accept both the new storyboard schema and the legacy frame-prompt schema
type AnyReel = ReelsScript & {
  hook?: string                  // legacy field name
  opening_frame_prompt?: string  // legacy field
  closing_frame_prompt?: string  // legacy field
  i2v_video_prompt?: string      // legacy field
}

type MakeStep = 'idle' | 'creating' | 'storyboard' | 'video' | 'done' | 'error'

function ReelCard({
  index, reel, clientId, campaignId,
}: {
  index: number
  reel: ReelsScript
  clientId: string
  campaignId: string | undefined
}) {
  const [open, setOpen]           = useState(false)
  const [showScene, setShowScene] = useState(false)

  // Production state machine
  const [makeStep, setMakeStep]   = useState<MakeStep>('idle')
  const [draftId, setDraftId]     = useState<string | null>(null)
  const [storyboardUrl, setStoryboardUrl] = useState<string | null>(null)
  const [videoUrl, setVideoUrl]   = useState<string | null>(null)
  const [makeError, setMakeError] = useState<string | null>(null)

  const r = reel as AnyReel
  const hookLine    = r.hook_line ?? r.hook ?? ''
  const angleColor  = ANGLE_TAG_COLOR[r.angle_tag ?? ''] ?? 'bg-gray-50 text-gray-600 border-gray-200'
  const hasNewFormat    = Boolean(r.storyboard_image_prompt)
  const hasLegacyFormat = Boolean(r.opening_frame_prompt)

  // Editable prompts — user can tweak before generating
  const [editStoryboard, setEditStoryboard] = useState(r.storyboard_image_prompt ?? '')
  const [editSeedance,   setEditSeedance]   = useState(r.seedance_i2v_prompt ?? '')

  // Video generation parameters
  const [duration,    setDuration]    = useState<6 | 10 | 15>(15)
  const [resolution,  setResolution]  = useState<'720p' | '1080p'>('720p')

  // ── Poll video generation (Seedance, every 15s) ─────────────────────────────
  useEffect(() => {
    if (makeStep !== 'video' || !draftId) return
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/reels/${draftId}/video-status`)
        const d = await res.json() as { status: string; video_url?: string; error?: string }
        if (d.status === 'completed' && d.video_url) {
          clearInterval(id)
          setVideoUrl(d.video_url)
          setMakeStep('done')
        } else if (d.status === 'failed') {
          clearInterval(id)
          setMakeError(d.error ?? 'Video generation failed')
          setMakeStep('error')
        }
      } catch { /* keep polling */ }
    }, 15000)
    return () => clearInterval(id)
  }, [makeStep, draftId, clientId])

  // ── Kick off the whole pipeline ─────────────────────────────────────────────
  // Step 1: create draft  (instant)
  // Step 2: gpt-image-1 storyboard  (~15s, synchronous — no polling)
  // Step 3: Seedance I2V video  (~2–3 min, poll every 15s)
  const handleMake = useCallback(async () => {
    if (!editStoryboard || !editSeedance) return
    setMakeStep('creating')
    setMakeError(null)
    try {
      // 1. Create reels_draft (uses the user-edited prompts)
      const cr = await fetch(`/api/clients/${clientId}/reels/create-from-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storyboard_prompt: editStoryboard,
          i2v_prompt:        editSeedance,
          caption:           reel.caption,
          campaign_brief_id: campaignId,
        }),
      })
      const cd = await cr.json() as { success: boolean; draft?: { id: string }; error?: string }
      if (!cd.success || !cd.draft) throw new Error(cd.error ?? 'Failed to create draft')
      const newDraftId = cd.draft.id
      setDraftId(newDraftId)

      // 2. Generate storyboard image via gpt-image-1 (synchronous, ~15–25s)
      setMakeStep('storyboard')
      const sr = await fetch(
        `/api/clients/${clientId}/reels/${newDraftId}/generate-storyboard`,
        { method: 'POST' },
      )
      const sd = await sr.json() as { success: boolean; image_url?: string; error?: string }
      if (!sd.success) throw new Error(sd.error ?? 'Storyboard generation failed')
      setStoryboardUrl(sd.image_url ?? null)

      // 3. Kick off Seedance I2V with user-selected params
      const vr = await fetch(
        `/api/clients/${clientId}/reels/${newDraftId}/generate-video`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ duration, resolution }),
        },
      )
      const vd = await vr.json() as { success: boolean; error?: string }
      if (!vd.success) throw new Error(vd.error ?? 'Failed to start video generation')
      setMakeStep('video')

    } catch (e) {
      setMakeError(e instanceof Error ? e.message : String(e))
      setMakeStep('error')
    }
  }, [editStoryboard, editSeedance, reel.caption, clientId, campaignId, duration, resolution])

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">

      {/* Accordion header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-gray-50 hover:bg-gray-100 text-left transition-colors"
      >
        <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold flex items-center justify-center shrink-0">
          {index + 1}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-gray-800 truncate">{reel.title}</p>
          {hookLine && <p className="text-[11px] text-gray-500 truncate">🎣 {hookLine}</p>}
        </div>
        {r.angle_tag && (
          <span className={`text-[10px] font-semibold border rounded px-1.5 py-0.5 shrink-0 ${angleColor}`}>
            {r.angle_tag.replace('_', ' ')}
          </span>
        )}
        <span className="text-gray-400 text-xs ml-1">{open ? '▲' : '▼'}</span>
      </button>

      {/* Expanded content */}
      {open && (
        <div className="px-4 py-3 space-y-3 border-t border-gray-100 bg-white">

          {/* Hook line */}
          {hookLine && (
            <div className="rounded-lg bg-gray-50 px-3 py-2.5">
              <p className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">🎣 Hook Line (前1.5秒)</p>
              <p className="text-sm font-semibold text-gray-900 leading-snug">"{hookLine}"</p>
            </div>
          )}

          {/* ── NEW FORMAT: storyboard 2-step flow ─────────────────────── */}
          {hasNewFormat && (
            <>
              {/* Step 1: Storyboard prompt (editable) */}
              <div className="rounded-lg border border-blue-100 overflow-hidden">
                <div className="flex items-start justify-between gap-2 px-3 py-2 bg-blue-50 border-b border-blue-100">
                  <p className="text-[10px] font-bold text-blue-800 leading-snug">
                    🎨 Storyboard 提示词
                    <span className="ml-1 font-normal text-blue-500">（可直接编辑）</span>
                  </p>
                  <CopyButton text={editStoryboard} label="📋 复制" />
                </div>
                <textarea
                  value={editStoryboard}
                  onChange={e => setEditStoryboard(e.target.value)}
                  rows={10}
                  className="w-full px-3 py-2.5 text-[10px] text-blue-900 leading-relaxed font-mono bg-white resize-y border-0 outline-none focus:ring-1 focus:ring-blue-200"
                  spellCheck={false}
                />
              </div>

              {/* Step 2: Seedance prompt (editable) */}
              <div className="rounded-lg border border-purple-100 overflow-hidden">
                <div className="flex items-start justify-between gap-2 px-3 py-2 bg-purple-50 border-b border-purple-100">
                  <p className="text-[10px] font-bold text-purple-800 leading-snug">
                    🎬 Seedance I2V 提示词
                    <span className="ml-1 font-normal text-purple-500">（可直接编辑）</span>
                  </p>
                  <CopyButton text={editSeedance} label="🎬 复制" />
                </div>
                <textarea
                  value={editSeedance}
                  onChange={e => setEditSeedance(e.target.value)}
                  rows={8}
                  className="w-full px-3 py-2.5 text-[10px] text-purple-900 leading-relaxed font-mono bg-white resize-y border-0 outline-none focus:ring-1 focus:ring-purple-200"
                  spellCheck={false}
                />
              </div>
            </>
          )}

          {/* ── LEGACY FORMAT: opening/closing frame prompts ─────────────── */}
          {!hasNewFormat && hasLegacyFormat && (
            <div className="space-y-2">
              <p className="text-[10px] text-gray-400 italic">（旧版帧图格式 — 请重新生成以获取 Storyboard 格式）</p>
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-2.5">
                <div className="flex items-center gap-1 mb-1">
                  <span className="text-[10px] font-bold text-gray-400 uppercase">🖼️ Opening Frame</span>
                  <CopyButton text={r.opening_frame_prompt ?? ''} />
                </div>
                <p className="text-[10px] text-gray-600 italic leading-relaxed">{r.opening_frame_prompt}</p>
              </div>
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-2.5">
                <div className="flex items-center gap-1 mb-1">
                  <span className="text-[10px] font-bold text-gray-400 uppercase">🖼️ Closing Frame</span>
                  <CopyButton text={r.closing_frame_prompt ?? ''} />
                </div>
                <p className="text-[10px] text-gray-600 italic leading-relaxed">{r.closing_frame_prompt}</p>
              </div>
              {r.i2v_video_prompt && (
                <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-2.5">
                  <div className="flex items-center gap-1 mb-1">
                    <span className="text-[10px] font-bold text-gray-400 uppercase">🎬 I2V Prompt</span>
                    <CopyButton text={r.i2v_video_prompt} />
                  </div>
                  <p className="text-[10px] text-indigo-800 leading-relaxed">{r.i2v_video_prompt}</p>
                </div>
              )}
            </div>
          )}

          {/* Scene structure (collapsible) */}
          {reel.scene_structure && reel.scene_structure.length > 0 && (
            <div>
              <button
                onClick={() => setShowScene(o => !o)}
                className="text-[10px] text-gray-400 hover:text-gray-600 font-medium flex items-center gap-1 transition-colors"
              >
                {showScene ? '▲' : '▼'} 查看 9 格场景结构
              </button>
              {showScene && (
                <ol className="mt-2 space-y-1.5">
                  {reel.scene_structure.map((panel, pi) => (
                    <li key={pi} className="text-[10px] text-gray-600 leading-relaxed flex gap-2">
                      <span className="font-bold text-indigo-600 shrink-0 w-5">P{pi + 1}</span>
                      <span>{panel}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {/* Caption */}
          <div>
            <div className="flex items-center gap-1 mb-1">
              <p className="text-[10px] font-bold text-gray-400 uppercase">📝 Caption</p>
              <CopyButton text={reel.caption} />
            </div>
            <p className="text-[11px] text-gray-700 leading-relaxed whitespace-pre-line line-clamp-5">
              {reel.caption}
            </p>
          </div>

          {/* Hashtags */}
          <div className="flex flex-wrap gap-1">
            {(reel.hashtags ?? []).map((h, hi) => (
              <span key={hi} className="text-[10px] bg-blue-50 text-blue-600 rounded px-1.5 py-0.5">
                {h}
              </span>
            ))}
          </div>

          {/* ── Video params + generate button ─────────────────────────── */}
          {hasNewFormat && makeStep === 'idle' && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 space-y-2.5">
              {/* Duration */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-gray-500 uppercase w-14 shrink-0">时长</span>
                <div className="flex gap-1">
                  {([6, 10, 15] as const).map(s => (
                    <button
                      key={s}
                      onClick={() => setDuration(s)}
                      className={`text-[10px] font-semibold px-2 py-1 rounded border transition-colors ${
                        duration === s
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'
                      }`}
                    >
                      {s}s
                    </button>
                  ))}
                </div>
              </div>
              {/* Resolution */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-gray-500 uppercase w-14 shrink-0">分辨率</span>
                <div className="flex gap-1">
                  {(['720p', '1080p'] as const).map(r => (
                    <button
                      key={r}
                      onClick={() => setResolution(r)}
                      className={`text-[10px] font-semibold px-2 py-1 rounded border transition-colors ${
                        resolution === r
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              {/* Generate button */}
              <button
                onClick={handleMake}
                className="w-full py-2 text-xs font-bold bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white rounded-lg transition-all"
              >
                🚀 生成 Reel &nbsp;·&nbsp; {duration}s · {resolution} · 9:16
              </button>
            </div>
          )}

          {makeStep !== 'idle' && (
            <div className="rounded-lg border bg-gray-50 px-3 py-2.5 space-y-2">

              {/* Progress steps */}
              <div className="flex items-center gap-2 text-[10px] font-medium">
                <StepDot active={makeStep === 'creating'} done={['storyboard','video','done','error'].includes(makeStep)} label="草稿" />
                <span className="text-gray-300">→</span>
                <StepDot active={makeStep === 'storyboard'} done={['video','done','error'].includes(makeStep)} label="故事板" />
                <span className="text-gray-300">→</span>
                <StepDot active={makeStep === 'video'} done={makeStep === 'done'} label="视频" />
              </div>

              {makeStep === 'creating' && (
                <p className="text-xs text-gray-500 flex items-center gap-1.5">
                  <Spinner color="indigo" /> 创建草稿…
                </p>
              )}
              {makeStep === 'storyboard' && (
                <p className="text-xs text-indigo-700 flex items-center gap-1.5">
                  <Spinner color="indigo" /> 🎨 Visual Studio 生成9格故事板图片中…（约 15–25s）
                </p>
              )}
              {makeStep === 'video' && (
                <div className="space-y-1.5">
                  {storyboardUrl && (
                    <div>
                      <p className="text-[10px] text-gray-400 mb-1">✅ 故事板图片已生成</p>
                      <img
                        src={storyboardUrl}
                        alt="9-panel storyboard"
                        className="w-full max-w-[160px] rounded border border-gray-200"
                      />
                    </div>
                  )}
                  <p className="text-xs text-purple-600 flex items-center gap-1.5">
                    <Spinner color="purple" /> 🎬 Video Studio 生成 Reel 视频中…（约 2–3 分钟）
                  </p>
                </div>
              )}
              {makeStep === 'error' && (
                <div className="space-y-1">
                  <p className="text-xs text-red-600">⚠ {makeError}</p>
                  <button
                    onClick={() => { setMakeStep('idle'); setMakeError(null) }}
                    className="text-[10px] text-gray-400 hover:text-gray-600 underline"
                  >
                    重试
                  </button>
                </div>
              )}
              {makeStep === 'done' && videoUrl && (
                <div className="space-y-2">
                  <p className="text-xs text-green-600 font-semibold">✅ Reel 视频生成完成！</p>
                  <div className="flex gap-3 items-start flex-wrap">
                    {storyboardUrl && (
                      <img
                        src={storyboardUrl}
                        alt="storyboard"
                        className="w-[80px] rounded border border-gray-200 shrink-0"
                      />
                    )}
                    <video
                      src={videoUrl}
                      controls
                      className="w-full max-w-[180px] rounded-lg border border-gray-200"
                    />
                  </div>
                  <div className="flex gap-3 flex-wrap">
                    <a href={storyboardUrl ?? '#'} download target="_blank" rel="noreferrer"
                       className="text-[11px] text-indigo-500 hover:underline">↓ 故事板图片</a>
                    <a href={videoUrl} download target="_blank" rel="noreferrer"
                       className="text-[11px] text-purple-600 hover:underline font-medium">↓ 下载视频</a>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const POST_TYPE_COLOR: Record<string, string> = {
  educational:  'bg-emerald-50 text-emerald-700 border-emerald-200',
  promotional:  'bg-amber-50 text-amber-700 border-amber-200',
  storytelling: 'bg-purple-50 text-purple-700 border-purple-200',
  engagement:   'bg-blue-50 text-blue-700 border-blue-200',
}

function PostCard({ post }: { post: Post }) {
  const [open, setOpen] = useState(false)
  const colorClass = POST_TYPE_COLOR[post.content_type] ?? 'bg-gray-50 text-gray-700 border-gray-200'
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-gray-50 hover:bg-gray-100 text-left transition-colors"
      >
        <span className={`text-[10px] font-bold border rounded px-1.5 py-0.5 shrink-0 ${colorClass}`}>
          {post.content_type}
        </span>
        <p className="flex-1 text-xs text-gray-700 truncate">{(post.copy ?? '').slice(0, 80)}…</p>
        <span className="text-gray-400 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-4 py-3 space-y-2.5 border-t border-gray-100 bg-white">
          <p className="text-[11px] text-gray-700 leading-relaxed whitespace-pre-line">{post.copy}</p>
          <div>
            <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Image Prompt</p>
            <p className="text-[11px] text-gray-500 italic leading-relaxed">{post.image_prompt}</p>
          </div>
          <div className="flex flex-wrap gap-1">
            {post.hashtags.map((h, hi) => (
              <span key={hi} className="text-[10px] bg-blue-50 text-blue-600 rounded px-1.5 py-0.5">{h}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StoryCard({ index, story }: { index: number; story: Story }) {
  return (
    <div className="border border-gray-200 rounded-lg px-4 py-3 bg-white flex gap-3">
      <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-700 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
        {index + 1}
      </span>
      <div className="flex-1 min-w-0 space-y-1">
        <p className="text-xs font-semibold text-gray-800">{story.copy}</p>
        <p className="text-[11px] text-indigo-600 font-medium">→ {story.cta}</p>
        <p className="text-[11px] text-gray-400 italic truncate">{story.visual_prompt}</p>
      </div>
    </div>
  )
}

// ─── Utility micro-components ──────────────────────────────────────────────────

function Spinner({ color }: { color: 'indigo' | 'purple' }) {
  const ring = color === 'purple'
    ? 'border-purple-400 border-t-transparent'
    : 'border-indigo-400 border-t-transparent'
  return (
    <span className={`w-3.5 h-3.5 border-2 ${ring} rounded-full animate-spin inline-block shrink-0`} />
  )
}

function StepDot({
  active, done, label,
}: { active: boolean; done: boolean; label: string }) {
  const base = 'flex items-center gap-1'
  const dot = done
    ? 'w-3 h-3 rounded-full bg-green-400 shrink-0'
    : active
      ? 'w-3 h-3 rounded-full bg-indigo-500 animate-pulse shrink-0'
      : 'w-3 h-3 rounded-full bg-gray-200 shrink-0'
  const text = done
    ? 'text-green-600'
    : active
      ? 'text-indigo-700 font-semibold'
      : 'text-gray-400'
  return (
    <span className={base}>
      <span className={dot} />
      <span className={text}>{label}</span>
    </span>
  )
}
