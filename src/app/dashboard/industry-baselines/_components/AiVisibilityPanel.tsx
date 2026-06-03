/**
 * Industry AI Visibility Panel — shown under the "AI 可见度" tab.
 *
 * Filters: industry / country / city / language (all dropdowns).
 * Each question row can be expanded to show its full historical
 * snapshots, oldest to newest, so PM can see "who got recommended last
 * week vs this week" — the core time-series value of the archive.
 */

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

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
  collected_date:      string   // YYYY-MM-DD, UTC — primary time axis
  week_of:             string   // kept for legacy weekly rollups
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

const COUNTRY_LABELS: Record<string, string> = {
  nz: '🇳🇿 New Zealand',
  au: '🇦🇺 Australia',
}

const CITY_LABELS: Record<string, string> = {
  auckland:     'Auckland',
  wellington:   'Wellington',
  christchurch: 'Christchurch',
  queenstown:   'Queenstown',
  sydney:       'Sydney',
  melbourne:    'Melbourne',
  brisbane:     'Brisbane',
  perth:        'Perth',
  adelaide:     'Adelaide',
  'gold-coast': 'Gold Coast',
  gold_coast:   'Gold Coast',
}

const LANG_LABELS: Record<string, string> = {
  en: 'English',
  zh: '中文',
}

