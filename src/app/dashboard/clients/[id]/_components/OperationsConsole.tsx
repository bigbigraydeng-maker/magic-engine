'use client'

import { type ReactNode, useState, useEffect, useCallback } from 'react'
import type { MasterBrief } from '@/types/magic-engine'

interface OperationsConsoleProps {
  clientId: string
}

type RouteId = 'route_a' | 'route_b' | 'route_c'
type Platform = 'facebook' | 'tiktok' | 'instagram'

interface PostResult {
  id?: string
  title: string
  script: string
  caption: string
  hashtags: string[]
  visual_brief: string
}

interface RecentPost {
  id: string
  title: string
  route: string
  status: string
  platforms: string[]
  created_at: string
}

// ─── Brand Diagnosis ──────────────────────────────────────────────────────────

const PILLAR_COLORS = [
  'bg-me-ochre/15 text-me-ochre',
  'bg-purple-100 text-purple-700',
  'bg-[#5C8A4A]/12 text-[#5C8A4A]',
  'bg-me-ochre/15 text-me-ochre',
  'bg-[#C2453A]/12 text-[#C2453A]',
]

function BrandDiagnosis({ brief }: { brief: MasterBrief }) {
  const [open, setOpen] = useState(true)

  const pillars = brief.content_pillars ?? []
  const audience = brief.target_audience
  const platforms = brief.platform_strategy
  const keywords = brief.keyword_seeds ?? []
  const voice = brief.brand_voice

  const activePlatforms = platforms
    ? Object.entries(platforms).filter(([, cfg]) => cfg.enabled)
    : []

  return (
    <div className="bg-white rounded-xl border border-black/10 overflow-hidden">
      {/* Header — always visible */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-me-ivory transition-colors"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-me-charcoal/90">
              {brief.brand_name ?? 'Unnamed Brand'}
            </span>
            <span className="text-xs bg-[#5C8A4A]/12 text-[#5C8A4A] px-2 py-0.5 rounded-full font-medium">
              Active Brief
            </span>
          </div>
          {brief.core_proposition && (
            <p className="text-xs text-me-charcoal/55 mt-0.5 truncate pr-8">
              {brief.core_proposition}
            </p>
          )}
        </div>
        <span className="text-me-charcoal/45 text-xs flex-shrink-0 ml-3">
          {open ? '收起 ▲' : '展开 ▼'}
        </span>
      </button>

      {/* Expanded diagnosis */}
      {open && (
        <div className="border-t border-black/[.06] px-5 py-4 grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Content Pillars */}
          {pillars.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide mb-2">
                内容支柱
              </p>
              <div className="flex flex-wrap gap-2">
                {pillars.map((p, i) => (
                  <span
                    key={p.id}
                    className={`text-xs px-2.5 py-1 rounded-full font-medium ${PILLAR_COLORS[i % PILLAR_COLORS.length]}`}
                  >
                    {p.name} {Math.round(p.post_ratio * 100)}%
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Target Audience */}
          {audience && (
            <div>
              <p className="text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide mb-2">
                目标受众
              </p>
              <div className="space-y-1 text-xs text-me-charcoal/75">
                {audience.age_range && (
                  <p>年龄：{audience.age_range}{audience.location ? ` · ${audience.location}` : ''}</p>
                )}
                {audience.interests?.slice(0, 3).map((i, idx) => (
                  <p key={idx} className="text-me-charcoal/55">· {i}</p>
                ))}
              </div>
            </div>
          )}

          {/* Active Platforms */}
          {activePlatforms.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide mb-2">
                发布平台
              </p>
              <div className="flex flex-wrap gap-2">
                {activePlatforms.map(([platform, cfg]) => (
                  <span
                    key={platform}
                    className="text-xs bg-me-ivory text-me-charcoal/75 px-2.5 py-1 rounded-full"
                  >
                    {platform} · {cfg.post_frequency}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Brand Voice */}
          {voice && (
            <div>
              <p className="text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide mb-2">
                品牌语气
              </p>
              <div className="flex flex-wrap gap-1.5">
                {voice.tone_keywords?.map(kw => (
                  <span
                    key={kw}
                    className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded"
                  >
                    {kw}
                  </span>
                ))}
                <span className="text-xs text-me-charcoal/45 px-2 py-0.5">
                  {voice.formality} · emoji {voice.emoji_usage}
                </span>
              </div>
            </div>
          )}

          {/* Keywords */}
          {keywords.length > 0 && (
            <div className="md:col-span-2">
              <p className="text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide mb-2">
                核心关键词
              </p>
              <div className="flex flex-wrap gap-1.5">
                {keywords.slice(0, 10).map(kw => (
                  <span
                    key={kw}
                    className="text-xs bg-me-ivory text-me-charcoal/60 px-2 py-0.5 rounded font-mono"
                  >
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Route Selector ───────────────────────────────────────────────────────────

const ROUTES: { id: RouteId; icon: string; label: string; desc: string; color: string; activeClass: string }[] = [
  {
    id: 'route_a',
    icon: '🔑',
    label: 'Keyword',
    desc: 'SEO 关键词 → 2 个帖子变体',
    color: 'text-me-ochre',
    activeClass: 'bg-me-ochre text-white border-me-ochre',
  },
  {
    id: 'route_b',
    icon: '📹',
    label: 'Video Remix',
    desc: '爆款视频 → 转录 → 品牌改写',
    color: 'text-purple-600',
    activeClass: 'bg-purple-600 text-white border-purple-600',
  },
  {
    id: 'route_c',
    icon: '💡',
    label: 'Free Topic',
    desc: '自定义话题 → 2 个帖子变体',
    color: 'text-[#5C8A4A]',
    activeClass: 'bg-[#5C8A4A] text-white border-[#5C8A4A]',
  },
]

const PLATFORMS: { id: Platform; label: string }[] = [
  { id: 'facebook', label: 'Facebook' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'instagram', label: 'Instagram' },
]

const ROUTE_COLORS: Record<string, string> = {
  route_a: 'bg-me-ochre/15 text-me-ochre',
  route_b: 'bg-purple-100 text-purple-700',
  route_c: 'bg-[#5C8A4A]/12 text-[#5C8A4A]',
}

const ROUTE_LABELS: Record<string, string> = {
  route_a: 'Route A',
  route_b: 'Route B',
  route_c: 'Route C',
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-me-ochre/15 text-me-ochre',
  approved: 'bg-[#5C8A4A]/12 text-[#5C8A4A]',
  scheduled: 'bg-blue-100 text-blue-700',
  published: 'bg-me-ivory text-me-charcoal/60',
  rejected: 'bg-[#C2453A]/12 text-[#C2453A]',
}

// ─── Result Card ──────────────────────────────────────────────────────────────

function ResultCard({ post, index }: { post: PostResult; index: number }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="border border-black/10 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-start justify-between px-4 py-3 bg-me-ivory hover:bg-me-ivory transition-colors text-left gap-3"
      >
        <div className="min-w-0">
          <span className="text-xs font-semibold text-me-charcoal/55">V{index + 1}</span>
          <p className="text-sm font-medium text-me-charcoal/90 truncate mt-0.5">{post.title}</p>
        </div>
        <span className="text-me-charcoal/45 text-xs flex-shrink-0 mt-1">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-4 py-4 space-y-3 text-xs">
          <div>
            <p className="font-semibold text-me-charcoal/55 uppercase tracking-wide mb-1">脚本</p>
            <p className="text-me-charcoal/75 whitespace-pre-wrap leading-relaxed">{post.script}</p>
          </div>
          <div>
            <p className="font-semibold text-me-charcoal/55 uppercase tracking-wide mb-1">Caption</p>
            <p className="text-me-charcoal/75 leading-relaxed">{post.caption}</p>
          </div>
          <div>
            <p className="font-semibold text-me-charcoal/55 uppercase tracking-wide mb-1">Hashtags</p>
            <p className="text-me-ochre">{post.hashtags?.join(' ')}</p>
          </div>
          <div>
            <p className="font-semibold text-me-charcoal/55 uppercase tracking-wide mb-1">视觉描述</p>
            <p className="text-me-charcoal/60 italic">{post.visual_brief}</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Platform Selector ────────────────────────────────────────────────────────

function PlatformSelector({
  value,
  onChange,
}: {
  value: Platform[]
  onChange: (v: Platform[]) => void
}) {
  return (
    <div className="flex gap-4 flex-wrap">
      {PLATFORMS.map(p => (
        <label key={p.id} className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={value.includes(p.id)}
            onChange={e =>
              onChange(e.target.checked ? [...value, p.id] : value.filter(v => v !== p.id))
            }
            className="w-3.5 h-3.5 rounded border-black/15"
          />
          <span className="text-sm text-me-charcoal/75">{p.label}</span>
        </label>
      ))}
    </div>
  )
}

// ─── Generate Button ──────────────────────────────────────────────────────────

function GenerateButton({
  loading,
  disabled,
  activeClass,
  children,
  onClick,
}: {
  loading: boolean
  disabled: boolean
  activeClass: string
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      className={`w-full ${activeClass} disabled:opacity-40 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2`}
    >
      {loading ? (
        <>
          <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          生成中…
        </>
      ) : children}
    </button>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function OperationsConsole({ clientId }: OperationsConsoleProps) {
  const [brief, setBrief] = useState<MasterBrief | null>(null)
  const [briefLoading, setBriefLoading] = useState(true)

  const [activeRoute, setActiveRoute] = useState<RouteId>('route_a')
  const [input, setInput] = useState('')
  const [platforms, setPlatforms] = useState<Platform[]>(['facebook', 'tiktok'])
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<PostResult[] | null>(null)
  const [error, setError] = useState('')

  const [recentPosts, setRecentPosts] = useState<RecentPost[]>([])
  const [postsLoading, setPostsLoading] = useState(true)

  const fetchBrief = useCallback(async () => {
    setBriefLoading(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/brief`)
      if (res.ok) {
        const data = await res.json()
        setBrief(data.brief ?? null)
      }
    } finally {
      setBriefLoading(false)
    }
  }, [clientId])

  const fetchPosts = useCallback(async () => {
    setPostsLoading(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/posts`)
      if (res.ok) {
        const data = await res.json()
        setRecentPosts((data.posts ?? []).slice(0, 12))
      }
    } finally {
      setPostsLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    fetchBrief()
    fetchPosts()
  }, [fetchBrief, fetchPosts])

  // Reset form when switching routes
  useEffect(() => {
    setInput('')
    setResults(null)
    setError('')
  }, [activeRoute])

  const handleGenerate = async () => {
    if (!input.trim() || !brief) return
    setLoading(true)
    setError('')
    setResults(null)

    const endpoint =
      activeRoute === 'route_a' ? '/api/content/route-a'
      : activeRoute === 'route_b' ? '/api/content/route-b'
      : '/api/content/route-c'

    const bodyKey =
      activeRoute === 'route_a' ? 'keyword'
      : activeRoute === 'route_b' ? 'video_url'
      : 'topic'

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, [bodyKey]: input.trim(), platforms }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error ?? 'Generation failed')
      setResults(data.variants ?? [])
      void fetchPosts()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const activeRouteConfig = ROUTES.find(r => r.id === activeRoute)!

  const inputLabel =
    activeRoute === 'route_a' ? 'SEO 关键词'
    : activeRoute === 'route_b' ? '视频 URL'
    : '话题 / 创意'

  const inputPlaceholder =
    activeRoute === 'route_a' ? '例如：月子餐推荐'
    : activeRoute === 'route_b' ? 'TikTok / YouTube / Instagram URL'
    : '例如：新年开工大吉'

  return (
    <div className="space-y-5">

      {/* ── 1. Brief status / diagnosis ── */}
      {briefLoading ? (
        <div className="bg-me-ivory border border-black/10 rounded-xl px-5 py-4 animate-pulse">
          <div className="h-4 bg-me-stone rounded w-48" />
          <div className="h-3 bg-me-stone rounded w-80 mt-2" />
        </div>
      ) : brief ? (
        <BrandDiagnosis brief={brief} />
      ) : (
        <div className="bg-me-ochre/10 border border-me-ochre/30 rounded-xl px-5 py-4 flex items-start gap-3">
          <span className="text-xl">⚠️</span>
          <p className="text-sm text-me-ochre">
            未找到 Active Master Brief。请先切换到{' '}
            <span className="font-semibold">✨ Master Brief</span> 标签生成品牌档案。
          </p>
        </div>
      )}

      {/* ── 2. Content Generation ── */}
      <div className="bg-white rounded-xl border border-black/10 overflow-hidden">
        {/* Route pill selector */}
        <div className="px-5 py-4 border-b border-black/[.06]">
          <div className="flex gap-2 flex-wrap">
            {ROUTES.map(route => (
              <button
                key={route.id}
                onClick={() => setActiveRoute(route.id)}
                disabled={!brief}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium border transition-all disabled:opacity-40 ${
                  activeRoute === route.id
                    ? route.activeClass
                    : 'border-black/10 text-me-charcoal/60 hover:border-black/15 hover:text-me-charcoal/75 bg-white'
                }`}
              >
                <span>{route.icon}</span>
                {route.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-me-charcoal/45 mt-2">{activeRouteConfig.desc}</p>
        </div>

        {/* Input form */}
        <div className="px-5 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-me-charcoal/75 mb-1.5">
              {inputLabel}
            </label>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleGenerate()}
              placeholder={inputPlaceholder}
              disabled={loading || !brief}
              className="w-full border border-black/10 rounded-xl px-4 py-2.5 text-sm text-me-charcoal/90 bg-white placeholder-me-charcoal/45 focus:outline-none focus:ring-2 focus:ring-me-ochre disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-me-charcoal/75 mb-1.5">发布平台</label>
            <PlatformSelector value={platforms} onChange={setPlatforms} />
          </div>

          <GenerateButton
            loading={loading}
            disabled={!input.trim() || !brief}
            activeClass={activeRouteConfig.activeClass}
            onClick={handleGenerate}
          >
            生成 2 个变体
          </GenerateButton>

          {error && (
            <div className="bg-[#C2453A]/10 border border-[#C2453A]/20 rounded-xl px-4 py-3">
              <p className="text-sm text-[#C2453A] font-medium">生成失败</p>
              <p className="text-xs text-[#C2453A] mt-0.5">{error}</p>
            </div>
          )}
        </div>

        {/* Results */}
        {results && results.length > 0 && (
          <div className="border-t border-black/[.06] px-5 py-5">
            <p className="text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide mb-3">
              生成结果（{results.length} 个变体）
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {results.map((post, i) => (
                <ResultCard key={i} post={post} index={i} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── 3. Recent Posts ── */}
      <div className="bg-white rounded-xl border border-black/10 overflow-hidden">
        <div className="px-5 py-4 border-b border-black/[.06] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-me-charcoal/90">最近生成的帖子</h2>
          <a href={`/dashboard/content?client=${clientId}`} className="text-xs text-me-ochre hover:underline">
            查看全部 →
          </a>
        </div>
        {postsLoading ? (
          <div className="py-8 text-center text-me-charcoal/45 text-sm animate-pulse">加载中…</div>
        ) : recentPosts.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-me-charcoal/45 text-sm">还没有生成过帖子</p>
            <p className="text-me-charcoal/45 text-xs mt-1">使用上方生成入口开始创作</p>
          </div>
        ) : (
          <div className="divide-y divide-black/[.04]">
            {recentPosts.map(post => (
              <div key={post.id} className="flex items-center justify-between px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-me-charcoal/90 truncate">{post.title}</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                        ROUTE_COLORS[post.route] ?? 'bg-me-ivory text-me-charcoal/60'
                      }`}
                    >
                      {ROUTE_LABELS[post.route] ?? post.route}
                    </span>
                    <span className="text-xs text-me-charcoal/45">{post.platforms?.join(', ')}</span>
                    <span className="text-xs text-me-charcoal/35">·</span>
                    <span className="text-xs text-me-charcoal/45">
                      {new Date(post.created_at).toLocaleDateString('zh-CN')}
                    </span>
                  </div>
                </div>
                <span
                  className={`ml-3 flex-shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                    STATUS_COLORS[post.status] ?? 'bg-me-ivory text-me-charcoal/60'
                  }`}
                >
                  {post.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
