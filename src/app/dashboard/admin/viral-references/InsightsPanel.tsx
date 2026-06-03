'use client'

import { useState, useMemo, useEffect } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type ContentGoal = 'brand' | 'sales' | 'ugc' | 'education'

interface StyleScores {
  energy: number
  luxury: number
  authenticity: number
  emotional: number
  humor: number
  urgency: number
  offer_signal: number
}

interface OpeningHook {
  type: string
  script: string
  feel: string
}

export interface ViralReferenceForInsights {
  id: string
  industry: string
  content_goal: ContentGoal
  is_our_video: boolean
  is_learnable: boolean
  analysis_status: string
  style_scores: StyleScores | null
  style_tags: string[] | null
  style_description: string | null
  persona_fit: string[] | null
  key_techniques: string[] | null
  opening_hook: OpeningHook | null
  view_count: number | null
  video_title: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function freqMap(items: string[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const item of items) m.set(item, (m.get(item) ?? 0) + 1)
  return m
}

function sortedEntries(m: Map<string, number>): [string, number][] {
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
}

const SCORE_LABELS: Record<keyof StyleScores, string> = {
  energy:       'Energy 能量感',
  luxury:       'Luxury 高端感',
  authenticity: 'Authentic 真实感',
  emotional:    'Emotional 情感',
  humor:        'Humor 趣味',
  urgency:      'Urgency 紧迫感',
  offer_signal: 'Offer 产品感',
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

const DIM_ZH: Record<keyof StyleScores, string> = {
  energy:       '高能量剪辑',
  luxury:       '高端制作感',
  authenticity: '真实感/UGC风',
  emotional:    '情感共鸣',
  humor:        '轻松幽默',
  urgency:      '紧迫感/限时',
  offer_signal: '产品/服务展示',
}

const GOAL_META: Record<ContentGoal, { label: string; emoji: string }> = {
  brand:     { label: 'Brand',     emoji: '🎨' },
  sales:     { label: 'Sales',     emoji: '💰' },
  ugc:       { label: 'UGC',       emoji: '📱' },
  education: { label: 'Education', emoji: '🎓' },
}

const HOOK_TYPE_ZH: Record<string, string> = {
  visual_shock:           '视觉冲击',
  ugc_selfie:             'UGC 自拍',
  text_overlay_question:  '文字提问',
  product_reveal:         '产品特写',
  testimonial_start:      '真实证言',
  sound_cue:              '音效钩子',
  problem_statement:      '痛点开场',
  scenic_beauty:          '震撼风景',
}

const HOOK_TYPE_COLOR: Record<string, string> = {
  visual_shock:          'bg-status-rej/25 text-status-rej',
  ugc_selfie:            'bg-status-exec/25 text-me-gold',
  text_overlay_question: 'bg-status-exec/25 text-me-gold',
  product_reveal:        'bg-status-exec/25 text-me-gold',
  testimonial_start:     'bg-status-track/25 text-status-track',
  sound_cue:             'bg-status-exec/25 text-me-gold',
  problem_statement:     'bg-status-exec/25 text-me-gold',
  scenic_beauty:         'bg-status-exec/25 text-me-gold',
}

const INDUSTRY_EMOJI: Record<string, string> = {
  travel:         '✈️',
  flooring:       '🪵',
  real_estate:    '🏠',
  food:           '🍽️',
  fashion:        '👗',
  fitness:        '💪',
  tech:           '💻',
  beauty:         '💄',
  home_improvement: '🔨',
  finance:        '💰',
}

function industryLabel(ind: string): string {
  const emoji = INDUSTRY_EMOJI[ind] ?? '📦'
  return `${emoji} ${ind.charAt(0).toUpperCase() + ind.slice(1).replace(/_/g, ' ')}`
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ScoreBar({ dim, value, compareValue }: {
  dim: keyof StyleScores
  value: number
  compareValue?: number
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-me-ivory/50 w-36 shrink-0">{SCORE_LABELS[dim]}</span>
      <div className="flex-1 bg-white/10 rounded-full h-1.5 relative">
        <div
          className={`${SCORE_COLORS[dim]} h-1.5 rounded-full transition-all`}
          style={{ width: `${(value / 10) * 100}%` }}
        />
        {compareValue !== undefined && (
          <div
            className="absolute top-0 h-1.5 w-0.5 bg-white/50 rounded"
            style={{ left: `${(compareValue / 10) * 100}%` }}
            title={`对比行业: ${compareValue.toFixed(1)}`}
          />
        )}
      </div>
      <span className="text-xs text-me-ivory/40 w-6 text-right font-mono">{value.toFixed(1)}</span>
    </div>
  )
}

// ─── Industry Comparison Matrix ───────────────────────────────────────────────

function IndustryComparisonMatrix({ poolByIndustry }: {
  poolByIndustry: Map<string, ViralReferenceForInsights[]>
}) {
  const industries = Array.from(poolByIndustry.keys())
  if (industries.length < 2) return null

  const avgByIndustry = new Map<string, StyleScores>()
  for (const [ind, pool] of Array.from(poolByIndustry.entries())) {
    const sum: StyleScores = { energy: 0, luxury: 0, authenticity: 0, emotional: 0, humor: 0, urgency: 0, offer_signal: 0 }
    for (const r of pool) {
      for (const k of Object.keys(sum) as (keyof StyleScores)[]) sum[k] += r.style_scores![k]
    }
    const n = pool.length
    avgByIndustry.set(ind, {
      energy: sum.energy / n, luxury: sum.luxury / n, authenticity: sum.authenticity / n,
      emotional: sum.emotional / n, humor: sum.humor / n, urgency: sum.urgency / n,
      offer_signal: sum.offer_signal / n,
    })
  }

  const dims = Object.keys(SCORE_LABELS) as (keyof StyleScores)[]

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4">
      <p className="text-[11px] font-semibold text-me-ivory/40 uppercase tracking-widest mb-4">
        ⚖️ 行业风格对比
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="text-left text-me-ivory/40 font-normal pb-2 w-36">维度</th>
              {industries.map(ind => (
                <th key={ind} className="text-center text-me-ivory/60 font-semibold pb-2 px-2">
                  {industryLabel(ind)}
                  <span className="block text-[10px] text-me-ivory/35 font-normal">
                    {poolByIndustry.get(ind)!.length} 条
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/8">
            {dims.map(dim => {
              const scores = industries.map(ind => avgByIndustry.get(ind)![dim])
              const maxScore = Math.max(...scores)
              return (
                <tr key={dim}>
                  <td className="text-me-ivory/50 py-1.5 pr-2">{SCORE_LABELS[dim]}</td>
                  {industries.map((ind, i) => {
                    const val = scores[i]
                    const isMax = val === maxScore && scores.filter(s => s === maxScore).length === 1
                    return (
                      <td key={ind} className="text-center py-1.5 px-2">
                        <span className={`font-mono ${isMax ? 'text-me-gold font-bold' : 'text-me-ivory/40'}`}>
                          {val.toFixed(1)}
                        </span>
                        <div className="mt-0.5 h-1 bg-white/10 rounded-full mx-auto w-12">
                          <div
                            className={`h-1 rounded-full ${SCORE_COLORS[dim]}`}
                            style={{ width: `${(val / 10) * 100}%` }}
                          />
                        </div>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Hook Analysis Section ────────────────────────────────────────────────────

function HookAnalysis({ pool }: { pool: ViralReferenceForInsights[] }) {
  const hooksPool = pool.filter(r => r.opening_hook?.type)
  if (hooksPool.length < 2) return null

  const typeFreq = freqMap(hooksPool.map(r => r.opening_hook!.type))
  const feelFreq = freqMap(hooksPool.map(r => r.opening_hook!.feel).filter(Boolean))
  const topTypes = sortedEntries(typeFreq)

  // Example scripts grouped by top hook type (up to 3 examples per type, 2 types)
  const examplesByType = topTypes.slice(0, 2).map(([type]) => ({
    type,
    scripts: hooksPool
      .filter(r => r.opening_hook?.type === type && r.opening_hook.script)
      .slice(0, 3)
      .map(r => ({ script: r.opening_hook!.script, title: r.video_title })),
  }))

  return (
    <div className="space-y-4">
      <p className="text-[11px] font-semibold text-me-ivory/50 uppercase tracking-widest">
        🎣 开场 Hook 分析（前 1.5 秒）
      </p>

      {/* Hook type distribution */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <p className="text-[10px] text-me-ivory/35 uppercase tracking-widest mb-2">Hook 类型分布</p>
          <div className="space-y-1.5">
            {topTypes.map(([type, count]) => {
              const pct = Math.round((count / hooksPool.length) * 100)
              const label = HOOK_TYPE_ZH[type] ?? type
              const colorCls = HOOK_TYPE_COLOR[type] ?? 'bg-white/10 text-me-ivory/50'
              return (
                <div key={type} className="flex items-center gap-2">
                  <span className={`text-[10px] px-2 py-0.5 rounded font-medium shrink-0 ${colorCls}`}>
                    {label}
                  </span>
                  <div className="flex-1 bg-white/10 rounded-full h-1.5">
                    <div
                      className="bg-me-ochre h-1.5 rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-me-ivory/35 w-8 text-right font-mono">{pct}%</span>
                </div>
              )
            })}
          </div>
        </div>

        <div>
          <p className="text-[10px] text-me-ivory/35 uppercase tracking-widest mb-2">开场节奏</p>
          <div className="space-y-2">
            {sortedEntries(feelFreq).map(([feel, count]) => {
              const pct = Math.round((count / hooksPool.length) * 100)
              const label = feel === 'abrupt-cut' ? '⚡ 突切/跳接' : feel === 'smooth-reveal' ? '🌊 渐入/电影感' : feel
              return (
                <div key={feel} className="flex items-center gap-2">
                  <span className="text-xs text-me-ivory/50 w-28 shrink-0">{label}</span>
                  <div className="flex-1 bg-white/10 rounded-full h-1.5">
                    <div className="bg-me-ochre h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[10px] text-me-ivory/35 w-8 text-right font-mono">{pct}%</span>
                </div>
              )
            })}
          </div>

          <p className="text-[10px] text-me-ivory/35 mt-3">
            基于 {hooksPool.length} 条视频的 Hook 数据
          </p>
        </div>
      </div>

      {/* Example scripts */}
      {examplesByType.some(e => e.scripts.length > 0) && (
        <div>
          <p className="text-[10px] text-me-ivory/35 uppercase tracking-widest mb-2">高频 Hook 脚本示例</p>
          <div className="space-y-3">
            {examplesByType.map(({ type, scripts }) => {
              if (scripts.length === 0) return null
              const colorCls = HOOK_TYPE_COLOR[type] ?? 'bg-white/10 text-me-ivory/50'
              const label = HOOK_TYPE_ZH[type] ?? type
              return (
                <div key={type} className="bg-white/5 border border-white/10 rounded-lg p-3">
                  <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${colorCls} mb-2 inline-block`}>
                    {label}
                  </span>
                  <div className="space-y-1.5 mt-1">
                    {scripts.map((s, i) => (
                      <div key={i} className="text-xs">
                        {s.script ? (
                          <p className="text-me-ivory/60 italic">"{s.script}"</p>
                        ) : null}
                        {s.title && (
                          <p className="text-me-ivory/35 text-[10px] mt-0.5 truncate">— {s.title}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Narrative builder ────────────────────────────────────────────────────────

function buildNarrative(
  pool: ViralReferenceForInsights[],
  avg: StyleScores,
  topTechs: [string, number][],
  topPersonas: [string, number][],
  industry: string,
): string {
  const n = pool.length
  const withViews = pool.filter(r => r.view_count)
  const avgViews = withViews.length
    ? Math.round(withViews.reduce((s, r) => s + (r.view_count ?? 0), 0) / withViews.length)
    : 0

  const sortedDims = (Object.entries(avg) as [keyof StyleScores, number][]).sort((a, b) => b[1] - a[1])
  const top1 = sortedDims[0]
  const top2 = sortedDims[1]

  const indLabel = industry.replace(/_/g, ' ')
  let text = `分析了 ${n} 条${indLabel}行业爆款视频`
  if (avgViews > 0) text += `（平均播放 ${fmtViews(avgViews)}）`
  text += `：核心风格特征是「${DIM_ZH[top1[0]]}」（均分 ${top1[1].toFixed(1)}/10）`
  if (top2[1] >= 5.0) text += ` 搭配「${DIM_ZH[top2[0]]}」（均分 ${top2[1].toFixed(1)}/10）`
  text += `。`
  if (topTechs.length > 0) text += ` 最高频拍摄技法：${topTechs.slice(0, 3).map(([t]) => t).join('、')}。`
  if (topPersonas.length > 0) text += ` 主要面向「${topPersonas[0][0]}」受众群体。`
  text += ` 以上规律已自动融入 Reel 生成引擎，每次生成内容时系统会匹配最相关的爆款风格。`
  return text
}

// ─── Main panel ───────────────────────────────────────────────────────────────

interface Props {
  refs: ViralReferenceForInsights[]
}

export function InsightsPanel({ refs }: Props) {
  // Build learnable pool per industry
  const learnable = useMemo(() =>
    refs.filter(r => r.analysis_status === 'done' && r.is_learnable && !r.is_our_video && r.style_scores),
    [refs]
  )

  const industries = useMemo(() => {
    const s = new Set(learnable.map(r => r.industry))
    return Array.from(s).sort()
  }, [learnable])

  const [industry, setIndustry] = useState<string>('')
  const [open, setOpen] = useState(true)

  useEffect(() => {
    if (industries.length > 0 && !industries.includes(industry)) {
      setIndustry(industries[0])
    }
  }, [industries, industry])

  // Pool for currently-selected industry
  const pool = useMemo(() =>
    learnable.filter(r => r.industry === industry).sort((a, b) => (b.view_count ?? 0) - (a.view_count ?? 0)),
    [learnable, industry]
  )

  // All industry pools (for comparison matrix)
  const poolByIndustry = useMemo(() => {
    const m = new Map<string, ViralReferenceForInsights[]>()
    for (const ind of industries) {
      m.set(ind, learnable.filter(r => r.industry === ind))
    }
    return m
  }, [learnable, industries])

  const insights = useMemo(() => {
    if (pool.length < 2) return null

    const sum: StyleScores = { energy: 0, luxury: 0, authenticity: 0, emotional: 0, humor: 0, urgency: 0, offer_signal: 0 }
    for (const r of pool) {
      const s = r.style_scores!
      for (const k of Object.keys(sum) as (keyof StyleScores)[]) sum[k] += s[k]
    }
    const n = pool.length
    const avg: StyleScores = {
      energy: sum.energy / n, luxury: sum.luxury / n, authenticity: sum.authenticity / n,
      emotional: sum.emotional / n, humor: sum.humor / n, urgency: sum.urgency / n,
      offer_signal: sum.offer_signal / n,
    }

    const techFreq    = freqMap(pool.flatMap(r => r.key_techniques ?? []))
    const tagFreq     = freqMap(pool.flatMap(r => r.style_tags ?? []))
    const goalFreq    = freqMap(pool.map(r => r.content_goal))
    const personaFreq = freqMap(pool.flatMap(r => r.persona_fit ?? []))

    const topTechs    = sortedEntries(techFreq).slice(0, 6)
    const topTags     = sortedEntries(tagFreq).slice(0, 12)
    const topPersonas = sortedEntries(personaFreq).slice(0, 4)
    const goalDist    = sortedEntries(goalFreq)
    const topPerformers = pool.filter(r => r.view_count).slice(0, 3)
    const narrative   = buildNarrative(pool, avg, topTechs, topPersonas, industry)

    return { avg, topTechs, topTags, topPersonas, goalDist, topPerformers, narrative }
  }, [pool, industry])

  // Other industries' avg scores for comparison lines on the DNA bars
  const otherIndustriesAvg = useMemo((): StyleScores | undefined => {
    if (industries.length < 2) return undefined
    const otherPools = industries.filter(i => i !== industry).flatMap(i => poolByIndustry.get(i) ?? [])
    if (otherPools.length === 0) return undefined
    const sum: StyleScores = { energy: 0, luxury: 0, authenticity: 0, emotional: 0, humor: 0, urgency: 0, offer_signal: 0 }
    for (const r of otherPools) {
      for (const k of Object.keys(sum) as (keyof StyleScores)[]) sum[k] += r.style_scores![k]
    }
    const n = otherPools.length
    return {
      energy: sum.energy / n, luxury: sum.luxury / n, authenticity: sum.authenticity / n,
      emotional: sum.emotional / n, humor: sum.humor / n, urgency: sum.urgency / n,
      offer_signal: sum.offer_signal / n,
    }
  }, [industries, industry, poolByIndustry])

  if (industries.length === 0) return null

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 gap-3 flex-wrap">
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-3 flex-1 text-left hover:opacity-80 transition-opacity min-w-0"
        >
          <span className="text-base">📊</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">AI 洞察报告</p>
            <p className="text-xs text-me-ivory/50">
              爆款规律分析 · 可向客户展示
              <span className="text-me-ochre/80"> · {industries.length} 个行业 · {learnable.length} 条视频</span>
            </p>
          </div>
          <span className="text-me-ivory/35 text-xs ml-2 shrink-0">{open ? '▲ 收起' : '▼ 展开'}</span>
        </button>

        {/* Industry tabs */}
        <div className="flex gap-1.5 shrink-0">
          {industries.map(ind => (
            <button
              key={ind}
              onClick={() => setIndustry(ind)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                industry === ind
                  ? 'bg-me-ochre text-white'
                  : 'bg-white/10 text-me-ivory/50 hover:text-white'
              }`}
            >
              {industryLabel(ind)}
              <span className={`ml-1.5 text-[10px] ${industry === ind ? 'text-me-ochre/80' : 'text-me-ivory/35'}`}>
                {poolByIndustry.get(ind)?.length ?? 0}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      {open && (
        <div className="border-t border-white/10 p-5 space-y-6">

          {/* Industry comparison matrix (only when 2+ industries) */}
          {industries.length >= 2 && (
            <IndustryComparisonMatrix poolByIndustry={poolByIndustry} />
          )}

          {!insights ? (
            <p className="text-sm text-me-ivory/35 text-center py-4">
              需要至少 2 条已分析的可学习视频才能生成洞察报告
            </p>
          ) : (
            <>
              {/* Narrative summary */}
              <div className="bg-me-ochre/50 border border-me-ochre/50 rounded-lg p-4">
                <p className="text-[11px] font-semibold text-me-ochre/80 uppercase tracking-widest mb-2">
                  💡 核心洞察 — {industryLabel(industry)}
                </p>
                <p className="text-sm text-me-ivory leading-relaxed">{insights.narrative}</p>
              </div>

              {/* DNA + Techniques */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <p className="text-[11px] font-semibold text-me-ivory/40 uppercase tracking-widest mb-3">
                    🧬 爆款视频风格 DNA
                  </p>
                  {industries.length >= 2 && otherIndustriesAvg && (
                    <p className="text-[10px] text-me-ivory/35 mb-2">
                      白色竖线 = 其他行业均值对比
                    </p>
                  )}
                  <div className="space-y-2.5">
                    {(Object.keys(insights.avg) as (keyof StyleScores)[]).map(dim => (
                      <ScoreBar
                        key={dim}
                        dim={dim}
                        value={insights.avg[dim]}
                        compareValue={otherIndustriesAvg?.[dim]}
                      />
                    ))}
                  </div>
                  <p className="text-[11px] text-me-ivory/35 mt-3">{pool.length} 条视频平均分 · 最高 10 分</p>
                </div>

                <div className="space-y-5">
                  {insights.topTechs.length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold text-me-ivory/40 uppercase tracking-widest mb-2">
                        🎬 高频拍摄技法
                      </p>
                      <div className="space-y-1.5">
                        {insights.topTechs.map(([tech, count]) => (
                          <div key={tech} className="flex items-center gap-2">
                            <span className="flex-1 text-xs text-me-ivory/50">{tech}</span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <div
                                className="h-1.5 bg-me-ochre rounded-full"
                                style={{ width: `${Math.round((count / insights.topTechs[0][1]) * 52)}px` }}
                              />
                              <span className="text-[10px] text-me-ivory/35 w-3 text-right">{count}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {insights.topTags.length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold text-me-ivory/40 uppercase tracking-widest mb-2">
                        🏷️ 风格标签
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {insights.topTags.map(([tag]) => (
                          <span key={tag} className="text-xs px-2 py-0.5 rounded bg-white/10 text-me-ivory/50">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Hook Analysis */}
              <div className="border-t border-white/10 pt-5">
                <HookAnalysis pool={pool} />
              </div>

              {/* Goal distribution + Personas */}
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <p className="text-[11px] font-semibold text-me-ivory/40 uppercase tracking-widest mb-3">
                    🎯 内容类型分布
                  </p>
                  <div className="space-y-2">
                    {insights.goalDist.map(([goal, count]) => {
                      const meta = GOAL_META[goal as ContentGoal]
                      const pct  = Math.round((count / pool.length) * 100)
                      return (
                        <div key={goal} className="flex items-center gap-2">
                          <span className="text-xs text-me-ivory/50 w-24 shrink-0">
                            {meta?.emoji} {meta?.label}
                          </span>
                          <div className="flex-1 bg-white/10 rounded-full h-1.5">
                            <div className="bg-me-ochre h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-me-ivory/50 w-8 text-right font-mono">{pct}%</span>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div>
                  <p className="text-[11px] font-semibold text-me-ivory/40 uppercase tracking-widest mb-3">
                    👥 目标受众画像
                  </p>
                  <div className="space-y-2">
                    {insights.topPersonas.map(([persona, count]) => {
                      const pct = Math.round((count / pool.length) * 100)
                      return (
                        <div key={persona} className="flex items-center gap-2">
                          <span className="text-xs text-me-ivory/50 flex-1 truncate leading-snug" title={persona}>
                            {persona}
                          </span>
                          <span className="text-xs text-status-track font-mono shrink-0">{pct}%</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* Top performers */}
              {insights.topPerformers.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-me-ivory/40 uppercase tracking-widest mb-3">
                    🏆 播放量最高的参考视频
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {insights.topPerformers.map((r, i) => (
                      <div key={r.id} className="bg-white/5 border border-white/10 rounded-lg p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-base">{['🥇', '🥈', '🥉'][i]}</span>
                          <span className="text-me-gold text-xs font-bold">
                            {fmtViews(r.view_count!)} views
                          </span>
                          {r.opening_hook?.type && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${HOOK_TYPE_COLOR[r.opening_hook.type] ?? 'bg-white/10 text-me-ivory/50'}`}>
                              {HOOK_TYPE_ZH[r.opening_hook.type] ?? r.opening_hook.type}
                            </span>
                          )}
                        </div>
                        {r.video_title && (
                          <p className="text-xs text-me-ivory/60 line-clamp-2 leading-relaxed">{r.video_title}</p>
                        )}
                        {r.opening_hook?.script && (
                          <p className="text-[10px] text-me-ochre/80 italic line-clamp-1">
                            Hook: "{r.opening_hook.script}"
                          </p>
                        )}
                        {r.key_techniques && r.key_techniques.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {r.key_techniques.slice(0, 2).map(t => (
                              <span key={t} className="text-[10px] px-1.5 py-0.5 bg-me-ochre/50 text-me-ochre/80 rounded">
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