export function AiVisibilityPanel() {
  const [questions, setQuestions] = useState<Question[]>([])
  const [latestSnapshots, setLatestSnapshots] = useState<Snapshot[]>([])
  const [loading, setLoading]       = useState(true)
  const [collecting, setCollecting] = useState(false)
  const [collectMsg, setCollectMsg] = useState('')

  // Filter state
  const [industryFilter, setIndustryFilter] = useState<string>('all')
  const [countryFilter,  setCountryFilter]  = useState<string>('all')
  const [cityFilter,     setCityFilter]     = useState<string>('all')
  const [languageFilter, setLanguageFilter] = useState<string>('all')

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [qRes, sRes] = await Promise.all([
        fetch('/api/baselines/ai-questions'),
        fetch('/api/baselines/ai-snapshots?days=30&latest_only=true&platform=chatgpt'),
      ])
      if (qRes.ok) {
        const j = await qRes.json() as { questions: Question[] }
        setQuestions(j.questions ?? [])
      }
      if (sRes.ok) {
        const j = await sRes.json() as { snapshots: Snapshot[] }
        setLatestSnapshots(j.snapshots ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  const handleCollect = async () => {
    if (!confirm('立即触发一次采集？将对所有 active 问题调用 ChatGPT + DataForSEO，大约 1-3 分钟。')) return
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

  // ── Filter option lists (derived from questions, not hardcoded) ─────────
  // City list depends on current country filter — only show cities that
  // have at least one question in the selected country.
  const availableCountries = useMemo(() => {
    const set = new Set<string>()
    for (const q of questions) if (q.country) set.add(q.country)
    return Array.from(set).sort()
  }, [questions])

  const availableCities = useMemo(() => {
    const set = new Set<string>()
    for (const q of questions) {
      if (q.city && (countryFilter === 'all' || q.country === countryFilter)) {
        set.add(q.city)
      }
    }
    return Array.from(set).sort()
  }, [questions, countryFilter])

  const availableLanguages = useMemo(() => {
    const set = new Set<string>()
    for (const q of questions) set.add(q.language)
    return Array.from(set).sort()
  }, [questions])

  // ── Apply all 4 filters ───────────────────────────────────────────────
  const filteredQuestions = useMemo(() => questions.filter(q => {
    if (industryFilter !== 'all' && q.industry_code !== industryFilter) return false
    if (countryFilter  !== 'all' && q.country       !== countryFilter)  return false
    if (cityFilter     !== 'all' && q.city          !== cityFilter)     return false
    if (languageFilter !== 'all' && q.language      !== languageFilter) return false
    return true
  }), [questions, industryFilter, countryFilter, cityFilter, languageFilter])

  const snapshotByQuestionId = useMemo(
    () => new Map(latestSnapshots.map(s => [s.question_id, s])),
    [latestSnapshots],
  )

  // Group by industry
  const groupedByIndustry = useMemo(() => {
    const map = new Map<string, Question[]>()
    for (const q of filteredQuestions) {
      const arr = map.get(q.industry_code) ?? []
      arr.push(q)
      map.set(q.industry_code, arr)
    }
    return map
  }, [filteredQuestions])

  const resetFilters = () => {
    setIndustryFilter('all')
    setCountryFilter('all')
    setCityFilter('all')
    setLanguageFilter('all')
  }

  return (
    <div className="space-y-4">
      {/* Info banner */}
      <div className="space-y-1 rounded-xl border border-me-ochre/30 bg-me-ochre/10 px-4 py-3 text-xs font-semibold text-me-charcoal/80">
        <p><strong className="font-black text-me-charcoal">行业 AI 可见度时序档案 · 日级采集。</strong>每天追踪 ChatGPT + Google AI Overview + Google SERP 对每个行业问题的回答，记录哪些品牌被推荐、排名每日变化。数据进入飞轮归因分析。</p>
        <p>问题一旦开始采集，<strong>question_text 永久锁定</strong>（保证时序连续性）。点击「展开历史」可查看该题最近 30 天每日快照按日倒序。</p>
      </div>

      {/* Toolbar: filters + collect */}
      <div className="space-y-3 rounded-xl border border-black/10 bg-white px-4 py-3">
        <div className="flex flex-wrap items-end gap-3">
          <Filter
            label="行业"
            value={industryFilter}
            onChange={setIndustryFilter}
            options={[
              { value: 'all', label: '全部' },
              ...Object.entries(INDUSTRY_LABELS).map(([v, l]) => ({ value: v, label: l })),
            ]}
          />
          <Filter
            label="国家"
            value={countryFilter}
            onChange={v => {
              setCountryFilter(v)
              // If current city no longer matches selected country, reset it
              if (v !== 'all' && cityFilter !== 'all') {
                const cityStillValid = questions.some(q => q.country === v && q.city === cityFilter)
                if (!cityStillValid) setCityFilter('all')
              }
            }}
            options={[
              { value: 'all', label: '全部' },
              ...availableCountries.map(c => ({ value: c, label: COUNTRY_LABELS[c] ?? c.toUpperCase() })),
            ]}
          />
          <Filter
            label="城市"
            value={cityFilter}
            onChange={setCityFilter}
            options={[
              { value: 'all', label: availableCities.length === 0 ? '（暂无 city 题）' : '全部' },
              ...availableCities.map(c => ({ value: c, label: CITY_LABELS[c] ?? c })),
            ]}
            disabled={availableCities.length === 0}
          />
          <Filter
            label="语言"
            value={languageFilter}
            onChange={setLanguageFilter}
            options={[
              { value: 'all', label: '全部' },
              ...availableLanguages.map(l => ({ value: l, label: LANG_LABELS[l] ?? l })),
            ]}
          />
          <button
            onClick={resetFilters}
            className="rounded-md border border-black/15 px-3 py-1.5 text-xs font-bold text-me-charcoal/65 transition-colors hover:border-black/25 hover:text-me-charcoal"
          >
            重置
          </button>
          <span className="ml-2 text-xs font-semibold text-me-charcoal/55">{filteredQuestions.length} / {questions.length} 题</span>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-black/5 pt-2">
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
          {questions.length === 0 ? '暂无问题。请先通过 API 或种子脚本添加问题。' : '当前筛选无匹配问题。'}
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

// ─── Filter dropdown ─────────────────────────────────────────────────────────

function Filter({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
  disabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-black uppercase tracking-wide text-me-charcoal/55">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="min-w-[140px] rounded-md border border-black/15 bg-white px-3 py-1.5 text-xs font-bold text-me-charcoal focus:border-me-ochre focus:outline-none disabled:opacity-40"
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
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

// ─── Question row with history ───────────────────────────────────────────────

function QuestionRow({ question, snapshot }: { question: Question; snapshot?: Snapshot }) {
  const [expanded, setExpanded]   = useState(false)
  const [history,  setHistory]    = useState<Snapshot[] | null>(null)
  const [histLoading, setHistLoading] = useState(false)

  const country = question.country?.toUpperCase() ?? '—'
  const langLabel = question.language === 'zh' ? '中文' : 'EN'

  const handleToggle = async () => {
    const next = !expanded
    setExpanded(next)
    if (next && history === null) {
      setHistLoading(true)
      try {
        // Pull ALL platforms for this question, last 30 days (daily granularity)
        const res = await fetch(`/api/baselines/ai-snapshots?question_id=${question.id}&days=30`)
        if (res.ok) {
          const j = await res.json() as { snapshots: Snapshot[] }
          setHistory(j.snapshots ?? [])
        } else {
          setHistory([])
        }
      } finally {
        setHistLoading(false)
      }
    }
  }

  // Group history rows by collected_date, then by platform — each "day card"
  // shows all platforms collected that day side by side
  const historyByDay = useMemo(() => {
    if (!history) return []
    const map = new Map<string, Snapshot[]>()
    for (const s of history) {
      const arr = map.get(s.collected_date) ?? []
      arr.push(s)
      map.set(s.collected_date, arr)
    }
    return Array.from(map.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))  // newest first
  }, [history])

  return (
    <div className="px-4 py-3">
      <div
        className="flex cursor-pointer items-start justify-between gap-4"
        onClick={handleToggle}
      >
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-me-charcoal/10 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-me-charcoal/65">{country}</span>
            <span className="rounded-full bg-me-charcoal/10 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-me-charcoal/65">{langLabel}</span>
            {question.city && (
              <span className="rounded-full bg-me-ochre/15 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-me-ochre">{CITY_LABELS[question.city] ?? question.city}</span>
            )}
            <span className="rounded-full bg-me-charcoal/10 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-me-charcoal/65">{question.intent_layer}</span>
            {question.locked_at && (
              <span className="rounded-full bg-status-track/15 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-status-track">🔒 LOCKED</span>
            )}
          </div>
          <p className="mt-1 text-sm font-semibold text-me-charcoal">{question.question_text}</p>
          {snapshot?.top3_brands && snapshot.top3_brands.length > 0 && (
            <p className="mt-1 text-xs font-semibold text-me-charcoal/55">
              <span className="text-me-ochre">ChatGPT Top 3:</span> {snapshot.top3_brands.join(' · ')}
              <span className="ml-2 text-me-charcoal/45">· {snapshot.collected_date}</span>
            </p>
          )}
          {snapshot && !snapshot.brands_mentioned?.length && !snapshot.error_message && (
            <p className="mt-1 text-xs font-semibold text-me-charcoal/45 italic">尚无识别到品牌</p>
          )}
          {snapshot?.error_message && snapshot.error_code !== 'no_ai_overview' && (
            <p className="mt-1 text-xs font-semibold text-status-rej">采集失败：{snapshot.error_message}</p>
          )}
          {!snapshot && (
            <p className="mt-1 text-xs font-semibold text-me-charcoal/45">尚未采集</p>
          )}
        </div>
        <button className="text-xs font-black text-me-ochre">{expanded ? '收起' : '展开历史'}</button>
      </div>

      {expanded && (
        <div className="mt-3 space-y-3">
          {histLoading && (
            <p className="text-xs font-semibold text-me-charcoal/45">加载历史…</p>
          )}

          {!histLoading && history !== null && history.length === 0 && (
            <p className="text-xs font-semibold text-me-charcoal/45">尚无历史快照。</p>
          )}

          {!histLoading && historyByDay.map(([day, daySnaps]) => (
            <DayCard key={day} day={day} snapshots={daySnaps} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Daily history card (one per day, shows all platforms collected) ────────

const PLATFORM_LABELS_SHORT: Record<string, string> = {
  chatgpt:            'ChatGPT',
  google_ai_overview: 'Google AI',
  google_serp:        'Google SERP',
  xiaohongshu:        '小红书',
}

function DayCard({ day, snapshots }: { day: string; snapshots: Snapshot[] }) {
  const [showRaw, setShowRaw] = useState(false)

  // Sort platforms in a fixed order for stable display
  const ordered = ['chatgpt', 'google_ai_overview', 'google_serp', 'xiaohongshu']
    .map(p => snapshots.find(s => s.platform === p))
    .filter((s): s is Snapshot => Boolean(s))

  return (
    <div className="rounded-lg border border-black/5 bg-me-ivory px-3 py-2">
      <div className="flex items-center justify-between">
        <p className="font-black uppercase tracking-wide text-[10px] text-me-charcoal/55">
          {day}
        </p>
        <button
          onClick={() => setShowRaw(!showRaw)}
          className="text-[10px] font-black uppercase tracking-wide text-me-ochre"
        >
          {showRaw ? '隐藏全文' : '查看 AI 答案'}
        </button>
      </div>

      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
        {ordered.map(s => {
          // B-2 fix: distinguish "AI Overview block did not appear" from
          // "AI Overview appeared but no brand extracted". Previously both
          // showed as "无品牌", masking a real product signal.
          const isAiAbsent = s.error_code === 'no_ai_overview'
          const isRealError = s.error_message && !isAiAbsent
          return (
            <div key={s.id} className="rounded border border-black/5 bg-white px-2 py-1.5">
              <p className="text-[10px] font-black uppercase tracking-wide text-me-charcoal/45">
                {PLATFORM_LABELS_SHORT[s.platform] ?? s.platform}
              </p>
              {isRealError ? (
                <p className="mt-1 text-[11px] font-semibold text-status-rej">✗ {s.error_message}</p>
              ) : isAiAbsent ? (
                <p className="mt-1 text-[11px] font-semibold text-me-charcoal/45 italic">本题未出现 AI Overview</p>
              ) : s.top3_brands && s.top3_brands.length > 0 ? (
                <ol className="mt-1 list-decimal pl-4 text-[11px] font-semibold text-me-charcoal/85">
                  {s.top3_brands.map((b, i) => <li key={i} className="truncate">{b}</li>)}
                </ol>
              ) : (
                <p className="mt-1 text-[11px] font-semibold text-me-charcoal/45 italic">无品牌</p>
              )}
            </div>
          )
        })}
      </div>

      {showRaw && (
        <div className="mt-2 space-y-2">
          {ordered.map(s =>
            s.ai_answer_text ? (
              <div key={`raw-${s.id}`} className="rounded border border-black/5 bg-white px-2 py-1.5">
                <p className="text-[10px] font-black uppercase tracking-wide text-me-charcoal/45">
                  {PLATFORM_LABELS_SHORT[s.platform] ?? s.platform} · 全文
                </p>
                <pre className="mt-1 whitespace-pre-wrap font-sans text-[11px] text-me-charcoal/85">{s.ai_answer_text}</pre>
              </div>
            ) : null,
          )}
        </div>
      )}
    </div>
  )
}
