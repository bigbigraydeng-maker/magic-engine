/**
 * Google SERP / AI Overview Panel — sister view to AiVisibilityPanel.
 *
 * Shows the same question set but with Google SERP organic + AI Overview
 * data (collected in the same DataForSEO call). Useful for AI vs Google
 * comparison: same question, see who Google ranks vs who AI recommends.
 */

'use client'

import { useCallback, useEffect, useState } from 'react'
import { SerpRowErrorBoundary } from './SerpRowErrorBoundary'

interface Snapshot {
  id:                  string
  question_id:         string
  platform:            string
  collected_at:        string
  collected_date:      string   // YYYY-MM-DD, UTC — primary time axis (since migration 20260622000003)
  week_of:             string   // kept for backward-compat weekly rollups
  brands_mentioned:    string[] | null
  top3_brands:         string[] | null
  ai_answer_text:      string | null
  ai_citation_sources: string[] | null
  serp_organic_top10:  Array<{ position: number; title: string; url: string; description: string }> | null
  serp_local_pack:     Array<{ name: string; rating: number | null; review_count: number | null; address: string | null }> | null
  serp_people_also_ask: string[] | null
  error_message:       string | null
  industry_ai_visibility_questions?: {
    industry_code: string
    intent_layer: string
    country: string | null
    language: string
    question_text: string
  } | null
}

const INDUSTRY_LABELS: Record<string, string> = {
  inbound_tour:  'Inbound Tour（入境旅游）',
  outbound_tour: 'Outbound Tour（出境旅游）',
  migration:     'Migration & Study（留学移民）',
  restaurant:    'Restaurant（餐饮）',
  real_estate:   'Real Estate（房产）',
}

