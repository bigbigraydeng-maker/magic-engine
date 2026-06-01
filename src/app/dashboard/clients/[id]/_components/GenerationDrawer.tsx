'use client'

import { useState, useEffect, useCallback } from 'react'
import type { CampaignBrief } from '@/types/magic-engine'

interface Props {
  clientId: string
  open: boolean
  onClose: () => void
  /** 内容飞轮闭环：从执行看板跳转过来时，生成的 content_post 自动关联到这个执行项 */
  executionItemId?: string | null
}

type RouteId = 'route_a' | 'route_b' | 'route_c'
type ContentMode = 'brand' | 'campaign'

const ROUTES: { id: RouteId; label: string; icon: string; inputLabel: string; inputPlaceholder: string }[] = [
  { id: 'route_a', label: '关键词', icon: '🔑', inputLabel: '目标关键词', inputPlaceholder: '例：新西兰团队游' },
  { id: 'route_b', label: '视频混剪', icon: '📹', inputLabel: '视频链接', inputPlaceholder: 'https://tiktok.com/…' },
  { id: 'route_c', label: '自由话题', icon: '💡', inputLabel: '内容话题', inputPlaceholder: '例：为什么选择新西兰旅游' },
]

const PLATFORMS = ['facebook', 'tiktok', 'instagram']

const CAMPAIGN_BORDER_COLORS = [
  'border-l-[#3E6E8C]', 'border-l-[#5C8A4A]', 'border-l-me-ochre',
  'border-l-me-gold', 'border-l-[#C2453A]',
]

