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
 *   Step 1 -> storyboard_image_prompt (copy -> Visual Studio -> 9-panel storyboard)
 *   Step 2 -> seedance_i2v_prompt (upload storyboard + copy -> Video Studio -> 15s video)
 *
 * Plan history is loaded on mount from GET /api/clients/[id]/social-plan.
 * Generating a new plan prepends it to history (old plans stay visible).
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import type { SocialPlanOutput, ReelsScript, Post, Story, GenerationConfig } from '@/lib/social/social-plan-templates'
import { DEFAULT_CONFIG } from '@/lib/social/social-plan-templates'
import type { ExecutionItem } from '@/types/diagnostic'

// ─── Task-kind helpers ─────────────────────────────────────────────────────────

type SocialTaskKind = 'social_post' | 'social_reel' | 'social_story'

const KIND_LABELS: Record<SocialTaskKind, string> = {
  social_post:  '图文帖子',
  social_reel:  '短视频 Reel',
  social_story: 'Story',
}

const KIND_PLAN_CONFIG: Record<SocialTaskKind, Pick<GenerationConfig, 'posts_count' | 'stories_count' | 'reels_count'>> = {
  social_post:  { posts_count: 1, stories_count: 0, reels_count: 0 },
  social_reel:  { posts_count: 0, stories_count: 0, reels_count: 1 },
  social_story: { posts_count: 0, stories_count: 1, reels_count: 0 },
}

const KIND_TAB: Record<SocialTaskKind, PlanTab> = {
  social_post:  'posts',
  social_reel:  'reels',
  social_story: 'stories',
}

const SUPPORTED_PLATFORMS = new Set(['facebook', 'instagram', 'tiktok'])

function resolveTaskKind(item: ExecutionItem | undefined): SocialTaskKind | null {
  const kind = item?.steps_json?.kind
  if (kind === 'social_post' || kind === 'social_reel' || kind === 'social_story') return kind
  return null
}

