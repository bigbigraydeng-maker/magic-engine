/**
 * Industry AI Visibility Panel — shown under the "AI 可见度" tab.
 *
 * Two sub-views: questions list (left) and latest snapshots (right).
 * Admin can trigger manual collection; cron handles weekly automation.
 */

'use client'

import { useCallback, useEffect, useState } from 'react'

interface Question {
  id:             string
  industry_code:  string
  intent_layer:   string
  geo_scope:      'national' | 'city'
  country:        string | null
  city:           string | null
  language:       'en' | 'zh'
  question_text:  string
  platforms:      string[]
  is_active:      boolean
  locked_at:      string | null
  created_at:     string
  notes:          string | null
}

interface Snapshot {
  id:                  string
  question_id:         string
  platform:            string
  collected_at:        string
  week_of:             string
  brands_mentioned:    string[] | null
  top3_brands:         string[] | null
  ai_answer_text:      string | null
  ai_citation_sources: string[] | null
  cost_usd:            number | null
  error_code:          string | null
  error_message:       string | null
  industry_ai_visibility_questions?: {
    industry_code: string
    country:       string | null
    language:      string
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

const PLATFORM_LABELS: Record<string, string> = {
  chatgpt:            'ChatGPT',
  google_ai_overview: 'Google AI Overview',
  google_serp:        'Google SERP',
  xiaohongshu:        '小红书',
}

export function AiVisibilityPanel() {
  const [questions, setQuestions] = useState<Question[]>([])
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [loading, setLoading]     = useState(true)
  const [collecting, setCollecting] = useState(false)
  const [collectMsg, setCollectMsg] = useState('')
  const [industryFilter, setIndustryFilter] = useState<string>('all')

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [qRes, sRes] = await Promise.all([
        fetch('/api/baselines/ai-questions'),
        fetch('/api/baselines/ai-snapshots?weeks=8&latest_only=true&platform=chatgpt'),
      ])
      if (qRes.ok) {
        const j = await qRes.json() as { questions: Question[] }
        setQuestions(j.questions ?? [])
      }
      if (sRes.ok) {
        const j = await sRes.json() as { snapshots: Snapshot[] }
        setSnapshots(j.snapshots ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  const handleCollect = async () => {
    if (!confirm('Trigger a collection run now? This calls ChatGPT + DataForSEO for every active question and may take 1-3 minutes.')) return
    setCollecting(true)
    setCollectMsg('')
    try {
      const res = await fetch('/api/baselines/ai-collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const j = await res.json()
      if (!res.ok) {
        setCollectMsg(`✗ ${j.error ?? 'Failed'}`)
      } else {
        setCollectMsg(`✓ ${j.questions_ok}/${j.questions_attempted} ok · ${j.snapshots_written} snapshots · $${(j.total_cost_usd ?? 0).toFixed(4)} · ${j.duration_seconds}s`)
        await loadAll()
      }
    } catch (err) {
      setCollectMsg(`✗ ${(err as Error).message}`)
    } finally {
      setCollecting(false)
    }
  }

  const filteredQuestions = industryFilter === 'all'
    ? questions
    : questions.filter(q => q.industry_code === industryFilter)

  const snapshotByQuestionId = new Map(snapshots.map(s => [s.question_id, s]))

  // Group questions by industry
  const groupedByIndustry = new Map<string, Question[]>()
  for (const q of filteredQuestions) {
    const arr = groupedByIndustry.get(q.industry_code) ?? []
    arr.push(q)
    groupedByIndustry.set(q.industry_code, arr)
  }

  return (
    <div className="space-y-4">
      {/* Info banner */}
      <div className="space-y-1 rounded-xl border border-me-ochre/30 bg-me-ochre/10 px-4 py-3 text-xs font-semibold text-me-charcoal/80">
        <p><strong className="font-black text-me-charcoal">行业 AI 可见度时序档案。</strong>每周追踪 ChatGPT + Google AI Overview + Google SERP 对每个行业问题的回答，记录哪些品牌被推荐、排名变化。数据进入飞轮归因分析。</p>
        <p>问题一旦开始采集，<strong>question_text 永久锁定</strong>（保证时序连续性）。需要替换问题请新增 + 停用旧问题。</p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/10 bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <label className="text-[10px] font-black uppercase tracking-wide text-me-charcoal/55">行业筛选</label>
          <select
            value={industryFilter}
            onChange={e => setIndustryFilter(e.target.value)}
            className="rounded-md border border-black/15 bg-white px-3 py-1.5 text-xs font-bold text-me-charcoal focus:border-me-ochre focus:outline-none"
          >
            <option value="all">全部行业</option>
            {Object.entries(INDUSTRY_LABELS).map(([code, label]) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
          <span className="text-xs font-semibold text-me-charcoal/55">{filteredQuestions.length} 题</span>
        </div>
        <div className="flex items-center gap-3">
          {collectMsg && (
            <span className={`text-xs font-bold ${collectMsg.startsWith('✓') ? 'text-status-track' : 'text-status-rej'}`}>{collectMsg}</span>
          )}
          <button
            onClick={handleCollect}
            disabled={collecting}
            className="rounded-lg bg-me-ochre px-4 py-2 text-xs font-black text-white transition-colors hover:bg-me-ochre/90 disabled:opacity-50"
          >
            {collecting ? '采集中…' : '▶ 立即采集'}
          </button>
        </div>
      </div>

      {loading && (
        <div className="py-8 text-center text-sm font-semibold text-me-charcoal/45">Loading…</div>
      )}

      {!loading && filteredQuestions.length === 0 && (
        <div className="py-8 text-center text-sm font-semibold text-me-charcoal/45">
          暂无问题。请先通过 API 或种子脚本添加问题。
        </div>
      )}

      {Array.from(groupedByIndustry.entries()).map(([industry, qs]) => (
        <IndustryGroup
          key={industry}
          industry={industry}
          questions={qs}
          snapshotByQuestionId={snapshotByQuestionId}
        />
      ))}
    </div>
  )
}

// ─── Industry group ──────────────────────────────────────────────────────────

function IndustryGroup({
  industry,
  questions,
  snapshotByQuestionId,
}: {
  industry: string
  questions: Question[]
  snapshotByQuestionId: Map<string, Snapshot>
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-black/10 bg-white shadow-sm">
      <div className="border-b border-black/10 px-4 py-3">
        <h3 className="font-display text-sm font-bold text-me-charcoal">{INDUSTRY_LABELS[industry] ?? industry}</h3>
        <p className="mt-0.5 text-xs font-semibold text-me-charcoal/45">{questions.length} 题</p>
      </div>
      <div className="divide-y divide-black/5">
        {questions.map(q => (
          <QuestionRow key={q.id} question={q} snapshot={snapshotByQuestionId.get(q.id)} />
        ))}
      </div>
    </div>
  )
}

// ─── Question row ────────────────────────────────────────────────────────────

function QuestionRow({ question, snapshot }: { question: Question; snapshot?: Snapshot }) {
  const [expanded, setExpanded] = useState(false)

  const country = question.country?.toUpperCase() ?? '—'
  const langLabel = question.language === 'zh' ? '中文' : 'EN'

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
            <span className="rounded-full bg-me-charcoal/10 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-me-charcoal/65">{question.intent_layer}</span>
            {question.locked_at && (
              <span className="rounded-full bg-status-track/15 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-status-track">🔒 LOCKED</span>
            )}
          </div>
          <p className="mt-1 text-sm font-semibold text-me-charcoal">{question.question_text}</p>
          {snapshot?.top3_brands && snapshot.top3_brands.length > 0 && (
            <p className="mt-1 text-xs font-semibold text-me-charcoal/55">
              <span className="text-me-ochre">ChatGPT Top 3:</span> {snapshot.top3_brands.join(' · ')}
            </p>
          )}
          {snapshot && !snapshot.brands_mentioned?.length && !snapshot.error_message && (
            <p className="mt-1 text-xs font-semibold text-me-charcoal/45 italic">尚无识别到品牌</p>
          )}
          {snapshot?.error_message && (
            <p className="mt-1 text-xs font-semibold text-status-rej">采集失败：{snapshot.error_message}</p>
          )}
          {!snapshot && (
            <p className="mt-1 text-xs font-semibold text-me-charcoal/45">尚未采集</p>
          )}
        </div>
        <button className="text-xs font-black text-me-ochre">{expanded ? '收起' : '展开'}</button>
      </div>

      {expanded && snapshot && (
        <div className="mt-3 space-y-2 rounded-lg bg-me-ivory px-3 py-2 text-xs">
          <p className="font-black uppercase tracking-wide text-me-charcoal/45">最新 ChatGPT 答案 · {snapshot.collected_at?.slice(0, 10)}</p>
          {snapshot.ai_answer_text && (
            <pre className="whitespace-pre-wrap font-sans text-me-charcoal/85">{snapshot.ai_answer_text}</pre>
          )}
          {snapshot.brands_mentioned && snapshot.brands_mentioned.length > 0 && (
            <div>
              <p className="mt-2 font-black uppercase tracking-wide text-me-charcoal/45">全部品牌</p>
              <p className="font-semibold text-me-charcoal/85">{snapshot.brands_mentioned.join(' · ')}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