export function GenerationDrawer({ clientId, open, onClose, executionItemId }: Props) {
  const [route, setRoute] = useState<RouteId>('route_a')
  const [mode, setMode] = useState<ContentMode>('brand')
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [platforms, setPlatforms] = useState<string[]>(['facebook', 'tiktok'])
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [savedCount, setSavedCount] = useState<number | null>(null)

  const [hasBrief, setHasBrief] = useState<boolean | null>(null)
  const [campaigns, setCampaigns] = useState<CampaignBrief[]>([])

  const loadData = useCallback(async () => {
    const [briefRes, campRes] = await Promise.allSettled([
      fetch(`/api/clients/${clientId}/brief?status=active`),
      fetch(`/api/clients/${clientId}/campaign?status=active`),
    ])
    if (briefRes.status === 'fulfilled' && briefRes.value.ok) {
      const j = await briefRes.value.json()
      setHasBrief(!!j.brief)
    }
    if (campRes.status === 'fulfilled' && campRes.value.ok) {
      const j = await campRes.value.json()
      setCampaigns(j.campaigns ?? [])
    }
  }, [clientId])

  useEffect(() => {
    if (open) {
      loadData()
      setSavedCount(null)
      setError('')
    }
  }, [open, loadData])

  const handleRouteChange = (r: RouteId) => {
    setRoute(r)
    setInput('')
    setSavedCount(null)
    setError('')
  }

  const handleModeChange = (m: ContentMode) => {
    setMode(m)
    if (m === 'brand') setSelectedCampaignId(null)
    setSavedCount(null)
    setError('')
  }

  const togglePlatform = (p: string) => {
    setPlatforms(prev =>
      prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
    )
  }

  const handleGenerate = async () => {
    if (!input.trim()) { setError('请填写输入内容'); return }
    if (platforms.length === 0) { setError('请至少选择一个发布平台'); return }
    if (mode === 'campaign' && !selectedCampaignId) { setError('请选择推广活动'); return }

    setGenerating(true)
    setError('')
    setSavedCount(null)

    const endpoint = route === 'route_a'
      ? '/api/content/route-a'
      : route === 'route_b'
        ? '/api/content/route-b'
        : '/api/content/route-c'

    const bodyKey = route === 'route_a' ? 'keyword'
      : route === 'route_b' ? 'video_url'
        : 'topic'

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          [bodyKey]: input.trim(),
          platforms,
          campaign_id: selectedCampaignId ?? undefined,
          execution_item_id: executionItemId ?? undefined,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)

      // Count saved posts across all response shapes
      const saved: unknown[] = json.posts ?? json.saved_posts ?? json.variants ?? []
      setSavedCount(Array.isArray(saved) ? saved.length : 1)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setGenerating(false)
    }
  }

  if (!open) return null

  const activeRoute = ROUTES.find(r => r.id === route)!

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/30 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full max-w-[480px] bg-white z-50 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/[.06] flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-me-charcoal/90">生成单条内容</h2>
            {hasBrief === false && (
              <p className="text-xs text-me-ochre mt-0.5">⚠️ 尚无 Master Brief，生成将缺少品牌上下文</p>
            )}
          </div>
          <button onClick={onClose} className="text-me-charcoal/45 hover:text-me-charcoal/60 text-xl leading-none">×</button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

          {/* 来自执行看板的提示横幅 */}
          {executionItemId && (
            <div className="rounded-lg border border-me-ochre/30 bg-me-ochre/10 px-3 py-2.5 flex items-start gap-2">
              <span className="text-base">🔗</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-me-ochre">来自执行看板</p>
                <p className="text-[11px] text-me-ochre leading-relaxed mt-0.5">
                  生成的内容会自动关联回该执行项；帖子发布后，执行项会自动标记为「已完成」。
                </p>
              </div>
            </div>
          )}

          {/* Step 1: Route */}
          <div>
            <p className="text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide mb-2">1 · 生成路线</p>
            <div className="grid grid-cols-3 gap-2">
              {ROUTES.map(r => (
                <button
                  key={r.id}
                  onClick={() => handleRouteChange(r.id)}
                  className={`flex flex-col items-center py-3 px-2 rounded-xl border-2 transition-colors text-center ${
                    route === r.id
                      ? 'border-me-ochre bg-me-ochre/10 text-me-ochre'
                      : 'border-black/10 text-me-charcoal/60 hover:border-black/15'
                  }`}
                >
                  <span className="text-xl mb-1">{r.icon}</span>
                  <span className="text-xs font-medium">{r.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Step 2: Content Mode */}
          <div>
            <p className="text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide mb-2">2 · 内容模式</p>
            <div className="space-y-2">
              {(['brand', 'campaign'] as ContentMode[]).map(m => (
                <label
                  key={m}
                  className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${
                    mode === m ? 'border-me-ochre bg-me-ochre/10' : 'border-black/10 hover:border-black/15'
                  }`}
                >
                  <input
                    type="radio"
                    checked={mode === m}
                    onChange={() => handleModeChange(m)}
                    className="mt-0.5 accent-me-ochre"
                  />
                  <div>
                    <p className="text-sm font-medium text-me-charcoal/75">
                      {m === 'brand' ? '品牌内容' : '推广活动内容'}
                    </p>
                    <p className="text-xs text-me-charcoal/45 mt-0.5">
                      {m === 'brand'
                        ? '仅读取 Master Brief，适合长期品牌内容'
                        : '读取 MB + 推广活动，适合当下产品推广'}
                    </p>
                  </div>
                </label>
              ))}
            </div>

            {/* Campaign selector */}
            {mode === 'campaign' && (
              <div className="mt-3">
                {campaigns.length === 0 ? (
                  <p className="text-xs text-me-ochre bg-me-ochre/10 rounded-lg px-3 py-2">
                    当前无进行中的活动。请先在「推广活动」tab 中创建活动。
                  </p>
                ) : (
                  <div className="space-y-2">
                    {campaigns.map((c, i) => (
                      <label
                        key={c.id}
                        className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors border-l-4 ${
                          CAMPAIGN_BORDER_COLORS[i % CAMPAIGN_BORDER_COLORS.length]
                        } ${
                          selectedCampaignId === c.id
                            ? 'border-me-ochre bg-me-ochre/10'
                            : 'border-black/10 hover:border-black/15'
                        }`}
                      >
                        <input
                          type="radio"
                          checked={selectedCampaignId === c.id}
                          onChange={() => setSelectedCampaignId(c.id)}
                          className="accent-me-ochre"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-me-charcoal/75 truncate">{c.title}</p>
                          {c.valid_from && (
                            <p className="text-xs text-me-charcoal/45">{c.valid_from} → {c.valid_until ?? '—'}</p>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Step 3: Input */}
          <div>
            <p className="text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide mb-2">
              3 · {activeRoute.inputLabel}
            </p>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !generating && handleGenerate()}
              placeholder={activeRoute.inputPlaceholder}
              className="w-full bg-me-ivory border border-black/10 rounded-xl px-4 py-2.5 text-sm text-me-charcoal/90 placeholder-me-charcoal/45 focus:outline-none focus:ring-2 focus:ring-me-ochre focus:bg-white transition-colors"
            />
          </div>

          {/* Step 4: Platforms */}
          <div>
            <p className="text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide mb-2">4 · 发布平台</p>
            <div className="flex gap-2">
              {PLATFORMS.map(p => (
                <button
                  key={p}
                  onClick={() => togglePlatform(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border-2 transition-colors capitalize ${
                    platforms.includes(p)
                      ? 'border-me-ochre bg-me-ochre/10 text-me-ochre'
                      : 'border-black/10 text-me-charcoal/55 hover:border-black/15'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-xs text-[#C2453A] bg-[#C2453A]/10 rounded-lg px-3 py-2">{error}</p>
          )}

          {/* Success state */}
          {savedCount !== null && (
            <div className="bg-[#5C8A4A]/10 border border-[#5C8A4A]/30 rounded-xl px-4 py-4 text-center space-y-3">
              <p className="text-sm font-semibold text-[#5C8A4A]">
                ✓ 已保存 {savedCount} 条内容草稿
              </p>
              <p className="text-xs text-[#5C8A4A]">
                前往内容板批量检查和审批
              </p>
              <a
                href={`/dashboard/content?client=${clientId}`}
                className="inline-block text-xs bg-[#5C8A4A] hover:bg-[#5C8A4A] text-white px-4 py-2 rounded-lg font-medium transition-colors"
              >
                前往内容板 →
              </a>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-black/[.06] flex-shrink-0 space-y-2">
          {savedCount !== null ? (
            <button
              onClick={() => { setSavedCount(null); setInput(''); setError('') }}
              className="w-full py-3 rounded-xl text-sm font-medium border border-black/10 text-me-charcoal/60 hover:bg-me-ivory transition-colors"
            >
              再生成一条
            </button>
          ) : (
            <button
              onClick={handleGenerate}
              disabled={generating || !input.trim() || platforms.length === 0}
              className="w-full py-3 rounded-xl text-sm font-semibold bg-me-ochre hover:bg-me-ochre/90 text-white disabled:opacity-50 transition-colors"
            >
              {generating ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  生成中…
                </span>
              ) : '生成并保存草稿'}
            </button>
          )}
          <p className="text-center text-xs text-me-charcoal/45">
            批量生成请前往「推广活动」tab 使用一键生成
          </p>
        </div>
      </div>
    </>
  )
}