function resolveTaskPlatform(item: ExecutionItem | undefined): GenerationConfig['platform'] | null {
  const p = item?.steps_json?.platform as string | undefined
  if (p && SUPPORTED_PLATFORMS.has(p)) return p as GenerationConfig['platform']
  // Fallback: detect platform from item title prefix (e.g. "TikTok: '3 Reasons…'")
  const title = (item?.title ?? '').toLowerCase()
  if (/^tiktok[\s:']/.test(title)) return 'tiktok'
  if (/^instagram[\s:']/.test(title)) return 'instagram'
  return null
}

function briefCardVisible(mode: Props['mode'], taskKind: SocialTaskKind | null): boolean {
  if (!taskKind) return false
  if (mode === 'all') return true
  if (mode === 'social') return taskKind === 'social_post' || taskKind === 'social_story'
  if (mode === 'video') return taskKind === 'social_reel'
  return false
}

// ─── GenerateOverrides ─────────────────────────────────────────────────────────

interface GenerateOverrides {
  platform?: GenerationConfig['platform']
  posts_count?: number
  stories_count?: number
  reels_count?: number
  angle_focus?: string
}

interface BackgroundGenerateParams {
  campaignId: string
  platform: GenerationConfig['platform']
  posts_count: number
  stories_count: number
  reels_count: number
  angle_focus?: string
}

interface Props {
  clientId: string
  campaignId: string | undefined
  campaignName: string | undefined
  /** Controls which sub-tabs are visible.
   *  'social' → Posts + Stories only (图文帖子 tab)
   *  'video'  → Reels only (短视频 tab)
   *  'all'    → all three (default, legacy usage)
   */
  mode?: 'all' | 'social' | 'video'
  /** When opened from a specific Kanban task, pass the item so the brief card appears. */
  item?: ExecutionItem
  /** When set, clicking "生成这条X" hands off to the parent and closes the drawer immediately. */
  onBackgroundGenerate?: (params: BackgroundGenerateParams) => void
  /** Called when any Post/Story image generation starts (true) or all finish (false).
   *  Parent uses this to show "制作中" badge on the kanban card. */
  onImageGeneratingChange?: (active: boolean) => void
  /** When set, image generation is handed off to the parent (runs in background after drawer closes).
   *  Parent receives the prompt + aspectRatio + post_id (optional), persists to visual_assets DB,
   *  returns the created asset. When post_id is omitted, parent falls back to non-persistent preview
   *  (used in batch mode where no specific content_post is bound to the card). */
  onBackgroundImageGenerate?: (params: ImageGenerateParams) => Promise<GalleryAsset>
}

export interface GalleryAsset {
  id: string
  storage_url: string
  prompt_used: string | null
  is_selected: boolean
  created_at: string
}

interface ImageGenerateParams {
  prompt: string
  aspectRatio: string
  postId?: string
}

interface PlanRecord {
  id: string
  wave_number: number
  created_at: string
  plan_data: SocialPlanOutput
}

type PlanTab = 'reels' | 'posts' | 'stories'

export function SocialPlanSection({ clientId, campaignId, campaignName, mode = 'all', item, onBackgroundGenerate, onImageGeneratingChange, onBackgroundImageGenerate }: Props) {
  const taskKind     = resolveTaskKind(item)
  const taskPlatform = resolveTaskPlatform(item)
  const showBrief    = briefCardVisible(mode, taskKind)
  const isTaskMode   = showBrief && taskKind !== null
  const [loading, setLoading]               = useState(false)
  const [plan, setPlan]                     = useState<SocialPlanOutput | null>(null)
  const [planId, setPlanId]                 = useState<string | null>(null)
  const [error, setError]                   = useState<string | null>(null)
  const [planTab, setPlanTab]               = useState<PlanTab>(mode === 'video' ? 'reels' : 'posts')
  const [planHistory, setPlanHistory]       = useState<PlanRecord[]>([])
  const [historyLoaded, setHistoryLoaded]   = useState(false)

  // FDE generation config (customisable before generating)
  const [config, setConfig]                 = useState<GenerationConfig>(DEFAULT_CONFIG)
  const [settingsOpen, setSettingsOpen]     = useState(false)
  const [angleFocusInput, setAngleFocusInput] = useState('')

  // Image-generation in-flight counter — drives kanban "制作中" badge
  const [imageGenCount, setImageGenCount]   = useState(0)
  const onImageGeneratingChangeRef = useRef(onImageGeneratingChange)
  useEffect(() => { onImageGeneratingChangeRef.current = onImageGeneratingChange }, [onImageGeneratingChange])
  useEffect(() => {
    onImageGeneratingChangeRef.current?.(imageGenCount > 0)
  }, [imageGenCount])
  const incImageGen = useCallback(() => setImageGenCount(c => c + 1), [])
  const decImageGen = useCallback(() => setImageGenCount(c => Math.max(0, c - 1)), [])

  // Save-to-board state
  const [savingBoard, setSavingBoard]       = useState(false)
  const [boardMsg, setBoardMsg]             = useState<string | null>(null)

  // Task mode: bound content_post id + its existing assets (used to restore
  // the gallery after drawer closes / page reloads).
  const [taskPostId, setTaskPostId]         = useState<string | undefined>(undefined)
  const [taskAssets, setTaskAssets]         = useState<GalleryAsset[] | undefined>(undefined)

  // Load the persisted content_post for this execution item (task mode only).
  // If none exists yet (common for marketing-plan tasks where save-to-board
  // was never run), auto-create an empty draft so the gallery + asset-library
  // picker have a stable post_id to bind to.
  useEffect(() => {
    if (!isTaskMode || !item?.id) return
    const itemId = item.id
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/posts?execution_item_id=${itemId}`)
        const data = await res.json() as { posts?: { id: string }[] }
        let postId = data.posts?.[0]?.id

        if (!postId) {
          // Auto-create empty draft bound to this execution_item.
          const createRes = await fetch(`/api/clients/${clientId}/posts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ execution_item_id: itemId }),
          })
          const createJson = await createRes.json() as { post?: { id: string }; error?: string }
          postId = createJson.post?.id
        }

        if (postId) {
          setTaskPostId(postId)
          const assetsRes = await fetch(`/api/clients/${clientId}/visual-assets?post_id=${postId}`)
          const assetsJson = await assetsRes.json() as { success: boolean; assets?: GalleryAsset[] }
          if (assetsJson.success) setTaskAssets(assetsJson.assets ?? [])
        }
      } catch { /* non-fatal — gallery / picker just stays empty */ }
    })()
  }, [isTaskMode, clientId, item?.id])

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
          // Always pre-load the most recent plan so FDE can review/edit generated content
          setPlan(records[0].plan_data)
          setPlanId(records[0].id)
          // Auto-switch to the tab matching the task kind
          if (isTaskMode && taskKind) {
            setPlanTab(KIND_TAB[taskKind])
          }
        }
      })
      .catch(() => { /* non-fatal */ })
      .finally(() => setHistoryLoaded(true))
  }, [clientId, campaignId])

  async function handleSaveToBoard(type: 'posts' | 'stories') {
    if (!planId) return
    setSavingBoard(true)
    setBoardMsg(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/social-plan/${planId}/save-to-board`, {
        method: 'POST',
      })
      const json = await res.json() as { success: boolean; saved_posts?: number; saved_stories?: number; error?: string }
      if (!json.success) throw new Error(json.error ?? 'Save failed')
      const count = type === 'posts' ? (json.saved_posts ?? 0) : (json.saved_stories ?? 0)
      setBoardMsg(`saved:${count}:${type}`)
    } catch (e) {
      setBoardMsg(`error:${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSavingBoard(false)
    }
  }

  async function generate(overrides?: GenerateOverrides) {
    if (!campaignId) return
    setLoading(true)
    setError(null)
    try {
      const angleText = overrides?.angle_focus?.trim() || angleFocusInput.trim()
      const payload = {
        campaign_brief_id: campaignId,
        platform:          overrides?.platform   ?? config.platform,
        reels_count:       overrides?.reels_count   ?? config.reels_count,
        posts_count:       overrides?.posts_count   ?? config.posts_count,
        stories_count:     overrides?.stories_count ?? config.stories_count,
        ...(angleText ? { angle_focus: angleText } : {}),
      }
      const res = await fetch(`/api/clients/${clientId}/social-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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

  async function generateFocused() {
    if (!campaignId || !taskKind || !item) return
    const overrides: GenerateOverrides = {
      ...KIND_PLAN_CONFIG[taskKind],
      angle_focus: item.description || item.title,
      ...(taskPlatform ? { platform: taskPlatform } : {}),
    }

    if (onBackgroundGenerate) {
      // Background mode: hand off to parent which closes the drawer and tracks progress
      onBackgroundGenerate({
        campaignId,
        platform: overrides.platform ?? config.platform,
        posts_count: overrides.posts_count ?? config.posts_count,
        stories_count: overrides.stories_count ?? config.stories_count,
        reels_count: overrides.reels_count ?? config.reels_count,
        ...(overrides.angle_focus ? { angle_focus: overrides.angle_focus } : {}),
      })
      return
    }

    // Foreground mode (original behavior — keeps drawer open during generation)
    setConfig(c => ({
      ...c,
      posts_count:   overrides.posts_count   ?? c.posts_count,
      stories_count: overrides.stories_count ?? c.stories_count,
      reels_count:   overrides.reels_count   ?? c.reels_count,
      ...(overrides.platform ? { platform: overrides.platform } : {}),
    }))
    setAngleFocusInput(overrides.angle_focus ?? '')
    setPlanTab(KIND_TAB[taskKind])
    await generate(overrides)
  }

  return (
    <div className="mb-6 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">

      {/* Task Brief Card — only when opened from a specific content task */}
      {showBrief && item && taskKind && (
        <div className="border-b border-cyan-200 bg-cyan-50 px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-[0.12em] text-cyan-700">
              任务摘要
            </span>
            <span className="rounded-full border border-cyan-300 bg-white px-2 py-0.5 text-[10px] font-bold text-cyan-800">
              {KIND_LABELS[taskKind]}
            </span>
            {taskPlatform && (
              <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold capitalize text-slate-600">
                {taskPlatform}
              </span>
            )}
            {item.due_date && (
              <span className="ml-auto text-[10px] font-semibold text-slate-400">
                截止 {new Date(item.due_date).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
              </span>
            )}
          </div>
          <h4 className="mt-2 text-sm font-black leading-snug text-slate-950">{item.title}</h4>
          {item.description && item.description !== item.title && (
            <p className="mt-1 line-clamp-3 text-xs leading-5 text-slate-600">{item.description}</p>
          )}
          {item.status === 'in_progress' ? (
            <div className="mt-3 flex items-center gap-3">
              <span className="text-[11px] font-semibold text-green-700">✓ 内容已生成，可在下方查看和调整</span>
              <button
                onClick={() => void generateFocused()}
                disabled={loading || !campaignId}
                className="text-[11px] font-bold text-slate-400 hover:text-slate-600 underline disabled:opacity-50"
              >
                {loading ? '生成中…' : '重新生成'}
              </button>
            </div>
          ) : (
            <button
              onClick={() => void generateFocused()}
              disabled={loading || !campaignId}
              className="mt-3 flex items-center gap-2 rounded-lg bg-cyan-700 px-4 py-2 text-xs font-black text-white transition hover:bg-cyan-800 disabled:opacity-50"
            >
              {loading
                ? <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />生成中…</>
                : `生成这条${KIND_LABELS[taskKind]}`
              }
            </button>
          )}
          {!campaignId && (
            <p className="mt-1.5 text-[11px] font-semibold text-amber-700">需要先设置 Active Campaign 才能生成</p>
          )}
        </div>
      )}

      {/* Header — batch mode only; hidden when working on a specific task */}
      {!isTaskMode && (
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-[#f6f7f2] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="min-w-0">
            <h3 className="text-base font-black text-slate-950">Social Plan Studio</h3>
            <p className="mt-1 text-xs font-semibold text-slate-500">
              {mode === 'video'
                ? `Strategy to ${config.reels_count} Reels`
                : mode === 'social'
                  ? `Strategy to ${config.posts_count} Posts, ${config.stories_count} Stories`
                  : `Strategy to ${config.reels_count} Reels, ${config.posts_count} Posts, ${config.stories_count} Stories`
              }
              <span className="mx-2 text-slate-300">/</span>
              <span className="capitalize text-cyan-700">{config.platform}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {campaignId && (
              <button
                onClick={() => setSettingsOpen(v => !v)}
                title="生成设置"
                className={`flex h-10 items-center gap-2 rounded-lg border px-3 text-xs font-black transition-colors ${
                  settingsOpen
                    ? 'border-slate-950 bg-slate-950 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                }`}
              >
                Settings
                <span className="text-[10px]">{settingsOpen ? 'Up' : 'Down'}</span>
              </button>
            )}
            {campaignId ? (
              <button
                onClick={() => void generate()}
                disabled={loading}
                className="flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-xs font-black text-white transition hover:bg-slate-800 disabled:opacity-60"
              >
                {loading ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>{plan ? 'Regenerate' : 'Generate plan'}</>
                )}
              </button>
            ) : (
              <span className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                Active campaign required
              </span>
            )}
          </div>
        </div>
      )}

      {/* FDE Settings Panel — batch mode only */}
      {!isTaskMode && settingsOpen && campaignId && (
        <div className="space-y-4 border-b border-slate-200 bg-white px-4 py-4 sm:px-5">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Generation settings</p>

          {/* Platform */}
          <div className="grid gap-2 sm:grid-cols-[96px_1fr] sm:items-center">
            <span className="text-xs font-bold text-slate-500">Platform</span>
            <div className="flex flex-wrap gap-1">
              {(['facebook', 'instagram', 'tiktok'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setConfig(c => ({ ...c, platform: p }))}
                  className={`rounded-full border px-3 py-1 text-xs font-bold capitalize transition-colors ${
                    config.platform === p
                      ? 'border-slate-950 bg-slate-950 text-white'
                      : 'border-slate-300 bg-white text-slate-600 hover:border-slate-500'
                  }`}
                >
                  {p === 'facebook' ? 'Facebook' : p === 'instagram' ? 'Instagram' : 'TikTok'}
                </button>
              ))}
            </div>
          </div>

          {/* Reels count */}
          <div className="grid gap-2 sm:grid-cols-[96px_1fr] sm:items-center">
            <span className="text-xs font-bold text-slate-500">Reels</span>
            <div className="flex flex-wrap gap-1">
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  onClick={() => setConfig(c => ({ ...c, reels_count: n }))}
                  className={`w-8 h-8 text-xs rounded-lg border font-medium transition-colors ${
                    config.reels_count === n
                      ? 'border-slate-950 bg-slate-950 text-white'
                      : 'border-slate-300 bg-white text-slate-600 hover:border-slate-500'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Posts count */}
          <div className="grid gap-2 sm:grid-cols-[96px_1fr] sm:items-center">
            <span className="text-xs font-bold text-slate-500">Posts</span>
            <div className="flex flex-wrap gap-1">
              {[0, 3, 5, 7, 10].map(n => (
                <button
                  key={n}
                  onClick={() => setConfig(c => ({ ...c, posts_count: n }))}
                  className={`rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
                    config.posts_count === n
                      ? 'border-slate-950 bg-slate-950 text-white'
                      : 'border-slate-300 bg-white text-slate-600 hover:border-slate-500'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Stories count */}
          <div className="grid gap-2 sm:grid-cols-[96px_1fr] sm:items-center">
            <span className="text-xs font-bold text-slate-500">Stories</span>
            <div className="flex flex-wrap gap-1">
              {[0, 2, 3, 5].map(n => (
                <button
                  key={n}
                  onClick={() => setConfig(c => ({ ...c, stories_count: n }))}
                  className={`rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
                    config.stories_count === n
                      ? 'border-slate-950 bg-slate-950 text-white'
                      : 'border-slate-300 bg-white text-slate-600 hover:border-slate-500'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Angle focus hint */}
          <div className="grid gap-2 sm:grid-cols-[96px_1fr] sm:items-center">
            <span className="text-xs font-bold text-slate-500">Angle focus</span>
            <input
              type="text"
              value={angleFocusInput}
              onChange={e => setAngleFocusInput(e.target.value)}
              placeholder="Optional: seasonal promotion, price launch..."
              className="min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 placeholder-slate-400 focus:border-slate-500 focus:outline-none"
            />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="border-b border-red-100 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700 sm:px-5">
          {error}
        </div>
      )}

      {/* Loading state (first generation, no plan yet) */}
      {loading && !plan && (
        <div className="px-4 py-10 text-center text-sm font-semibold text-slate-500 sm:px-5">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-950" />
          Strategy Engine is preparing the plan. Content Engine is drafting the production set.
        </div>
      )}

      {/* Results */}
      {plan && (
        isTaskMode ? (
          /* ── Task mode: single card + Launch Hub ───────────────────────────── */
          <div className="space-y-4 px-4 py-4 sm:px-5">
            {taskKind === 'social_post' && plan.posts[0] && (
              <PostCard
                post={plan.posts[0]}
                clientId={clientId}
                launchHubPlatform={taskPlatform ?? config.platform}
                onGenStart={incImageGen}
                onGenEnd={decImageGen}
                onBackgroundImageGenerate={onBackgroundImageGenerate}
                postId={taskPostId}
                initialAssets={taskAssets}
              />
            )}
            {taskKind === 'social_story' && plan.stories[0] && (
              <StoryCard index={0} story={plan.stories[0]} clientId={clientId}
                launchHubPlatform={taskPlatform ?? config.platform}
                onGenStart={incImageGen}
                onGenEnd={decImageGen}
                onBackgroundImageGenerate={onBackgroundImageGenerate}
                postId={taskPostId}
                initialAssets={taskAssets}
              />
            )}
            {taskKind === 'social_reel' && plan.reels[0] && (
              <ReelCard index={0} reel={plan.reels[0]} clientId={clientId} campaignId={campaignId} />
            )}
          </div>
        ) : (
        <div className="space-y-4 px-4 py-4 sm:px-5">

          {/* History pill selector */}
          {planHistory.length > 1 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <span className="shrink-0 text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">History</span>
              {planHistory.map((rec, i) => (
                <button
                  key={rec.id}
                  onClick={() => { setPlan(rec.plan_data); setPlanId(rec.id) }}
                  className={`shrink-0 text-[10px] font-medium rounded-full px-2.5 py-1 border transition-colors ${
                    planId === rec.id
                      ? 'border-slate-950 bg-slate-950 text-white'
                      : 'border-slate-200 bg-white text-slate-500 hover:border-slate-400'
                  }`}
                >
                  #{planHistory.length - i}&nbsp;
                  {new Date(rec.created_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                </button>
              ))}
            </div>
          )}

          {/* Storyboard workflow notice */}
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[11px] font-semibold leading-relaxed text-amber-900">
            Recommended workflow: use this 9-panel storyboard flow, then use Reels Studio below for frame-based production.
          </div>

          {/* Strategy card */}
          <div className="space-y-2 rounded-lg border border-slate-200 bg-[#f6f7f2] p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-slate-500">
              <span>Strategy</span>
              {planId && (
                <span className="ml-auto font-mono text-[11px] font-semibold normal-case text-slate-400">
                  plan id: {planId.slice(0, 8)}
                </span>
              )}
            </div>
            <p className="text-base font-semibold leading-7 text-slate-900">{plan.strategy.theme}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(plan.strategy.content_pillars ?? []).map((p, i) => (
                <span key={i} className="rounded-full border border-cyan-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-cyan-800">
                  {p}
                </span>
              ))}
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              <strong>Tone:</strong> {plan.strategy.tone_guidance}
            </p>
            {campaignName && (
              <p className="text-xs text-slate-500">
                <strong>Campaign:</strong> {campaignName}
              </p>
            )}
          </div>

          {/* Sub-tabs — filtered by mode */}
          <div className="-mx-4 flex gap-2 overflow-x-auto border-b border-slate-200 px-4 sm:-mx-5 sm:px-5">
            {([
              ['reels',   `Reels (${plan.reels.length})`],
              ['posts',   `Posts (${plan.posts.length})`],
              ['stories', `Stories (${plan.stories.length})`],
            ] as const).filter(([val]) =>
              mode === 'social' ? val !== 'reels' :
              mode === 'video'  ? val === 'reels' :
              true
            ).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setPlanTab(val)}
                className={`-mb-px shrink-0 border-b-2 px-3 py-2.5 text-xs font-black transition-colors ${
                  planTab === val
                    ? 'border-slate-950 text-slate-950'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
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
              <SaveToBoardBar
                label="Posts"
                count={plan.posts.length}
                saving={savingBoard}
                msg={boardMsg}
                clientId={clientId}
                onSave={() => void handleSaveToBoard('posts')}
                type="posts"
              />
              {plan.posts.map((post, i) => (
                <PostCard key={i} post={post} clientId={clientId} onGenStart={incImageGen} onGenEnd={decImageGen} onBackgroundImageGenerate={onBackgroundImageGenerate} />
              ))}
            </div>
          )}

          {planTab === 'stories' && (
            <div className="space-y-2">
              <SaveToBoardBar
                label="Stories"
                count={plan.stories.length}
                saving={savingBoard}
                msg={boardMsg}
                clientId={clientId}
                onSave={() => void handleSaveToBoard('stories')}
                type="stories"
              />
              {plan.stories.map((story, i) => (
                <StoryCard key={i} index={i} story={story} clientId={clientId} onGenStart={incImageGen} onGenEnd={decImageGen} onBackgroundImageGenerate={onBackgroundImageGenerate} />
              ))}
            </div>
          )}
        </div>
        ) /* end of batch-mode ternary branch */
      )}

      {/* Empty state */}
      {!loading && !plan && !error && campaignId && historyLoaded && (
        <div className="px-4 py-8 text-center text-xs font-semibold text-slate-400 sm:px-5">
          Generate a Social Plan to create this campaign's reels, posts, and stories.
        </div>
      )}

      {/* History loading spinner */}
      {!historyLoaded && (
        <div className="flex justify-center px-4 py-4 sm:px-5">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-950" />
        </div>
      )}
    </div>
  )
}