export function GoogleSerpPanel() {
  const [serpSnapshots, setSerpSnapshots] = useState<Snapshot[]>([])
  const [aiOverviewSnapshots, setAiOverviewSnapshots] = useState<Snapshot[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [serpRes, aiRes] = await Promise.all([
        fetch('/api/baselines/ai-snapshots?days=30&latest_only=true&platform=google_serp'),
        fetch('/api/baselines/ai-snapshots?days=30&latest_only=true&platform=google_ai_overview'),
      ])
      if (serpRes.ok) {
        const j = await serpRes.json() as { snapshots: Snapshot[] }
        setSerpSnapshots(j.snapshots ?? [])
      }
      if (aiRes.ok) {
        const j = await aiRes.json() as { snapshots: Snapshot[] }
        setAiOverviewSnapshots(j.snapshots ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Pair the two by question_id
  const aiOverviewByQuestionId = new Map(aiOverviewSnapshots.map(s => [s.question_id, s]))

  // Group by industry
  const groupedByIndustry = new Map<string, Snapshot[]>()
  for (const s of serpSnapshots) {
    const industry = s.industry_ai_visibility_questions?.industry_code ?? 'unknown'
    const arr = groupedByIndustry.get(industry) ?? []
    arr.push(s)
    groupedByIndustry.set(industry, arr)
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1 rounded-xl border border-me-ochre/30 bg-me-ochre/10 px-4 py-3 text-xs font-semibold text-me-charcoal/80">
        <p><strong className="font-black text-me-charcoal">Google 排名 = 自然搜索 + AI Overview。</strong>DataForSEO 一次调用同时返回两份数据：Google 自然 SERP 排名 + AI Overview 文本。两者并列展示，方便对比"Google 排名 vs AI 推荐"差异。</p>
      </div>

      {loading && (
        <div className="py-8 text-center text-sm font-semibold text-me-charcoal/45">Loading…</div>
      )}

      {!loading && groupedByIndustry.size === 0 && (
        <div className="py-8 text-center text-sm font-semibold text-me-charcoal/45">
          暂无 Google SERP 快照。请先在「AI 可见度」Tab 触发一次采集。
        </div>
      )}

      {Array.from(groupedByIndustry.entries()).map(([industry, snaps]) => (
        <div key={industry} className="overflow-hidden rounded-xl border border-black/10 bg-white shadow-sm">
          <div className="border-b border-black/10 px-4 py-3">
            <h3 className="font-display text-sm font-bold text-me-charcoal">{INDUSTRY_LABELS[industry] ?? industry}</h3>
            <p className="mt-0.5 text-xs font-semibold text-me-charcoal/45">{snaps.length} 题</p>
          </div>
          <div className="divide-y divide-black/5">
            {snaps.map(s => (
              <SerpRowErrorBoundary
                key={s.id}
                snapshotId={s.id}
                questionPreview={s.industry_ai_visibility_questions?.question_text?.slice(0, 60) ?? '(unknown)'}
              >
                <SerpRow
                  snapshot={s}
                  aiOverview={aiOverviewByQuestionId.get(s.question_id)}
                />
              </SerpRowErrorBoundary>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function SerpRow({ snapshot, aiOverview }: { snapshot: Snapshot; aiOverview?: Snapshot }) {
  const [expanded, setExpanded] = useState(false)

  const q = snapshot.industry_ai_visibility_questions
  const country = q?.country?.toUpperCase() ?? '—'
  const langLabel = q?.language === 'zh' ? '中文' : 'EN'
  const intent = q?.intent_layer ?? '—'

  // 魏征 Hotfix-5: defensive Array.isArray guards everywhere. Even though
  // the schema types claim these are typed arrays, real Supabase responses
  // can deliver null / undefined / scalar shapes (e.g. when DataForSEO
  // returns no organic block at all). Calling .map on a non-array is the
  // classic "Application error" crash trigger.
  const organicAll = Array.isArray(snapshot.serp_organic_top10) ? snapshot.serp_organic_top10 : []
  const localPack = Array.isArray(snapshot.serp_local_pack) ? snapshot.serp_local_pack : []
  const peopleAlsoAsk = Array.isArray(snapshot.serp_people_also_ask) ? snapshot.serp_people_also_ask : []
  const organicTop3 = organicAll.slice(0, 3)
  const aiTop3 = Array.isArray(aiOverview?.top3_brands) ? aiOverview.top3_brands : []

  return (
    <div className="px-4 py-3">
      <div
        className="flex cursor-pointer items-start justify-between gap-4"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-me-charcoal/10 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-me-charcoal/65">{country}</span>
            <span className="rounded-full bg-me-charcoal/10 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-me-charcoal/65">{langLabel}</span>
            <span className="rounded-full bg-me-charcoal/10 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-me-charcoal/65">{intent}</span>
          </div>
          <p className="mt-1 text-sm font-semibold text-me-charcoal">{q?.question_text ?? '(题目缺失)'}</p>

          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
            <div>
              <p className="text-[10px] font-black uppercase tracking-wide text-me-charcoal/45">Google 自然 Top 3</p>
              {organicTop3.length > 0 ? (
                <ol className="mt-1 list-decimal pl-4 text-xs font-semibold text-me-charcoal/85">
                  {organicTop3.map((o, i) => (
                    <li key={`top3-${i}`} className="truncate">{o?.title ?? '(no title)'}</li>
                  ))}
                </ol>
              ) : (
                <p className="mt-1 text-xs font-semibold text-me-charcoal/45 italic">无</p>
              )}
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-wide text-me-charcoal/45">AI Overview Top 3</p>
              {aiTop3.length > 0 ? (
                <ol className="mt-1 list-decimal pl-4 text-xs font-semibold text-me-charcoal/85">
                  {aiTop3.map((b, i) => (
                    <li key={`aitop3-${i}`}>{b ?? ''}</li>
                  ))}
                </ol>
              ) : (
                <p className="mt-1 text-xs font-semibold text-me-charcoal/45 italic">无 AI Overview</p>
              )}
            </div>
          </div>
        </div>
        <button className="text-xs font-black text-me-ochre">{expanded ? '收起' : '展开'}</button>
      </div>

      {expanded && (
        <div className="mt-3 space-y-3 rounded-lg bg-me-ivory px-3 py-2 text-xs">
          {aiOverview?.ai_answer_text && (
            <div>
              <p className="font-black uppercase tracking-wide text-me-charcoal/45">AI Overview 全文</p>
              <pre className="mt-1 whitespace-pre-wrap font-sans text-me-charcoal/85">{aiOverview.ai_answer_text}</pre>
            </div>
          )}
          {organicAll.length > 0 && (
            <div>
              <p className="font-black uppercase tracking-wide text-me-charcoal/45">Google 自然 Top 10</p>
              <ol className="mt-1 list-decimal pl-4 text-me-charcoal/85">
                {organicAll.map((o, i) => (
                  <li key={`organic-${i}`}>
                    <span className="font-semibold">{o?.title ?? '(no title)'}</span>{' '}
                    <span className="text-me-charcoal/45">— {o?.url ?? ''}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {localPack.length > 0 && (
            <div>
              <p className="font-black uppercase tracking-wide text-me-charcoal/45">Local Pack</p>
              <ul className="mt-1 list-disc pl-4 text-me-charcoal/85">
                {localPack.map((lp, i) => (
                  <li key={`lp-${i}`}>
                    <span className="font-semibold">{lp?.name ?? '(unnamed)'}</span>
                    {/* 魏征 Hotfix-5: previously `{lp.rating && ...}` would render
                        literal "0" when rating === 0 because JSX falsy-renders 0.
                        Use explicit non-null check. */}
                    {lp?.rating != null && <span className="ml-2 text-me-ochre">{lp.rating}★</span>}
                    {lp?.review_count != null && <span className="ml-1 text-me-charcoal/45">({lp.review_count})</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {peopleAlsoAsk.length > 0 && (
            <div>
              <p className="font-black uppercase tracking-wide text-me-charcoal/45">People Also Ask</p>
              <ul className="mt-1 list-disc pl-4 text-me-charcoal/85">
                {peopleAlsoAsk.map((p, i) => <li key={`paa-${i}`}>{p ?? ''}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