// ─── SaveToBoardBar ────────────────────────────────────────────────────────────

function SaveToBoardBar({
  label, count, saving, msg, clientId, onSave, type,
}: {
  label: string
  count: number
  saving: boolean
  msg: string | null
  clientId: string
  onSave: () => void
  type: 'posts' | 'stories'
}) {
  const isSuccess = msg?.startsWith('saved:') && msg.includes(`:${type}`)
  const isError   = msg?.startsWith('error:')
  const savedCount = isSuccess ? parseInt(msg!.split(':')[1], 10) : 0

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        onClick={onSave}
        disabled={saving || count === 0}
        className="flex min-h-9 items-center gap-1.5 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-xs font-black text-cyan-800 transition-colors hover:bg-cyan-100 disabled:opacity-50"
      >
        {saving ? (
          <><span className="h-3 w-3 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" /> Saving...</>
        ) : (
          <>Save all {label} to content board</>
        )}
      </button>
      {isSuccess && (
        <span className="text-xs font-semibold text-cyan-800">
          Saved {savedCount} {label}.
          <a href={`/dashboard/content?client=${clientId}`} className="underline font-medium ml-1">
            Open content board
          </a>
        </span>
      )}
      {isError && (
        <span className="text-xs font-semibold text-red-600">{msg!.replace('error:', '')}</span>
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
      className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-black text-slate-500 transition-colors hover:border-slate-400 hover:text-slate-800"
      title="Copy to clipboard"
    >
      {copied ? 'Copied' : label}
    </button>
  )
}

const ANGLE_TAG_COLOR: Record<string, string> = {
  price_attack:   'bg-rose-50 text-rose-700 border-rose-200',
  speed_attack:   'bg-orange-50 text-orange-700 border-orange-200',
  trust_attack:   'bg-emerald-50 text-emerald-700 border-emerald-200',
  scarcity:       'bg-amber-50 text-amber-700 border-amber-200',
  seasonal:       'bg-sky-50 text-sky-700 border-sky-200',
  education:      'bg-violet-50 text-violet-700 border-violet-200',
  social_proof:   'bg-teal-50 text-teal-700 border-teal-200',
  aspirational:   'bg-purple-50 text-purple-700 border-purple-200',
}

// Accept both the new storyboard schema and the legacy frame-prompt schema
type AnyReel = ReelsScript & {
  hook?: string                  // legacy field name
  opening_frame_prompt?: string  // legacy field
  closing_frame_prompt?: string  // legacy field
  i2v_video_prompt?: string      // legacy field
}

// storyboard_ready = storyboard image generated, waiting for user to click "generate video"
type MakeStep = 'idle' | 'creating' | 'storyboard_generating' | 'storyboard_ready' | 'video' | 'done' | 'error'

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
  const [lightboxOpen, setLightboxOpen] = useState(false)

  const r = reel as AnyReel
  const hookLine    = r.hook_line ?? r.hook ?? ''
  const angleColor  = ANGLE_TAG_COLOR[r.angle_tag ?? ''] ?? 'bg-gray-50 text-gray-600 border-gray-200'
  const hasNewFormat    = Boolean(r.storyboard_image_prompt)
  const hasLegacyFormat = Boolean(r.opening_frame_prompt)

  // Editable prompts — user can tweak before generating
  const [editStoryboard, setEditStoryboard] = useState(r.storyboard_image_prompt ?? '')
  const [editVideoPrompt, setEditVideoPrompt] = useState(r.seedance_i2v_prompt ?? '')

  // Video generation parameters
  const [duration,       setDuration]       = useState<6 | 10 | 15>(15)
  const [resolution,     setResolution]     = useState<'480p' | '720p' | '1080p'>('720p')
  const [generateAudio,  setGenerateAudio]  = useState(false)

  // Poll video generation, every 15s.
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

  // ── Step A: create draft + generate storyboard image ───────────────────────
  const handleMakeStoryboard = useCallback(async () => {
    if (!editStoryboard) return
    setMakeStep('creating')
    setMakeError(null)
    try {
      // 1. Create reels_draft (uses the user-edited prompts)
      const cr = await fetch(`/api/clients/${clientId}/reels/create-from-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storyboard_prompt: editStoryboard,
          i2v_prompt:        editVideoPrompt,
          caption:           reel.caption,
          campaign_brief_id: campaignId,
        }),
      })
      const cd = await cr.json() as { success: boolean; draft?: { id: string }; error?: string }
      if (!cd.success || !cd.draft) throw new Error(cd.error ?? 'Failed to create draft')
      const newDraftId = cd.draft.id
      setDraftId(newDraftId)

      // 2. Generate storyboard image via Visual Studio (synchronous, ~15-25s)
      setMakeStep('storyboard_generating')
      const sr = await fetch(
        `/api/clients/${clientId}/reels/${newDraftId}/generate-storyboard`,
        { method: 'POST' },
      )
      const sd = await sr.json() as { success: boolean; image_url?: string; error?: string }
      if (!sd.success) throw new Error(sd.error ?? 'Storyboard generation failed')
      setStoryboardUrl(sd.image_url ?? null)
      setMakeStep('storyboard_ready')

    } catch (e) {
      setMakeError(e instanceof Error ? e.message : String(e))
      setMakeStep('error')
    }
  }, [editStoryboard, editVideoPrompt, reel.caption, clientId, campaignId])

  // Step B: submit Video Studio job after the user reviews the storyboard.
  const handleMakeVideo = useCallback(async () => {
    if (!draftId || !editVideoPrompt) return
    setMakeError(null)
    try {
      const vr = await fetch(
        `/api/clients/${clientId}/reels/${draftId}/generate-video`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ duration, resolution, generate_audio: generateAudio }),
        },
      )
      const vd = await vr.json() as { success: boolean; error?: string }
      if (!vd.success) throw new Error(vd.error ?? 'Failed to start video generation')
      setMakeStep('video')
    } catch (e) {
      setMakeError(e instanceof Error ? e.message : String(e))
      setMakeStep('error')
    }
  }, [draftId, editVideoPrompt, clientId, duration, resolution, generateAudio])

  // ── Shared parameter bar (used in both idle and storyboard_ready) ───────────
  const ParamBar = (
    <div className="space-y-2">
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
          {(['480p', '720p', '1080p'] as const).map(res => (
            <button
              key={res}
              onClick={() => setResolution(res)}
              className={`text-[10px] font-semibold px-2 py-1 rounded border transition-colors ${
                resolution === res
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'
              }`}
            >
              {res}
            </button>
          ))}
        </div>
      </div>
      {/* Audio toggle */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold text-gray-500 uppercase w-14 shrink-0">配音</span>
        <button
          onClick={() => setGenerateAudio(a => !a)}
          className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors focus:outline-none ${
            generateAudio ? 'bg-indigo-600' : 'bg-gray-200'
          }`}
        >
          <span
            className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${
              generateAudio ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
        <span className="text-[10px] text-gray-500">{generateAudio ? '开启 AI 配乐' : '无音频'}</span>
      </div>
    </div>
  )

  return (
    <>
      {/* Lightbox — storyboard full-size overlay */}
      {lightboxOpen && storyboardUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxOpen(false)}
        >
          <div className="relative max-h-full max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setLightboxOpen(false)}
              className="absolute -top-8 right-0 text-white text-sm font-bold hover:text-gray-300"
            >
              ✕ 关闭
            </button>
            <img
              src={storyboardUrl}
              alt="9-panel storyboard (full size)"
              className="w-full rounded-lg shadow-2xl"
            />
            <a
              href={storyboardUrl}
              download
              target="_blank"
              rel="noreferrer"
              className="mt-2 block text-center text-[11px] text-indigo-300 hover:text-white"
              onClick={e => e.stopPropagation()}
            >
              ↓ 下载故事板图片
            </a>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200">

        {/* Accordion header */}
        <button
          onClick={() => setOpen(o => !o)}
          className="flex w-full items-center gap-3 bg-white px-4 py-3 text-left transition-colors hover:bg-[#f6f7f2]"
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-950 text-[10px] font-black text-white">
            {index + 1}
          </span>
          <div className="flex-1 min-w-0">
            <p className="truncate text-xs font-black text-slate-900">{reel.title}</p>
            {hookLine && <p className="truncate text-[11px] font-semibold text-slate-500">{hookLine}</p>}
          </div>
          {r.angle_tag && (
            <span className={`text-[10px] font-semibold border rounded px-1.5 py-0.5 shrink-0 ${angleColor}`}>
              {r.angle_tag.replace('_', ' ')}
            </span>
          )}
          <span className="ml-1 text-xs font-black text-slate-400">{open ? 'Close' : 'Open'}</span>
        </button>

        {/* Expanded content */}
        {open && (
          <div className="space-y-3 border-t border-slate-100 bg-white px-4 py-3">

            {/* Hook line */}
            {hookLine && (
              <div className="rounded-lg bg-gray-50 px-3 py-2.5">
                <p className="mb-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">Hook line</p>
                <p className="text-sm font-semibold text-gray-900 leading-snug">"{hookLine}"</p>
              </div>
            )}

            {/* ── NEW FORMAT: storyboard 2-step flow ─────────────────────── */}
            {hasNewFormat && (
              <>
                {/* Step 1: Storyboard prompt (editable) */}
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <div className="flex items-start justify-between gap-2 border-b border-slate-200 bg-[#f6f7f2] px-3 py-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.1em] leading-snug text-slate-600">
                      Storyboard prompt
                      <span className="ml-1 font-semibold normal-case tracking-normal text-slate-400">(editable)</span>
                    </p>
                    <CopyButton text={editStoryboard} label="Copy" />
                  </div>
                  <textarea
                    value={editStoryboard}
                    onChange={e => setEditStoryboard(e.target.value)}
                    rows={10}
                    className="w-full resize-y border-0 bg-white px-3 py-2.5 font-mono text-[10px] leading-relaxed text-slate-800 outline-none focus:ring-1 focus:ring-slate-300"
                    spellCheck={false}
                  />
                </div>

                {/* Step 2: video prompt (editable) */}
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <div className="flex items-start justify-between gap-2 border-b border-slate-200 bg-[#f6f7f2] px-3 py-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.1em] leading-snug text-slate-600">
                      Video Studio prompt
                      <span className="ml-1 font-semibold normal-case tracking-normal text-slate-400">(editable)</span>
                    </p>
                    <CopyButton text={editVideoPrompt} label="Copy" />
                  </div>
                  <textarea
                    value={editVideoPrompt}
                    onChange={e => setEditVideoPrompt(e.target.value)}
                    rows={8}
                    className="w-full resize-y border-0 bg-white px-3 py-2.5 font-mono text-[10px] leading-relaxed text-slate-800 outline-none focus:ring-1 focus:ring-slate-300"
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
                      <span className="text-[10px] font-bold text-gray-400 uppercase">Video prompt</span>
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

            {/* ── Step A: Generate storyboard button (idle only) ──────────── */}
            {hasNewFormat && makeStep === 'idle' && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 space-y-2.5">
                <p className="text-[10px] font-bold text-blue-700">第一步：生成 9 格故事板图片</p>
                <button
                  onClick={handleMakeStoryboard}
                  disabled={!editStoryboard}
                  className="w-full py-2 text-xs font-bold bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 disabled:opacity-50 text-white rounded-lg transition-all"
                >
                  🎨 生成故事板图片（Visual Studio · ~20s）
                </button>
              </div>
            )}

            {/* ── In-progress states ──────────────────────────────────────── */}
            {(makeStep === 'creating' || makeStep === 'storyboard_generating') && (
              <div className="rounded-lg border bg-gray-50 px-3 py-2.5 space-y-2">
                <div className="flex items-center gap-2 text-[10px] font-medium">
                  <StepDot active={makeStep === 'creating'}              done={makeStep === 'storyboard_generating'} label="草稿" />
                  <span className="text-gray-300">→</span>
                  <StepDot active={makeStep === 'storyboard_generating'} done={false}                                label="故事板" />
                  <span className="text-gray-300">→</span>
                  <StepDot active={false}                                done={false}                                label="视频" />
                </div>
                {makeStep === 'creating' && (
                  <p className="text-xs text-gray-500 flex items-center gap-1.5">
                    <Spinner color="indigo" /> 创建草稿…
                  </p>
                )}
                {makeStep === 'storyboard_generating' && (
                  <p className="text-xs text-indigo-700 flex items-center gap-1.5">
                    <Spinner color="indigo" /> 🎨 Visual Studio 生成9格故事板图片中…（约 15–25s）
                  </p>
                )}
              </div>
            )}

            {/* ── Step B: Storyboard ready — show image + video params ────── */}
            {makeStep === 'storyboard_ready' && storyboardUrl && (
              <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-3 space-y-3">
                {/* Storyboard thumbnail (clickable) */}
                <div>
                  <p className="text-[10px] font-bold text-green-700 mb-1.5">✅ 故事板图片已生成 — 点击可放大查看</p>
                  <button
                    onClick={() => setLightboxOpen(true)}
                    className="block group relative"
                    title="点击放大"
                  >
                    <img
                      src={storyboardUrl}
                      alt="9-panel storyboard"
                      className="w-full max-w-[200px] rounded border border-green-200 group-hover:opacity-90 transition-opacity"
                    />
                    <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className="bg-black/60 text-white text-[10px] font-bold rounded px-2 py-1">🔍 放大</span>
                    </span>
                  </button>
                </div>

                {/* Divider */}
                <div className="border-t border-green-200" />

                {/* Video params */}
                <div>
                  <p className="text-[10px] font-bold text-purple-700 mb-2">第二步：生成 Reel 视频</p>
                  {ParamBar}
                </div>

                <button
                  onClick={handleMakeVideo}
                  disabled={!editVideoPrompt}
                  className="w-full py-2 text-xs font-bold bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 text-white rounded-lg transition-all"
                >
                  🎬 生成 Reel 视频 &nbsp;·&nbsp; {duration}s · {resolution} · 9:16{generateAudio ? ' · 🎵' : ''}
                </button>
              </div>
            )}

            {/* ── Video polling ───────────────────────────────────────────── */}
            {makeStep === 'video' && (
              <div className="rounded-lg border bg-gray-50 px-3 py-2.5 space-y-2">
                <div className="flex items-center gap-2 text-[10px] font-medium">
                  <StepDot active={false} done={true}  label="草稿" />
                  <span className="text-gray-300">→</span>
                  <StepDot active={false} done={true}  label="故事板" />
                  <span className="text-gray-300">→</span>
                  <StepDot active={true}  done={false} label="视频" />
                </div>
                {storyboardUrl && (
                  <button
                    onClick={() => setLightboxOpen(true)}
                    className="block group relative"
                    title="点击放大"
                  >
                    <img
                      src={storyboardUrl}
                      alt="storyboard"
                      className="w-[80px] rounded border border-gray-200 group-hover:opacity-80 transition-opacity"
                    />
                    <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100">
                      <span className="bg-black/60 text-white text-[10px] rounded px-1">🔍</span>
                    </span>
                  </button>
                )}
                <p className="text-xs text-purple-600 flex items-center gap-1.5">
                  <Spinner color="purple" /> 🎬 Video Studio 生成 Reel 视频中…（约 2–3 分钟）
                </p>
              </div>
            )}

            {/* ── Error ───────────────────────────────────────────────────── */}
            {makeStep === 'error' && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 space-y-1.5">
                <p className="text-xs text-red-600 font-medium">⚠ {makeError}</p>
                <button
                  onClick={() => { setMakeStep('idle'); setMakeError(null) }}
                  className="text-[10px] text-gray-400 hover:text-gray-600 underline"
                >
                  重置重试
                </button>
              </div>
            )}

            {/* ── Done ────────────────────────────────────────────────────── */}
            {makeStep === 'done' && videoUrl && (
              <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-3 space-y-2">
                <p className="text-xs text-green-700 font-bold">✅ Reel 视频生成完成！</p>
                <div className="flex gap-3 items-start flex-wrap">
                  {storyboardUrl && (
                    <button
                      onClick={() => setLightboxOpen(true)}
                      className="shrink-0 group relative"
                      title="点击放大故事板"
                    >
                      <img
                        src={storyboardUrl}
                        alt="storyboard"
                        className="w-[72px] rounded border border-green-200 group-hover:opacity-80 transition-opacity"
                      />
                      <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100">
                        <span className="bg-black/60 text-white text-[9px] rounded px-1">🔍</span>
                      </span>
                    </button>
                  )}
                  <video
                    src={videoUrl}
                    controls
                    className="flex-1 min-w-0 max-w-[180px] rounded-lg border border-gray-200"
                  />
                </div>
                <div className="flex gap-3 flex-wrap">
                  <a href={storyboardUrl ?? '#'} download target="_blank" rel="noreferrer"
                     className="text-[11px] text-indigo-500 hover:underline">↓ 故事板</a>
                  <a href={videoUrl} download target="_blank" rel="noreferrer"
                     className="text-[11px] text-purple-600 hover:underline font-medium">↓ 下载视频</a>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}

const POST_TYPE_COLOR: Record<string, string> = {
  educational:  'bg-emerald-50 text-emerald-700 border-emerald-200',
  promotional:  'bg-amber-50 text-amber-700 border-amber-200',
  storytelling: 'bg-purple-50 text-purple-700 border-purple-200',
  engagement:   'bg-blue-50 text-blue-700 border-blue-200',
}

function PostCard({ post, clientId, launchHubPlatform, onGenStart, onGenEnd, onBackgroundImageGenerate, postId, initialAssets }: {
  post: Post
  clientId: string
  launchHubPlatform?: string
  onGenStart?: () => void
  onGenEnd?: () => void
  onBackgroundImageGenerate?: (params: ImageGenerateParams) => Promise<GalleryAsset>
  /** Persisted content_post id — when present, the gallery is loaded from / saved to visual_assets. */
  postId?: string
  /** Pre-fetched gallery assets (avoids a per-card fetch when the parent already loaded them). */
  initialAssets?: GalleryAsset[]
}) {
  const [open, setOpen]             = useState(false)
  const [generatingImg, setGen]     = useState(false)
  const [assets, setAssets]         = useState<GalleryAsset[]>(initialAssets ?? [])
  const [imgError, setImgError]     = useState<string | null>(null)
  const [lightboxUrl, setLightbox]  = useState<string | null>(null)
  const [editedCopy, setEditedCopy]           = useState(post.copy)
  const [editedImagePrompt, setEditedImagePrompt] = useState(post.image_prompt)
  const [selecting, setSelecting]   = useState(false)
  // 素材库选图 modal
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickingFromLibrary, setPickingFromLibrary] = useState(false)

  // Load gallery on mount when bound to a persisted post but parent didn't pre-fetch.
  useEffect(() => {
    if (!postId || initialAssets) return
    fetch(`/api/clients/${clientId}/visual-assets?post_id=${postId}`)
      .then(r => r.json() as Promise<{ success: boolean; assets?: GalleryAsset[] }>)
      .then(data => { if (data.success && data.assets) setAssets(data.assets) })
      .catch(() => { /* non-fatal */ })
  }, [clientId, postId, initialAssets])

  // 从素材库选定一张 → 入画廊
  const handlePickFromLibrary = async (clientAssetId: string) => {
    if (!postId || pickingFromLibrary) return
    setPickingFromLibrary(true)
    setImgError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/visual-assets/from-library`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_id: postId, client_asset_id: clientAssetId }),
      })
      const json = await res.json() as { success: boolean; asset?: GalleryAsset; error?: string }
      if (!json.success || !json.asset) throw new Error(json.error ?? '入库失败')
      setAssets(prev => [...prev, json.asset!])
      setPickerOpen(false)
    } catch (e) {
      setImgError(e instanceof Error ? e.message : String(e))
    } finally {
      setPickingFromLibrary(false)
    }
  }

  const selectedAsset = assets.find(a => a.is_selected) ?? assets[0] ?? null
  const selectedUrl   = selectedAsset?.storage_url ?? null
  const colorClass    = POST_TYPE_COLOR[post.content_type] ?? 'bg-gray-50 text-gray-700 border-gray-200'

  const handleGenerate = async () => {
    setGen(true)
    setImgError(null)
    onGenStart?.()
    try {
      if (onBackgroundImageGenerate) {
        const asset = await onBackgroundImageGenerate({
          prompt: editedImagePrompt,
          aspectRatio: '1:1',
          ...(postId ? { postId } : {}),
        })
        setAssets(prev => [...prev, asset])
      } else {
        // Fallback: legacy single-image preview (batch mode, no parent handler).
        const res = await fetch('/api/visual/image-preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: editedImagePrompt, client_id: clientId, aspect_ratio: '1:1' }),
        })
        const json = await res.json() as { success: boolean; image_url?: string; error?: string }
        if (!json.success) throw new Error(json.error ?? '生成失败')
        if (json.image_url) {
          setAssets(prev => [...prev, {
            id: `local-${prev.length + 1}`,
            storage_url: json.image_url!,
            prompt_used: editedImagePrompt,
            is_selected: prev.length === 0,
            created_at: new Date().toISOString(),
          }])
        }
      }
    } catch (e) {
      setImgError(e instanceof Error ? e.message : String(e))
    } finally {
      setGen(false)
      onGenEnd?.()
    }
  }

  const handleSelect = async (assetId: string) => {
    if (selecting) return
    // 乐观更新
    setAssets(prev => prev.map(a => ({ ...a, is_selected: a.id === assetId })))
    if (!postId || assetId.startsWith('local-')) return // 本地态/batch 不落库
    setSelecting(true)
    try {
      await fetch(`/api/visual-assets/${assetId}/select`, { method: 'PATCH' })
    } catch { /* 乐观更新已生效 */ } finally {
      setSelecting(false)
    }
  }

  return (
    <>
      <ImageLightbox url={lightboxUrl} onClose={() => setLightbox(null)} maxWidth="max-w-sm" />
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <button
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center gap-3 px-4 py-3 bg-gray-50 hover:bg-gray-100 text-left transition-colors"
        >
          {selectedUrl && (
            <img src={selectedUrl} alt="" className="w-8 h-8 rounded object-cover border border-gray-200 shrink-0" />
          )}
          <span className={`text-[10px] font-bold border rounded px-1.5 py-0.5 shrink-0 ${colorClass}`}>
            {post.content_type}
          </span>
          <p className="flex-1 text-xs text-gray-700 truncate">{(post.copy ?? '').slice(0, 80)}…</p>
          {assets.length > 0 && (
            <span className="text-[10px] font-bold text-purple-600 shrink-0">{assets.length} 张图</span>
          )}
          <span className="text-gray-400 text-xs">{open ? '▲' : '▼'}</span>
        </button>
        {open && (
          <div className="px-4 py-3 space-y-2.5 border-t border-gray-100 bg-white">
            {/* 可编辑文案 */}
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">文案</label>
              <textarea
                value={editedCopy}
                onChange={e => setEditedCopy(e.target.value)}
                rows={4}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[11px] text-gray-800 leading-relaxed focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400"
              />
            </div>

            {/* 可编辑 Image prompt — 始终可见，便于改提示词再生成 */}
            <div className="rounded-lg border border-violet-100 overflow-hidden">
              <div className="flex items-start justify-between gap-2 px-3 py-2 bg-violet-50 border-b border-violet-100">
                <p className="text-[10px] font-bold text-violet-800">🎨 Image Prompt</p>
                <CopyButton text={editedImagePrompt} label="📋 复制" />
              </div>
              <textarea
                value={editedImagePrompt}
                onChange={e => setEditedImagePrompt(e.target.value)}
                rows={3}
                className="w-full px-3 py-2.5 text-[10px] text-violet-900 italic leading-relaxed font-mono bg-white focus:outline-none focus:ring-1 focus:ring-violet-300 border-0 resize-none"
              />
            </div>

            {/* 画廊：已生成的所有图片 */}
            {assets.length > 0 && (
              <ImageGalleryGrid
                assets={assets}
                aspectRatio="1:1"
                onSelect={handleSelect}
                onOpenLightbox={url => setLightbox(url)}
                selecting={selecting}
              />
            )}

            {/* 生成按钮 — 常驻，每次点击追加一张 */}
            <div className="space-y-1.5">
              <div className="flex gap-1.5">
                <button
                  onClick={() => void handleGenerate()}
                  disabled={generatingImg}
                  className="flex-1 py-2 text-xs font-bold bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 disabled:opacity-50 text-white rounded-lg transition-all"
                >
                  {generatingImg ? (
                    <span className="flex items-center justify-center gap-2">
                      <Spinner color="indigo" /> Visual Studio 生成中…（约 15s）
                    </span>
                  ) : assets.length === 0
                    ? '🎨 生成图片（Visual Studio）'
                    : `🎨 再生成一张（已有 ${assets.length} 张）`
                  }
                </button>
                {postId && (
                  <button
                    onClick={() => setPickerOpen(true)}
                    title="从客户素材库选一张真实照片"
                    className="shrink-0 px-3 py-2 text-xs font-bold border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg transition-colors"
                  >
                    📚 从素材库选
                  </button>
                )}
              </div>
              {imgError && <p className="text-[11px] text-red-500">⚠ {imgError}</p>}
            </div>

            {/* 素材库选图 Modal */}
            {pickerOpen && postId && (
              <AssetLibraryPicker
                clientId={clientId}
                imagePrompt={editedImagePrompt}
                onClose={() => setPickerOpen(false)}
                onPick={handlePickFromLibrary}
                picking={pickingFromLibrary}
              />
            )}

            <div className="flex flex-wrap gap-1">
              {post.hashtags.map((h, hi) => (
                <span key={hi} className="text-[10px] bg-blue-50 text-blue-600 rounded px-1.5 py-0.5">{h}</span>
              ))}
            </div>

            {launchHubPlatform && (
              <LaunchHubScheduler
                clientId={clientId}
                platform={launchHubPlatform}
                caption={editedCopy}
                hashtags={post.hashtags}
                imageUrl={selectedUrl}
              />
            )}
          </div>
        )}
      </div>
    </>
  )
}

function StoryCard({ index, story, clientId, launchHubPlatform, onGenStart, onGenEnd, onBackgroundImageGenerate, postId, initialAssets }: {
  index: number
  story: Story
  clientId: string
  launchHubPlatform?: string
  onGenStart?: () => void
  onGenEnd?: () => void
  onBackgroundImageGenerate?: (params: ImageGenerateParams) => Promise<GalleryAsset>
  postId?: string
  initialAssets?: GalleryAsset[]
}) {
  const [generatingImg, setGen]               = useState(false)
  const [assets, setAssets]                   = useState<GalleryAsset[]>(initialAssets ?? [])
  const [imgError, setImgError]               = useState<string | null>(null)
  const [lightboxUrl, setLightbox]            = useState<string | null>(null)
  const [editedCopy, setEditedCopy]           = useState(story.copy)
  const [editedVisualPrompt, setEditedVisualPrompt] = useState(story.visual_prompt)
  const [selecting, setSelecting]             = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickingFromLibrary, setPickingFromLibrary] = useState(false)

  useEffect(() => {
    if (!postId || initialAssets) return
    fetch(`/api/clients/${clientId}/visual-assets?post_id=${postId}`)
      .then(r => r.json() as Promise<{ success: boolean; assets?: GalleryAsset[] }>)
      .then(data => { if (data.success && data.assets) setAssets(data.assets) })
      .catch(() => { /* non-fatal */ })
  }, [clientId, postId, initialAssets])

  const handlePickFromLibrary = async (clientAssetId: string) => {
    if (!postId || pickingFromLibrary) return
    setPickingFromLibrary(true)
    setImgError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/visual-assets/from-library`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_id: postId, client_asset_id: clientAssetId }),
      })
      const json = await res.json() as { success: boolean; asset?: GalleryAsset; error?: string }
      if (!json.success || !json.asset) throw new Error(json.error ?? '入库失败')
      setAssets(prev => [...prev, json.asset!])
      setPickerOpen(false)
    } catch (e) {
      setImgError(e instanceof Error ? e.message : String(e))
    } finally {
      setPickingFromLibrary(false)
    }
  }

  const selectedAsset = assets.find(a => a.is_selected) ?? assets[0] ?? null
  const selectedUrl   = selectedAsset?.storage_url ?? null

  const handleGenerate = async () => {
    setGen(true)
    setImgError(null)
    onGenStart?.()
    try {
      if (onBackgroundImageGenerate) {
        const asset = await onBackgroundImageGenerate({
          prompt: editedVisualPrompt,
          aspectRatio: '9:16',
          ...(postId ? { postId } : {}),
        })
        setAssets(prev => [...prev, asset])
      } else {
        const res = await fetch('/api/visual/image-preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: editedVisualPrompt, client_id: clientId, aspect_ratio: '9:16' }),
        })
        const json = await res.json() as { success: boolean; image_url?: string; error?: string }
        if (!json.success) throw new Error(json.error ?? '生成失败')
        if (json.image_url) {
          setAssets(prev => [...prev, {
            id: `local-${prev.length + 1}`,
            storage_url: json.image_url!,
            prompt_used: editedVisualPrompt,
            is_selected: prev.length === 0,
            created_at: new Date().toISOString(),
          }])
        }
      }
    } catch (e) {
      setImgError(e instanceof Error ? e.message : String(e))
    } finally {
      setGen(false)
      onGenEnd?.()
    }
  }

  const handleSelect = async (assetId: string) => {
    if (selecting) return
    setAssets(prev => prev.map(a => ({ ...a, is_selected: a.id === assetId })))
    if (!postId || assetId.startsWith('local-')) return
    setSelecting(true)
    try {
      await fetch(`/api/visual-assets/${assetId}/select`, { method: 'PATCH' })
    } catch { /* 乐观更新已生效 */ } finally {
      setSelecting(false)
    }
  }

  return (
    <>
      <ImageLightbox url={lightboxUrl} onClose={() => setLightbox(null)} maxWidth="max-w-xs" />
      <div className="border border-gray-200 rounded-lg px-4 py-3 bg-white flex gap-3">
        <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-700 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
          {index + 1}
        </span>
        <div className="flex-1 min-w-0 space-y-2">
          {/* 可编辑文案 */}
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">文案</label>
            <textarea
              value={editedCopy}
              onChange={e => setEditedCopy(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[11px] text-gray-800 leading-relaxed focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-400"
            />
          </div>
          <p className="text-[11px] text-indigo-600 font-medium">→ {story.cta}</p>

          {/* 可编辑 visual prompt — 始终可见 */}
          <div>
            <label className="text-[10px] font-bold text-purple-600 uppercase tracking-wide">🎨 Visual Prompt</label>
            <textarea
              value={editedVisualPrompt}
              onChange={e => setEditedVisualPrompt(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-purple-100 bg-purple-50 px-3 py-2 text-[10px] text-purple-900 italic font-mono leading-relaxed focus:border-purple-300 focus:outline-none focus:ring-1 focus:ring-purple-300"
            />
          </div>

          {/* 画廊 */}
          {assets.length > 0 && (
            <ImageGalleryGrid
              assets={assets}
              aspectRatio="9:16"
              onSelect={handleSelect}
              onOpenLightbox={url => setLightbox(url)}
              selecting={selecting}
            />
          )}

          {/* 生成按钮 — 常驻 */}
          <div className="space-y-1">
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => void handleGenerate()}
                disabled={generatingImg}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-purple-100 text-purple-700 hover:bg-purple-200 disabled:opacity-50 transition-colors"
              >
                {generatingImg
                  ? <><Spinner color="purple" /> 生成中…</>
                  : assets.length === 0 ? '🎨 生成 Story 图片' : `🎨 再生成一张（已有 ${assets.length} 张）`
                }
              </button>
              {postId && (
                <button
                  onClick={() => setPickerOpen(true)}
                  title="从客户素材库选一张真实照片"
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
                >
                  📚 从素材库选
                </button>
              )}
            </div>
            {imgError && <p className="text-[11px] text-red-500">⚠ {imgError}</p>}
          </div>

          {/* 素材库选图 Modal */}
          {pickerOpen && postId && (
            <AssetLibraryPicker
              clientId={clientId}
              imagePrompt={editedVisualPrompt}
              onClose={() => setPickerOpen(false)}
              onPick={handlePickFromLibrary}
              picking={pickingFromLibrary}
            />
          )}

          {launchHubPlatform && (
            <div className="pt-1">
              <LaunchHubScheduler
                clientId={clientId}
                platform={launchHubPlatform}
                caption={editedCopy}
                hashtags={[]}
                imageUrl={selectedUrl}
              />
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ─── LaunchHubScheduler ────────────────────────────────────────────────────────
// 车间交付按钮：把内容作为 draft 写入 content_posts，交给 Launch Hub 审核发布。
// 不在车间排期——排期是市场（Launch Hub）的职责。
//
// States: idle → sending → sent

function LaunchHubScheduler({
  clientId, platform, caption, hashtags, imageUrl,
}: {
  clientId: string
  platform: string
  caption: string
  hashtags: string[]
  imageUrl: string | null
}) {
  const [sent, setSent]         = useState(false)
  const [sending, setSending]   = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const handleDeliver = async () => {
    setSending(true)
    setErrorMsg(null)
    try {
      const res = await fetch('/api/publer/quick-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          caption,
          hashtags,
          image_url: imageUrl ?? undefined,
          platform,
          draft_only: true,
        }),
      })
      const json = await res.json() as { success: boolean; error?: string }
      if (!json.success) throw new Error(json.error ?? '交付失败')
      setSent(true)
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  const platformLabel = platform.charAt(0).toUpperCase() + platform.slice(1)

  if (sent) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 space-y-1">
        <p className="text-xs font-black text-green-700">✅ 已交付 Launch Hub（草稿待审核）</p>
        <p className="text-[10px] text-green-600">前往 Launch Hub 审核后安排发布到 {platformLabel}</p>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      {!imageUrl && (
        <p className="text-[10px] font-medium text-amber-600">⚠ 建议先生成配图再交付</p>
      )}
      {errorMsg && (
        <p className="text-[11px] text-red-500">⚠ {errorMsg}</p>
      )}
      <button
        onClick={() => void handleDeliver()}
        disabled={sending}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5 text-xs font-black text-slate-700 hover:bg-white hover:border-slate-400 transition-colors disabled:opacity-50"
      >
        {sending
          ? <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-400 border-t-slate-800" />交付中…</>
          : <>🚀 交付到 Launch Hub<span className="ml-auto text-[10px] font-semibold text-slate-400">{platformLabel} · 草稿</span></>
        }
      </button>
    </div>
  )
}

// ─── Utility micro-components ──────────────────────────────────────────────────

interface AssetRecommendation {
  id: string
  storage_url: string
  original_filename: string | null
  reason: string
  quality_score: number
}

function AssetLibraryPicker({ clientId, imagePrompt, onClose, onPick, picking }: {
  clientId: string
  imagePrompt: string
  onClose: () => void
  onPick: (clientAssetId: string) => void
  picking: boolean
}) {
  const [loading, setLoading]             = useState(true)
  const [recommendations, setRecs]        = useState<AssetRecommendation[]>([])
  const [error, setError]                 = useState<string | null>(null)
  const [zoomUrl, setZoomUrl]             = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/clients/${clientId}/asset-library/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_prompt: imagePrompt, limit: 12 }),
    })
      .then(r => r.json() as Promise<{ success: boolean; recommendations?: AssetRecommendation[]; error?: string }>)
      .then(data => {
        if (cancelled) return
        if (!data.success) {
          setError(data.error ?? '加载失败')
          setRecs([])
        } else {
          setRecs(data.recommendations ?? [])
        }
      })
      .catch(e => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [clientId, imagePrompt])

  return (
    <>
      <ImageLightbox url={zoomUrl} onClose={() => setZoomUrl(null)} maxWidth="max-w-2xl" />
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        onClick={onClose}
      >
        <div
          className="relative w-full max-w-3xl max-h-[85vh] flex flex-col bg-white rounded-xl shadow-2xl overflow-hidden"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3 px-5 py-3 border-b border-gray-200 bg-emerald-50">
            <div className="min-w-0">
              <h3 className="text-sm font-black text-emerald-900">📚 从客户素材库选图</h3>
              <p className="text-[11px] text-emerald-700 mt-0.5 truncate">
                AI 根据 image prompt 推荐：「{imagePrompt.slice(0, 80)}…」
              </p>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 text-gray-400 hover:text-gray-700 text-xl font-bold"
              aria-label="关闭"
            >✕</button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-12 text-xs text-gray-500">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-400 border-t-emerald-800" />
                Content Engine 正在匹配素材…
              </div>
            )}
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">
                ⚠ {error}
              </div>
            )}
            {!loading && !error && recommendations.length === 0 && (
              <div className="text-center py-12 text-xs text-gray-500">
                <p className="font-semibold mb-1">素材库为空</p>
                <p className="text-[11px]">该客户尚未上传或分析素材。</p>
              </div>
            )}
            {!loading && recommendations.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {recommendations.map(rec => (
                  <div
                    key={rec.id}
                    className="border border-gray-200 rounded-lg overflow-hidden bg-white hover:border-emerald-400 transition-colors"
                  >
                    <div className="relative aspect-square bg-gray-100">
                      <img src={rec.storage_url} alt={rec.original_filename ?? ''} className="w-full h-full object-cover" />
                      <button
                        onClick={() => setZoomUrl(rec.storage_url)}
                        className="absolute top-1 right-1 bg-black/60 text-white text-[9px] font-bold rounded px-1.5 py-0.5 hover:bg-black/80"
                      >🔍</button>
                    </div>
                    <div className="px-2 py-2 space-y-1">
                      <p className="text-[10px] text-gray-700 line-clamp-2 leading-tight">{rec.reason}</p>
                      {rec.original_filename && (
                        <p className="text-[9px] text-gray-400 truncate">{rec.original_filename}</p>
                      )}
                      <button
                        onClick={() => onPick(rec.id)}
                        disabled={picking}
                        className="w-full mt-1 py-1.5 text-[11px] font-bold rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                      >
                        {picking ? '加入中…' : '✓ 选这张'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-2.5 border-t border-gray-200 bg-gray-50">
            <p className="text-[10px] text-gray-500">
              💡 来自客户素材库的真实照片 — 比 AI 生图更可信，特别适合旅游、产品等需要真实场景的内容
            </p>
          </div>
        </div>
      </div>
    </>
  )
}

function ImageLightbox({ url, onClose, maxWidth }: {
  url: string | null
  onClose: () => void
  maxWidth: string
}) {
  if (!url) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div className={`relative ${maxWidth} w-full`} onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute -top-8 right-0 text-white text-sm font-bold hover:text-gray-300">✕ 关闭</button>
        <img src={url} alt="preview" className="w-full rounded-lg shadow-2xl" />
        <a href={url} download target="_blank" rel="noreferrer" className="mt-2 block text-center text-[11px] text-indigo-300 hover:text-white" onClick={e => e.stopPropagation()}>↓ 下载图片</a>
      </div>
    </div>
  )
}

function ImageGalleryGrid({ assets, aspectRatio, onSelect, onOpenLightbox, selecting }: {
  assets: GalleryAsset[]
  aspectRatio: '1:1' | '9:16'
  onSelect: (assetId: string) => void
  onOpenLightbox: (url: string) => void
  selecting: boolean
}) {
  const sizeClass = aspectRatio === '9:16' ? 'h-32' : 'h-24'
  const ratioStyle = aspectRatio === '9:16' ? { aspectRatio: '9/16' } : { aspectRatio: '1/1' }
  return (
    <div className="rounded-lg border border-purple-100 bg-purple-50/40 p-2.5">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-bold text-purple-700 uppercase tracking-wide">已生成 — 点击图片选定主图</p>
        <span className="text-[10px] text-purple-500">{assets.length} 张</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {assets.map(asset => (
          <div key={asset.id} className="relative">
            <button
              onClick={() => onSelect(asset.id)}
              disabled={selecting}
              className={`block rounded border-2 transition-all overflow-hidden ${
                asset.is_selected
                  ? 'border-green-500 ring-2 ring-green-200'
                  : 'border-gray-200 hover:border-purple-400'
              } disabled:opacity-60`}
              style={ratioStyle}
            >
              <img src={asset.storage_url} alt="" className={`${sizeClass} object-cover`} style={ratioStyle} />
            </button>
            {asset.is_selected && (
              <span className="absolute -top-1.5 -right-1.5 bg-green-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center shadow">✓</span>
            )}
            <button
              onClick={() => onOpenLightbox(asset.storage_url)}
              className="absolute bottom-0.5 right-0.5 bg-black/60 text-white text-[9px] font-bold rounded px-1.5 py-0.5 hover:bg-black/80"
            >🔍</button>
          </div>
        ))}
      </div>
    </div>
  )
}

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
