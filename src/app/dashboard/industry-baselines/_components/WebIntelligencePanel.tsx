'use client'

import { useEffect, useState } from 'react'
import type { CompetitionBrief as CompetitionBriefData } from '@/lib/web-intelligence/competition-brief'
import type { OperatingBrief, TourCatalogItem } from '@/lib/web-intelligence/operating-brief'
import { CompetitionBrief } from './CompetitionBrief'
import { matchChangedToursScope, projectTravelContent, travelMarketLabels, type TravelScopeMatch } from '@/lib/web-intelligence/profiles/travel'

type Settings = {
  enabled: boolean; entitled: boolean; entitlement_price: number
  entitlement_currency: 'NZD' | 'AUD' | 'USD' | null
  target_nzd: number; hard_stop_nzd: number; usd_to_nzd: number
  fx_as_of: string; actor_build: string; capture_limit_usd: number
  overhead_nzd: number; context: string
}
type Competitor = {
  domain: string; tier: 'core' | 'secondary' | 'benchmark' | 'watch'
  status: 'active' | 'emerging' | 'archive'; sources: string[]; tags: string[]
  urls: string[]; interval_hours: number
}
type Evidence = { id: string; source_url: string; excerpt: string; observed_at: string; content_hash: string }
type Signal = {
  id: string; run_id: string; domain: string; kind: string; before_evidence_id: string | null
  after_evidence_id: string | null; interpretation_status: string
  classification: string | null; interpretation: { summary?: string; confidence?: number; evidence_ids?: string[] } | null
  recommended_action: string | null; created_at: string
}
type Run = {
  id: string; domain: string; url: string; status: string; provider_status: string | null
  error_code: string | null; created_at: string; capture_cost_usd: number | null
  interpretation_cost_usd: number | null; accounted_nzd: number | null; reserved_nzd: number
}
type Observation = { run_id: string; domain: string; url: string; observed_at: string }
type DiscoveredTour = { name: string; url: string; domain: string; listing_url: string; observed_at: string; detail_status?: 'not_started' | 'capturing' | 'ready' | 'stale' | 'failed'; detail_observed_at?: string | null }
type Payload = {
  client: { id: string; name: string }; settings: Settings | null; competitors: Competitor[]
  signals: Signal[]; evidence: Evidence[]; runs: Run[]; observations: Observation[]
  brief: CompetitionBriefData
  operating?: OperatingBrief
  discovered_tours?: DiscoveredTour[]
  budget: { accounted_nzd: number; reserved_nzd: number }; can_edit: boolean; can_run: boolean
}
type AnalysisTarget = { domain: string; url: string; tier: Competitor['tier'] }
type BatchTarget = AnalysisTarget & { request_id: string; status: 'pending' | 'queued' | 'failed' }
type ProductScope = CompetitionBriefData['product_scope']

function latestRunsForTargets(runs: Run[], targets: AnalysisTarget[]): Run[] {
  const targetKeys = new Set(targets.map(target => JSON.stringify([target.domain, target.url])))
  const latest = new Map<string, Run>()
  for (const run of [...runs].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))) {
    const key = JSON.stringify([run.domain, run.url])
    if (targetKeys.has(key) && !latest.has(key)) latest.set(key, run)
  }
  return [...latest.values()]
}
const field = 'mt-1 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm disabled:bg-black/5'
const button = 'rounded-lg bg-me-ochre px-3 py-2 text-sm font-bold text-white disabled:opacity-40'
const card = 'space-y-3 rounded-xl border border-black/10 bg-white p-4'
const sourceOptions = ['manual', 'google_serp', 'meta_ads', 'ai_visibility', 'me_discovery']
const defaults: Settings = {
  enabled: false, entitled: false, entitlement_price: 499, entitlement_currency: null,
  target_nzd: 30, hard_stop_nzd: 50, usd_to_nzd: 0, fx_as_of: '', actor_build: '',
  capture_limit_usd: 0, overhead_nzd: 0, context: '',
}
const money = (n: number | null | undefined) => n == null ? '—' : n.toFixed(2)
const date = (value: string) => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '时间未知' : new Intl.DateTimeFormat('zh-CN', { timeZone: 'Pacific/Auckland', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d) }
const split = (s: string) => s.split(/[\n,]/).map(v => v.trim()).filter(Boolean)
const pagePurpose = (raw: string) => {
  let path = ''
  try { path = new URL(raw).pathname.toLowerCase() } catch { return '业务页面' }
  if (path === '/') return '首页'
  if (/new-tours|(?:^|\/)tours\/?$|escorted-tours|private-tours/.test(path)) return '产品列表'
  if (/\/tours\/[^/]+/.test(path)) return '产品详情'
  if (/offer|deal|promotion|sale/.test(path)) return '优惠活动'
  return '业务页面'
}

const normaliseFact = (value: string) => value.toLowerCase().replace(/[*_`#>[\]()]/g, '').replace(/\s+/g, ' ').trim()
const factScore = (value: string) => {
  let score = 0
  if (/[$€£]\s?\d|\b(?:nzd|aud|usd)\s?\d/i.test(value)) score += 5
  if (/available|availability|sold out|spaces? left|in stock|out of stock|book now/i.test(value)) score += 4
  if (/sale|save|offer|discount|promotion|launch|earlybird|new /i.test(value)) score += 3
  if (/\b20\d{2}\b|departure|start date|end date/i.test(value)) score += 2
  if (/price|pricing|review|rating|product|service|package|tour|hiring|partner|technology/i.test(value)) score += 1
  return score
}
const facts = (value = '') => Array.from(new Map(value.split(/\n+/)
  .map(line => line.trim()).filter(line => line.length >= 6 && line.length <= 220)
  .map(line => [normaliseFact(line), line])).values())
const changedFacts = (from: Evidence | undefined, to: Evidence | undefined) => {
  const businessFacts = (value: string | undefined) => value ? projectTravelContent(value, 'product_listing') ?? value : ''
  const before = facts(businessFacts(from?.excerpt))
  const after = facts(businessFacts(to?.excerpt))
  const beforeSet = new Set(before.map(normaliseFact))
  const afterSet = new Set(after.map(normaliseFact))
  const select = (items: string[], seen: Set<string>) => items
    .filter(item => !seen.has(normaliseFact(item)))
    .map((text, order) => ({ text, order, score: factScore(text) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, 3).map(item => item.text)
  return { added: select(after, beforeSet), removed: select(before, afterSet) }
}
const factKinds = (value: string) => new Set([
  /[$€£]\s?\d|\b(?:nzd|aud|usd)\s?\d|价格|降价|涨价/i.test(value) && 'price',
  /available|availability|sold out|spaces? left|in stock|out of stock|余位|售罄/i.test(value) && 'availability',
  /sale|save|offer|discount|promotion|earlybird|优惠|促销/i.test(value) && 'promotion',
  /\b20\d{2}\b|departure|start date|end date|档期|出发日期/i.test(value) && 'schedule',
  /review|rating|评价|评分|口碑/i.test(value) && 'reputation',
  /product|service|package|tour|route|days|产品|线路|行程|天数|包含/i.test(value) && 'product',
  /hiring|vacancy|career|招聘|职位/i.test(value) && 'hiring',
  /executive|director|manager|高管|负责人/i.test(value) && 'people',
  /partner|partnership|合作|公益|charity|csr/i.test(value) && 'partnership',
  /technology|tracking|pixel|software|技术|像素/i.test(value) && 'technology',
].filter((kind): kind is string => Boolean(kind)))
const numericClaims = (value: string) => (value.match(/\d[\d,.]*/g) ?? []).map(item => item.replace(/,/g, '').replace(/\.$/, ''))
const productIdentity = (line: string) => line.match(/(?:^|[|;])\s*(?:tour|product)\s*:\s*([^|;]+)/i)?.[1]?.trim().toLowerCase() ?? null
const moneyFacts = (value: string) => value.split(/\n+/).flatMap(line => [...line.matchAll(/([$€£]|\b(?:nzd|aud|usd)\b)\s*([\d,]+(?:\.\d+)?)/gi)].map(match => ({
  currency: match[1].toUpperCase(), value: Number(match[2].replace(/,/g, '')),
  product: productIdentity(line),
}))).filter(item => Number.isFinite(item.value))
const sameProduct = (before: { product: string | null }, after: { product: string | null }) => before.product !== null && before.product === after.product
const claimDetailsVerified = (summary: string, added: string[], removed: string[]) => {
  const difference = [...added, ...removed].join('\n')
  const direction = /降价|下跌|下降|下调|调低|降幅|减少|price (?:drop|cut|decrease)|cheaper/i.test(summary) ? 'down'
    : /涨价|提价|上涨|上升|上调|调高|涨幅|增加|price (?:rise|increase)|more expensive/i.test(summary) ? 'up' : null
  const summaryHasPrice = factKinds(summary).has('price')
  if (!summaryHasPrice) return numericClaims(summary).every(claim => numericClaims(difference).includes(claim))
  const oldPrices = moneyFacts(removed.join('\n'))
  const newPrices = moneyFacts(added.join('\n'))
  if (oldPrices.length !== 1 || newPrices.length !== 1) return false
  const [oldPrice] = oldPrices; const [newPrice] = newPrices
  if (oldPrice.currency !== newPrice.currency || !sameProduct(oldPrice, newPrice)) return false
  const priceDelta = Math.abs(newPrice.value - oldPrice.value)
  const summaryPrices = moneyFacts(summary)
  if (summaryPrices.some(claim => claim.currency !== oldPrice.currency || ![oldPrice.value, newPrice.value, priceDelta].includes(claim.value))) return false
  if (summaryPrices.length === 0 && numericClaims(summary).length > 0) return false
  const summaryWithoutMoney = summary.replace(/([$€£]|\b(?:nzd|aud|usd)\b)\s*[\d,]+(?:\.\d+)?/gi, '')
  if (!numericClaims(summaryWithoutMoney).every(claim => numericClaims(difference).includes(claim))) return false
  const moneyMentions = [...summary.matchAll(/([$€£]|\b(?:nzd|aud|usd)\b)\s*([\d,]+(?:\.\d+)?)/gi)]
  if (summaryPrices.length >= 2) {
    if (summaryPrices[0].value !== oldPrice.value || summaryPrices[1].value !== newPrice.value) return false
    const firstStart = moneyMentions[0].index ?? 0
    const firstEnd = firstStart + moneyMentions[0][0].length
    const secondStart = moneyMentions[1].index ?? firstEnd
    const prefix = summary.slice(Math.max(0, firstStart - 12), firstStart)
    const transition = summary.slice(firstEnd, secondStart)
    if (!/(?:从|由|from)\s*$/i.test(prefix) || !/(?:至|到|调整为|变为|to)/i.test(transition)) return false
    if (summaryPrices.slice(2).some((claim, offset) => {
      const mention = moneyMentions[offset + 2]
      const mentionStart = mention.index ?? 0
      const amountPrefix = summary.slice(Math.max(0, mentionStart - 16), mentionStart)
      return claim.value !== priceDelta || !/(?:涨幅|降幅|上涨|下跌|增加|减少|上调|下调|涨价|降价)(?:了|约|近|达)?\s*$/i.test(amountPrefix)
    })) return false
  }
  if (summaryPrices.length === 1) {
    const [claim] = summaryPrices
    const mentionStart = moneyMentions[0].index ?? 0
    const amountPrefix = summary.slice(Math.max(0, mentionStart - 16), mentionStart)
    const amountMeansCurrentPrice = /(?:至|到|调整为|现价|当前价格|价格为)\s*(?:[$€£]|\b(?:nzd|aud|usd)\b)/i.test(summary)
    const amountMeansDelta = /(?:涨幅|降幅|上涨|下跌|增加|减少|上调|下调|涨价|降价)(?:了|约|近|达)?\s*$/i.test(amountPrefix)
    if (amountMeansCurrentPrice ? claim.value !== newPrice.value : !amountMeansDelta || claim.value !== priceDelta) return false
  }
  if (direction === 'down') return oldPrice.value > newPrice.value
  if (direction === 'up') return oldPrice.value < newPrice.value
  return true
}
const isBaselineReset = (signal: Signal) => /采集器|采集方式|完整读取|新基线|无法证明/.test(signal.interpretation?.summary ?? '')
const isFreshAt = (observedAt: string, asOf: string) => {
  const age = Date.parse(asOf) - Date.parse(observedAt)
  return Number.isFinite(age) && age >= -DAY && age <= 8 * DAY
}
async function request<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(url, { method, cache: 'no-store', ...(body === undefined ? {} : {
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) })
  const data = await res.json()
  if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `Request failed (${res.status})`)
  return data as T
}

export function WebIntelligencePanel() {
  const [clients, setClients] = useState<{ id: string; name: string }[]>([])
  const [clientId, setClientId] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let alive = true
    request<{ clients: { id: string; name: string }[] }>('/api/clients')
      .then(data => { if (alive) setClients(data.clients) })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Unable to load clients') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])
  return <section className="space-y-4 text-me-charcoal" aria-label="Web intelligence">
    <p className="text-sm">关注竞品发生了什么、意味着什么，以及是否值得回应。</p>
    <label className="block max-w-md text-sm font-bold">客户
      <select className={field} value={clientId} onChange={e => setClientId(e.target.value)} disabled={loading}>
        <option value="">{loading ? '正在加载客户…' : '选择客户'}</option>
        {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </label>
    {error && <p role="alert" className="text-status-rej">{error}</p>}
    {!loading && !error && clients.length === 0 && <p>暂无可访问的客户。</p>}
    {clientId && <ClientIntelligence key={clientId} clientId={clientId} />}
  </section>
}

function ClientIntelligence({ clientId }: { clientId: string }) {
  const [data, setData] = useState<Payload | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [revision, setRevision] = useState(0)
  const [batch, setBatch] = useState<BatchTarget[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const endpoint = `/api/clients/${encodeURIComponent(clientId)}/web-intelligence`
  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    request<Payload>(endpoint).then(value => { if (alive) { setData(value); setRevision(n => n + 1) } })
      .catch(() => { if (alive) setError('未能读取最新情报，请重试。') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [endpoint, refresh])
  const reload = () => setRefresh(n => n + 1)
  const monitored = data?.competitors.filter(c => c.status !== 'archive' && c.urls.length).length ?? 0
  const targets = data?.competitors
    .filter(c => c.status !== 'archive')
    .flatMap(c => c.urls.map(url => ({ domain: c.domain, url, tier: c.tier }))) ?? []
  const hasRunningTarget = latestRunsForTargets(data?.runs ?? [], targets).some(run => !['complete', 'failed', 'reconciliation'].includes(run.status))
  useEffect(() => {
    if (!hasRunningTarget) return
    const timer = window.setTimeout(reload, 8000)
    return () => window.clearTimeout(timer)
  }, [hasRunningTarget, refresh])
  return <div className="space-y-5">
    {loading && <p role="status" className="text-sm">正在更新情报…</p>}
    {error && <p role="alert" className="text-status-rej">{error}</p>}
    {error && !data && <button className={button} onClick={reload} disabled={loading}>重新读取</button>}
    {data && <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-me-ivory p-4">
        <div><h2 className="font-bold">{data.client.name} · 竞争监控</h2><p className="mt-1 text-sm">{monitored} 家竞品 · {targets.length} 个监控页面 · 本月已用 NZ${money(data.budget.accounted_nzd)}</p></div>
        <button className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm disabled:opacity-40" onClick={reload} disabled={loading}>刷新结果</button>
      </div>
      <MonitoringOverview targets={targets} runs={data.runs} observations={data.observations ?? []} batch={batch} />
      <Signals signals={data.signals} evidence={data.evidence} runs={data.runs} targets={targets} batch={batch} asOf={data.brief.as_of} clientName={data.client.name} productScope={data.brief.product_scope} />
      <details className="rounded-xl border border-black/10 bg-white p-4">
        <summary className="cursor-pointer text-sm font-bold">查看完整产品盘面与数据限制</summary>
        <div className="mt-4 space-y-5">
          <TourCatalog tours={data.operating?.tour_catalog ?? []} />
          <DiscoveredTourLinks tours={data.discovered_tours ?? []} />
          <CompetitionBrief brief={data.brief} />
        </div>
      </details>
      <details className="rounded-xl border border-black/10 bg-white p-4">
        <summary className="cursor-pointer text-sm font-bold">重新采集与系统运行说明</summary>
        <div className="mt-4"><AnalysisLauncher targets={targets} endpoint={endpoint} canRun={data.can_run} batch={batch} setBatch={setBatch} onProgress={reload} /></div>
      </details>
      <details className="rounded-xl border border-black/10 bg-white p-4">
        <summary className="cursor-pointer text-sm font-bold">管理监控范围</summary>
        <div className="mt-4 space-y-3">
          <p className="text-sm text-me-charcoal/70">沿用已有竞品名单。业务页面用于分析产品、价格、促销和余位。</p>
          {!data.can_run && <p className="text-sm">该客户尚未开放分析，请检查资格与预算设置。</p>}
          {data.competitors.length === 0 && <p>尚未找到已有竞品。</p>}
          {data.competitors.map(c => <details key={c.domain} className="rounded-xl border border-black/10 p-4">
            <summary className="cursor-pointer break-all text-sm"><strong>{c.domain}</strong><span className="ml-3 text-me-charcoal/60">{c.status === 'archive' ? '已归档' : c.urls.length ? `${c.urls.length} 个页面` : '尚未配置页面'}</span></summary>
            <div className="mt-4"><CompetitorCard key={`${c.domain}-${revision}`} competitor={c} clientId={clientId} endpoint={endpoint} canEdit={data.can_edit} canRun={data.can_run} onSaved={reload} /></div>
          </details>)}
        </div>
      </details>
      <details className="rounded-xl border border-black/10 bg-white p-4">
        <summary className="cursor-pointer text-sm font-bold">成本、运行记录与证据</summary>
        <div className="mt-4 space-y-5">
          <p className="text-sm">月度目标 NZ${money(data.settings?.target_nzd ?? 30)} · 停止上限 NZ${money(data.settings?.hard_stop_nzd ?? 50)}{data.budget.reserved_nzd > 0 && ` · 待结算 NZ$${money(data.budget.reserved_nzd)}`}。</p>
          <Runs runs={data.runs} signals={data.signals} observations={data.observations ?? []} />
          <SettingsForm key={`settings-${revision}`} settings={data.settings} canEdit={data.can_edit} endpoint={endpoint} onSaved={reload} />
        </div>
      </details>
    </>}
  </div>
}

function DiscoveredTourLinks({ tours }: { tours: DiscoveredTour[] }) {
  if (tours.length === 0) return null
  const status = (value: DiscoveredTour['detail_status']) => value === 'ready'
    ? { label: '详情已读取', style: 'bg-green-50 text-green-800' }
    : value === 'capturing'
      ? { label: '正在读取详情', style: 'bg-amber-50 text-amber-800' }
      : value === 'failed'
        ? { label: '详情读取失败', style: 'bg-red-50 text-red-800' }
        : value === 'stale'
          ? { label: '详情已过期', style: 'bg-amber-50 text-amber-800' }
          : { label: '等待读取详情', style: 'bg-black/5 text-me-charcoal/60' }
  return <section className="space-y-3" aria-label="已发现的 Tour 详情页">
    <div><p className="text-xs font-bold tracking-wide text-me-charcoal/55">详情页发现</p><h3 className="mt-1 text-lg font-bold">已发现 {tours.length} 个 Tour detail 页面</h3><p className="mt-1 text-sm text-me-charcoal/65">链接来自最近一次有效的产品列表页。每个详情页的读取状态和最近观察时间单独显示。</p></div>
    <div className="divide-y divide-black/5 rounded-xl border border-black/10 bg-white px-4">{tours.map((tour, index) => { const badge = status(tour.detail_status); return <div className="flex flex-wrap items-center justify-between gap-3 py-3" key={`${tour.url}-${index}`}><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-bold">{tour.name}</p><span className={`rounded-full px-2 py-1 text-[11px] font-bold ${badge.style}`}>{badge.label}</span></div><p className="break-all text-xs text-me-charcoal/55">{tour.domain} · 从列表页发现于 {date(tour.observed_at)} NZ{tour.detail_observed_at ? ` · 详情观察于 ${date(tour.detail_observed_at)} NZ` : ''}</p></div><a className="shrink-0 rounded-lg border border-black/15 px-3 py-2 text-xs font-bold underline" href={tour.url} target="_blank" rel="noopener noreferrer">打开详情页</a></div> })}</div>
  </section>
}

function TourCatalog({ tours }: { tours: TourCatalogItem[] }) {
  if (tours.length === 0) return <section className="rounded-xl border border-black/10 bg-me-ivory p-4" aria-label="Tour 明细"><h3 className="font-bold">逐个 Tour 查看</h3><p className="mt-2 text-sm text-me-charcoal/65">当前有效快照中还没有识别出可单独展示的 Tour。</p></section>
  return <section className="space-y-3" aria-label="Tour 明细">
    <div><p className="text-xs font-bold tracking-wide text-me-charcoal/55">产品明细</p><h3 className="mt-1 text-lg font-bold">逐个 Tour 查看 · {tours.length} 条</h3><p className="mt-1 text-sm text-me-charcoal/65">以下是最近一次有效网页快照识别出的字段。它表示竞品页面公开展示的内容，不代表客户真实访问量。</p></div>
    <div className="grid gap-3 lg:grid-cols-2">
      {tours.map((item, index) => <article className="rounded-xl border border-black/10 bg-white p-4" key={`${item.domain}-${item.record.name}-${item.source_url}-${index}`}>
        <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-bold text-me-charcoal/55">{item.domain}</p><h4 className="mt-1 text-base font-black">{item.record.name}</h4></div><span className="rounded-full bg-green-50 px-2 py-1 text-[11px] font-bold text-green-800">已读取</span></div>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <TourField label="总天数" value={`${item.record.durationDays} 天`} />
          <TourField label="价格" value={item.record.price} />
          <TourField label="促销" value={item.record.promotion} />
          <TourField label="评价" value={item.record.reviews} />
          <TourField label="路线摘要" value={item.record.route} wide />
          <TourField label="包含项目" value={item.record.includes} wide />
          <TourField label="逐日行程" value={item.record.itinerary?.length ? `${item.record.itinerary.length} 个行程日已读取` : '来源页面未提供逐日安排'} wide muted />
        </dl>
        {item.record.itinerary?.length ? <details className="mt-3 rounded-lg bg-me-ivory p-3"><summary className="cursor-pointer text-sm font-bold">展开逐日行程</summary><ol className="mt-3 space-y-2 text-sm leading-6">{item.record.itinerary.map((day, dayIndex) => <li key={`${day}-${dayIndex}`}><span className="mr-2 font-bold text-me-ochre">{dayIndex + 1}.</span>{day}</li>)}</ol></details> : null}
        <div className="mt-4 border-t border-black/5 pt-3 text-xs leading-5 text-me-charcoal/55"><p>观察于 {item.observed_at ? date(item.observed_at) : '时间未知'} NZ</p><a className="break-all underline" href={item.source_url} target="_blank" rel="noopener noreferrer">打开来源页面</a></div>
      </article>)}
    </div>
  </section>
}

function TourField({ label, value, wide = false, muted = false }: { label: string; value: string; wide?: boolean; muted?: boolean }) {
  return <div className={wide ? 'col-span-2' : ''}><dt className="text-xs font-bold text-me-charcoal/55">{label}</dt><dd className={`mt-1 break-words leading-5 ${muted ? 'text-me-charcoal/50' : ''}`}>{value || '页面未提供'}</dd></div>
}

function MonitoringOverview({ targets, runs, observations, batch }: { targets: AnalysisTarget[]; runs: Run[]; observations: Observation[]; batch: BatchTarget[] }) {
  const latestRuns = latestRunsForTargets(runs, targets)
  const finished = latestRuns.filter(run => run.status === 'complete').length
  const running = latestRuns.some(run => !['complete', 'failed', 'reconciliation'].includes(run.status))
  const failed = latestRuns.filter(run => ['failed', 'reconciliation'].includes(run.status)).length + batch.filter(item => item.status === 'failed').length
  const latestObserved = observations.map(item => Date.parse(item.observed_at)).filter(Number.isFinite).sort((a, b) => b - a)[0]
  const status = running ? '正在更新' : failed > 0 ? '部分页面未完成' : finished === targets.length && targets.length > 0 ? '已完成更新' : '等待首次采集'
  const statusStyle = running || failed > 0 ? 'bg-amber-50 text-amber-900' : status === '已完成更新' ? 'bg-green-50 text-green-900' : 'bg-black/5 text-me-charcoal/70'
  return <section className="rounded-2xl border border-black/10 bg-white p-5" aria-label="监控概览">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold tracking-wide text-me-charcoal/55">监控概览</p><h2 className="mt-1 text-xl font-black">这周有没有需要你关注的竞争变化？</h2><p className="mt-1 text-sm text-me-charcoal/65">ME 只读取公开页面，发现可靠变化后提醒你人工核对；不会自动改价或发布内容。</p></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${statusStyle}`}>{status}</span></div>
    <div className="mt-5 grid gap-3 sm:grid-cols-3">
      <div className="rounded-xl bg-me-ivory p-4"><p className="text-xs text-me-charcoal/60">监控覆盖</p><p className="mt-1 text-2xl font-black">{finished}<span className="text-base font-bold text-me-charcoal/45"> / {targets.length}</span></p><p className="mt-1 text-xs text-me-charcoal/60">个页面已完成最近一次读取</p></div>
      <div className="rounded-xl bg-me-ivory p-4"><p className="text-xs text-me-charcoal/60">最近观察</p><p className="mt-1 text-lg font-black">{latestObserved ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Pacific/Auckland', month: 'short', day: 'numeric' }).format(new Date(latestObserved)) : '尚未采集'}</p><p className="mt-1 text-xs text-me-charcoal/60">以来源页面实际观察时间为准</p></div>
      <div className="rounded-xl bg-me-ivory p-4"><p className="text-xs text-me-charcoal/60">当前结论</p><p className="mt-1 text-lg font-black">{running ? '等待分析' : failed > 0 ? '需要补采' : finished === 0 ? '尚无结论' : '查看下方变化'}</p><p className="mt-1 text-xs text-me-charcoal/60">没有可靠变化也会明确告诉你</p></div>
    </div>
  </section>
}

function AnalysisLauncher({ targets, endpoint, canRun, batch, setBatch, onProgress }: { targets: AnalysisTarget[]; endpoint: string; canRun: boolean; batch: BatchTarget[]; setBatch: (batch: BatchTarget[]) => void; onProgress: () => void }) {
  const [busy, setBusy] = useState(false)
  const ordered = [...targets].sort((a, b) => Number(b.tier === 'core') - Number(a.tier === 'core'))
  const queued = batch.filter(target => target.status === 'queued').length
  const failed = batch.filter(target => target.status === 'failed').length
  async function analyse() {
    setBusy(true)
    const resumesPartialBatch = batch.some(target => target.status !== 'queued')
    let work = resumesPartialBatch ? batch : ordered.map(target => ({ ...target, request_id: crypto.randomUUID(), status: 'pending' as const }))
    setBatch(work)
    for (const target of work.filter(item => item.status !== 'queued')) {
      try {
        const receipt = await request<{ request_id: string }>(endpoint, 'POST', { domain: target.domain, url: target.url, request_id: target.request_id })
        work = work.map(item => item.request_id === target.request_id ? { ...item, request_id: receipt.request_id, status: 'queued' as const } : item)
        setBatch(work); onProgress()
      } catch {
        work = work.map(item => item.request_id === target.request_id ? { ...item, status: 'failed' as const } : item)
        setBatch(work)
        break
      }
    }
    setBusy(false)
    ;[3000, 9000, 18000].forEach(delay => window.setTimeout(onProgress, delay))
  }
  const label = busy ? '正在启动分析…' : failed ? '继续未完成页面' : batch.length && queued === batch.length ? '开始新一轮竞争分析' : '开始竞争分析'
  return <section className="rounded-2xl border border-me-ochre/30 bg-gradient-to-br from-me-ochre/10 to-white p-5">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><h3 className="text-xl font-bold">让 ME 分析竞争变化</h3><p className="mt-1 text-sm text-me-charcoal/70">自动读取已配置业务页面，识别变化、衡量影响并给出下一步建议，不自动采取行动。</p><p className="mt-2 text-xs font-bold text-me-charcoal/55">本次将分析 {new Set(targets.map(target => target.domain)).size} 家竞品、{targets.length} 个页面</p></div>
      <button className={`${button} px-5 py-3`} disabled={busy || !canRun || targets.length === 0} onClick={() => void analyse()}>{label}</button>
    </div>
    {targets.length === 0 && <p className="mt-3 text-sm text-status-rej">尚未配置业务页面，请展开“管理监控范围”添加页面。</p>}
    {batch.length > 0 && <p className="mt-3 text-sm" role="status">本批次：{queued}/{batch.length} 个页面已开始{failed ? `，${failed} 个页面未能启动，其余页面已暂停。` : '。分析完成后结果会自动刷新。'}</p>}
  </section>
}

function SettingsForm({ settings, canEdit, endpoint, onSaved }: { settings: Settings | null; canEdit: boolean; endpoint: string; onSaved: () => void }) {
  const [draft, setDraft] = useState<Settings>(settings ?? defaults)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft(d => ({ ...d, [key]: value }))
  async function save(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('')
    try { await request(endpoint, 'PATCH', { settings: draft }); onSaved() }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to save settings') }
    finally { setSaving(false) }
  }
  return <form className={card} onSubmit={save}>
    <h2 className="text-lg font-bold">监控设置</h2>
    {!settings && <p className="text-sm">尚未配置。请先确认监控资格、币种和费用上限，再开启监控。</p>}
    <fieldset disabled={!canEdit || saving} className="space-y-3">
      <div className="flex flex-wrap gap-4">
        <label><input type="checkbox" checked={draft.enabled} onChange={e => set('enabled', e.target.checked)} /> 开启监控</label>
        <label><input type="checkbox" checked={draft.entitled} onChange={e => set('entitled', e.target.checked)} /> 已具备高级会员资格</label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm">会员月费预留<input className={field} value="499" readOnly /></label>
        <label className="text-sm">会员币种<select className={field} value={draft.entitlement_currency ?? ''} onChange={e => set('entitlement_currency', (e.target.value || null) as Settings['entitlement_currency'])}><option value="">未确认</option>{['NZD', 'AUD', 'USD'].map(v => <option key={v}>{v}</option>)}</select></label>
        {([
          ['target_nzd', '月度费用目标（NZD）', 0.01, 30], ['hard_stop_nzd', '月度停止上限（NZD）', 0.01, 50],
          ['usd_to_nzd', '美元兑纽币汇率', 0.0001, 9.9999], ['capture_limit_usd', '单次采集上限（USD）', 0.01, 1],
          ['overhead_nzd', '单次间接成本（NZD）', 0.02, 1],
        ] as const).map(([key, label, min, max]) => <label key={key} className="text-sm">{label}<input className={field} type="number" min={min} max={max} step="any" required value={draft[key]} onChange={e => set(key, Number(e.target.value))} /></label>)}
        <label className="text-sm">汇率日期<input className={field} type="date" required value={draft.fx_as_of} onChange={e => set('fx_as_of', e.target.value)} /></label>
        <label className="text-sm">采集器版本<input className={field} required pattern="[0-9]+\.[0-9]+\.[0-9]+" placeholder="0.0.1" value={draft.actor_build} onChange={e => set('actor_build', e.target.value)} /></label>
      </div>
      <label className="block text-sm">客户分析背景<textarea className={field} rows={3} maxLength={2000} value={draft.context} onChange={e => set('context', e.target.value)} /></label>
      {canEdit && <button className={button} type="submit">{saving ? '保存中…' : '保存设置'}</button>}
    </fieldset>
    {!canEdit && <p className="text-sm">你的账号只能查看设置。</p>}
    {error && <p role="alert" className="text-status-rej">{error}</p>}
  </form>
}

function CompetitorCard({ competitor, clientId, endpoint, canEdit, canRun, onSaved }: { competitor: Competitor; clientId: string; endpoint: string; canEdit: boolean; canRun: boolean; onSaved: () => void }) {
  const [draft, setDraft] = useState(competitor)
  const [tags, setTags] = useState(competitor.tags.join(', '))
  const [urls, setUrls] = useState(competitor.urls.join('\n'))
  const [url, setUrl] = useState(competitor.urls[0] ?? '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  async function mutate(capture: boolean) {
    setBusy(true); setError(''); setMessage('')
    try {
      if (capture) {
        await request<{ request_id: string }>(endpoint, 'POST', { domain: competitor.domain, url })
        setMessage(`已加入采集队列。回到“情报”刷新结果查看进度。`)
      } else {
        await request(`/api/clients/${encodeURIComponent(clientId)}/competitor-domains`, 'PATCH', { monitoring: { ...draft, tags: split(tags), urls: split(urls) } })
        onSaved()
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Request failed') }
    finally { setBusy(false) }
  }
  const sources = Array.from(new Set([...sourceOptions, ...draft.sources]))
  return <article className={card}>
    <p className="text-sm font-bold">监控配置</p>
    <form onSubmit={e => { e.preventDefault(); void mutate(false) }}>
      <fieldset disabled={!canEdit || busy} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">竞品层级<select className={field} value={draft.tier} onChange={e => setDraft(d => ({ ...d, tier: e.target.value as Competitor['tier'] }))}>{['core', 'secondary', 'benchmark', 'watch'].map(v => <option key={v}>{v}</option>)}</select></label>
          <label className="text-sm">监控状态<select className={field} value={draft.status} onChange={e => setDraft(d => ({ ...d, status: e.target.value as Competitor['status'] }))}>{['active', 'emerging', 'archive'].map(v => <option key={v}>{v}</option>)}</select></label>
          <label className="text-sm">检查间隔（小时）<input className={field} type="number" min="24" max="720" required value={draft.interval_hours} onChange={e => setDraft(d => ({ ...d, interval_hours: Number(e.target.value) }))} /></label>
        </div>
        <fieldset><legend className="text-sm">发现来源</legend><div className="flex flex-wrap gap-3">{sources.map(source => <label key={source} className="text-sm"><input type="checkbox" checked={draft.sources.includes(source)} onChange={e => setDraft(d => ({ ...d, sources: e.target.checked ? [...d.sources, source] : d.sources.filter(s => s !== source) }))} /> {source}</label>)}</div></fieldset>
        <label className="block text-sm">标签（逗号分隔）<input className={field} value={tags} onChange={e => setTags(e.target.value)} /></label>
        <label className="block text-sm">业务监控网址（最多3个，每行一个）<textarea className={field} rows={3} value={urls} onChange={e => setUrls(e.target.value)} /><span className="mt-1 block text-xs text-me-charcoal/60">建议：产品列表、新品/优惠、核心产品详情各 1 个。</span></label>
        {split(urls).length > 0 && <ul className="space-y-1 text-xs text-me-charcoal/70">{split(urls).map(value => <li className="break-all" key={value}><strong>{pagePurpose(value)}</strong> · {value}</li>)}</ul>}
        {canEdit && <button className={button} type="submit">保存竞品设置</button>}
      </fieldset>
    </form>
    <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); void mutate(true) }}>
      <label className="min-w-0 flex-1 text-sm">采集网址<select className={field} value={url} onChange={e => setUrl(e.target.value)} disabled={busy || !canRun}><option value="">选择已保存的网址</option>{competitor.urls.map(u => <option key={u}>{u}</option>)}</select></label>
      <button className={button} disabled={busy || !canRun || competitor.status === 'archive' || !url} type="submit">采集此页面</button>
    </form>
    {message && <p role="status" className="break-all text-sm">{message}</p>}
    {error && <p role="alert" className="text-status-rej">{error}</p>}
  </article>
}

function EvidenceCard({ evidence, label }: { evidence: Evidence | undefined; label: string }) {
  if (!evidence) return <p className="text-sm">{label}：暂无关联证据。</p>
  const safeUrl = /^https?:\/\//i.test(evidence.source_url) ? evidence.source_url : null
  return <div className="min-w-0 space-y-2 rounded-lg border border-black/10 bg-white p-3 text-sm">
    <p className="font-bold">{label}</p>
    <p className="text-xs text-me-charcoal/60">{date(evidence.observed_at)} NZ · {evidence.excerpt.length.toLocaleString()} 字符</p>
    {safeUrl ? <a className="break-all underline" href={safeUrl} target="_blank" rel="noopener noreferrer">查看来源网页</a> : <p>来源链接不可用</p>}
    <details><summary className="cursor-pointer">查看完整证据</summary><blockquote className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs leading-6">{evidence.excerpt}</blockquote></details>
    <details><summary className="cursor-pointer text-xs text-me-charcoal/60">证据编号</summary><p className="break-all text-xs">{evidence.id} · {evidence.content_hash}</p></details>
  </div>
}

const DAY = 86_400_000
const scopeAllowsDecision = (scope: ProductScope, match: TravelScopeMatch) => !scope.applies ||
  (scope.evidence_status === 'available' && scope.status !== 'unknown' && match.status === 'matched')

function signalEvidenceState(s: Signal, evidence: Evidence[], asOf: string, productScope: ProductScope) {
  const before = evidence.find(e => e.id === s.before_evidence_id)
  const after = evidence.find(e => e.id === s.after_evidence_id)
  const cited = new Set(s.interpretation?.evidence_ids ?? [])
  const linked = Boolean(before && after && cited.has(s.before_evidence_id ?? '') && cited.has(s.after_evidence_id ?? ''))
  const observed = after?.observed_at ?? s.created_at
  const fresh = isFreshAt(observed, asOf)
  const highlights = changedFacts(before, after)
  const scopeMatch = !productScope.applies
    ? { status: 'matched' as const, matched: [], outside: [] }
    : matchChangedToursScope(before?.excerpt ?? '', after?.excerpt ?? '', after?.source_url ?? '', productScope)
  const evidenceKinds = factKinds([...highlights.added, ...highlights.removed].join('\n'))
  const summaryKinds = factKinds(s.interpretation?.summary ?? '')
  const specificClaims = [...summaryKinds].filter(kind => kind !== 'product')
  const requiredClaims = specificClaims.length > 0 ? specificClaims : [...summaryKinds]
  const verified = requiredClaims.length > 0
    && requiredClaims.every(kind => evidenceKinds.has(kind))
    && claimDetailsVerified(s.interpretation?.summary ?? '', highlights.added, highlights.removed)
  return { before, after, linked, fresh, highlights, verified, scopeMatch }
}

function SignalCard({ signal: s, evidence, asOf, clientName, productScope, featured = false, historical = false }: { signal: Signal; evidence: Evidence[]; asOf: string; clientName: string; productScope: ProductScope; featured?: boolean; historical?: boolean }) {
  const complete = s.interpretation_status === 'complete'
  const summary = s.interpretation?.summary
  const action = s.recommended_action === 'No action recommended.' ? '无需采取行动。' : s.recommended_action
  const { before, after, linked, fresh, highlights, verified, scopeMatch } = signalEvidenceState(s, evidence, asOf, productScope)
  const source = after?.source_url
  const baselineReset = isBaselineReset(s)
  const productMatched = scopeAllowsDecision(productScope, scopeMatch)
  const modelLead = complete && linked && fresh && !baselineReset && (!verified || !productMatched)
  const decisionReady = complete && linked && fresh && !baselineReset && verified && productMatched
  const label = scopeMatch.status === 'outside' ? '当前业务范围外'
    : productScope.applies && !productMatched ? '业务相关性待确认'
      : historical && decisionReady ? '历史参考'
        : decisionReady ? s.classification === 'threat' ? '需要评估应对' : s.classification === 'opportunity' ? '出现可利用机会' : '需要同类对比'
          : complete ? '待核实' : s.interpretation_status === 'failed' ? '分析未完成' : '正在分析'
  const impact = s.classification === 'threat'
    ? `这项变化发生在 ${clientName} 的经营范围内，可能削弱同类产品竞争力；对位前还不能判断实际差距。`
    : s.classification === 'opportunity'
      ? `这项变化发生在 ${clientName} 的经营范围内，可能留下竞争空间；对位前还不能确认现有优势。`
      : `这项变化发生在 ${clientName} 的经营范围内；找到同类线路前，还不能判断价格或产品优势。`
  const compareAction = `请先找出 ${clientName} 最接近的线路，对比出发日期、总价、行程天数和包含项目，再决定是否调整产品或推广。`
  const nextStep = historical ? action ?? '当时没有形成建议。' : productScope.applies ? compareAction : action ?? '暂无建议。'
  return <article className={`${card} ${featured ? 'border-me-ochre/40 bg-gradient-to-br from-me-ochre/10 to-white p-5' : ''}`}>
    <div className="flex flex-wrap items-center justify-between gap-2"><span className={`rounded-full px-3 py-1 text-xs font-bold ${!decisionReady ? 'bg-amber-50 text-amber-800' : s.classification === 'threat' ? 'bg-red-50 text-red-800' : s.classification === 'opportunity' ? 'bg-green-50 text-green-800' : 'bg-black/5 text-me-charcoal/60'}`}>{label}</span><time className="text-xs text-me-charcoal/60" dateTime={s.created_at}>观察于 {date(s.created_at)} NZ</time></div>
    <p className="text-xs font-bold text-me-charcoal/55">{s.domain}{source ? ` · ${pagePurpose(source)}` : ''}</p>
    {scopeMatch.status === 'outside' ? <div className="rounded-lg border border-black/10 bg-black/[0.03] p-4 text-sm leading-6"><strong>已从 {clientName} 当前经营判断中排除</strong><p className="mt-1">这条变化涉及{travelMarketLabels(scopeMatch.outside).join('、')}，与当前按“{productScope.labels.join('、')}”筛选的产品范围不一致。</p><p className="mt-2 text-me-charcoal/65">竞品变化仍保留作市场记录，但不会生成行动建议。</p></div> : decisionReady ? <>
      <h3 className={`${featured ? 'text-2xl' : 'text-lg'} font-black leading-snug`}>{summary ?? '已发现一项与当前业务相关的竞品变化。'}</h3>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg bg-white/80 p-4"><p className="text-xs font-bold text-me-charcoal/60">对 {clientName} 的意义</p><p className="mt-2 text-sm font-bold leading-6">{impact}</p></div>
        <div className="rounded-lg border border-me-ochre/30 bg-me-ochre/10 p-4"><p className="text-xs font-bold text-me-charcoal/60">{historical ? '当时建议' : productScope.applies ? '建议先核对' : '这周下一步'}</p><p className="mt-2 text-sm font-bold leading-6">{nextStep}</p></div>
      </div>
    </> : modelLead ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6"><strong>{productScope.applies && !productMatched ? '这条变化的业务范围待确认' : '模型发现了一条待核实线索'}</strong><p className="mt-1">{summary}</p><p className="mt-2 text-me-charcoal/65">{productScope.applies && !productMatched ? productScope.evidence_status === 'failed' ? '客户经营范围读取失败，暂不展示行动建议。' : productScope.status === 'unknown' ? '客户经营范围尚未配置或推断，暂不展示行动建议。' : `现有证据还不能确认它是否属于“${productScope.labels.join('、')}”业务，暂不展示行动建议。` : '现有证据未提取到可核对的关键差异，暂不展示行动建议。'}</p></div> : baselineReset ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6"><strong>本次只建立新基线</strong><p>变化前的证据不完整，暂不作为经营决定；下一次采集后再比较价格、档期和余位。</p></div> : <p className="text-sm leading-7">{!complete ? s.interpretation_status === 'failed' ? '页面变化已保存，但这次没有形成有效分析，当前不能据此决策。' : '页面变化正在分析，完成前不建议采取行动。' : !linked ? '模型结论没有形成完整的前后证据链，当前不能作为经营决定。' : '这条观察已超过 8 天，请重新采集后再决定。'}</p>}
    <p className="text-xs text-me-charcoal/60">{historical ? '历史参考' : '当前判断'} · 仅代表这个竞品的这个页面 · 尚未执行任何动作{decisionReady && s.interpretation?.confidence != null ? ` · 模型判断置信度 ${Math.round(s.interpretation.confidence * 100)}%` : ''}</p>
    <details className="rounded-lg bg-me-ivory p-3"><summary className="cursor-pointer text-sm font-bold">查看变化依据</summary><div className="mt-3 space-y-3"><ChangeHighlights added={highlights.added} removed={highlights.removed} /><div className="grid gap-3 md:grid-cols-2"><EvidenceCard label="之前快照" evidence={before} /><EvidenceCard label="当前快照" evidence={after} /></div></div></details>
  </article>
}

function ChangeHighlights({ added, removed }: { added: string[]; removed: string[] }) {
  if (added.length === 0 && removed.length === 0) return null
  return <section className="space-y-3" aria-label="关键差异">
    <h4 className="text-sm font-bold">关键差异</h4>
    <div className="grid gap-3 md:grid-cols-2">
      <div className="rounded-lg border border-red-100 bg-red-50/60 p-4"><p className="text-xs font-bold text-red-800">减少或不再出现</p>{removed.length ? <ul className="mt-2 space-y-2 text-sm">{removed.map(value => <li key={value}>− {value}</li>)}</ul> : <p className="mt-2 text-sm text-me-charcoal/60">未发现高信号事实减少</p>}</div>
      <div className="rounded-lg border border-green-100 bg-green-50/60 p-4"><p className="text-xs font-bold text-green-800">新增或发生改变</p>{added.length ? <ul className="mt-2 space-y-2 text-sm">{added.map(value => <li key={value}>+ {value}</li>)}</ul> : <p className="mt-2 text-sm text-me-charcoal/60">未发现高信号事实新增</p>}</div>
    </div>
  </section>
}

function Signals({ signals, evidence, runs, targets, batch, asOf, clientName, productScope }: { signals: Signal[]; evidence: Evidence[]; runs: Run[]; targets: AnalysisTarget[]; batch: BatchTarget[]; asOf: string; clientName: string; productScope: ProductScope }) {
  const recentRuns = latestRunsForTargets(runs, targets)
  const batchIds = new Set(batch.filter(target => target.status === 'queued').map(target => target.request_id))
  const currentRuns = batch.length ? runs.filter(run => batchIds.has(run.id)) : recentRuns
  const currentRunIds = new Set(currentRuns.map(run => run.id))
  const latest = signals.filter(signal => currentRunIds.has(signal.run_id)).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  const completedRuns = currentRuns.filter(run => run.status === 'complete')
  const stale = completedRuns.filter(run => !isFreshAt(run.created_at, asOf)).length
  const completed = completedRuns.length - stale
  const failedRuns = currentRuns.filter(run => ['failed', 'reconciliation'].includes(run.status)).length
  const stopped = batch.filter(target => target.status !== 'queued').length
  const failed = failedRuns + stopped
  const pending = batch.length
    ? batchIds.size - completedRuns.length - failedRuns
    : currentRuns.filter(run => !['complete', 'failed', 'reconciliation'].includes(run.status)).length
  const scope = batch.length || targets.length
  const untouched = batch.length ? 0 : targets.length - recentRuns.length
  const insufficient = failed > 0 || untouched > 0 || stale > 0
  const emptyTitle = pending ? '分析正在进行'
    : !batch.length && currentRuns.length === 0 ? '还没有可用的竞争分析'
      : stale > 0 ? '最近一次证据已过期，请重新采集'
        : insufficient ? `${batch.length ? '本轮' : '最近一次'}覆盖不足，暂不能下结论`
        : `${batch.length ? '本轮' : '最近一次'}没有发现需要调衡的竞争变化`
  const emptyCopy = !batch.length && currentRuns.length === 0
    ? '点击“开始竞争分析”，ME 会读取已配置业务页面并在发现可靠变化时给出建议。'
    : stale > 0 ? '旧记录只能说明当时没有发现变化，不能代表当前竞争盘面。'
      : insufficient ? '已完成页面暂未发现可靠变化，但仍有页面未完成，不能代表完整竞争情况。'
      : '已完成页面没有出现可靠的产品、价格、促销、档期或余位变化。首次读取只建立业务基线。'
  const ordered = [...latest].sort((a, b) => {
    const ready = (s: Signal) => { const state = signalEvidenceState(s, evidence, asOf, productScope); return Number(s.interpretation_status === 'complete' && state.linked && state.fresh && state.verified && scopeAllowsDecision(productScope, state.scopeMatch) && !isBaselineReset(s)) }
    const priority = (s: Signal) => s.classification === 'threat' ? 2 : s.classification === 'opportunity' ? 1 : 0
    return ready(b) - ready(a) || priority(b) - priority(a) || Date.parse(b.created_at) - Date.parse(a.created_at)
  })
  const inScope = ordered.filter(signal => signalEvidenceState(signal, evidence, asOf, productScope).scopeMatch.status !== 'outside')
  const excluded = ordered.filter(signal => signalEvidenceState(signal, evidence, asOf, productScope).scopeMatch.status === 'outside')
  const primary = inScope[0]
  const additional = inScope.slice(1)
  return <section className="space-y-4" aria-label="竞品情报">
    <div><p className="text-xs font-bold tracking-wide text-me-charcoal/55">需要关注的变化</p><h2 className="mt-1 text-xl font-bold">{latest.length ? '最近一次读取发现了什么？' : '目前还没有可查看的竞争变化'}</h2><p className="mt-1 text-sm text-me-charcoal/60">只有证据、时间和业务范围都清楚的变化，才会出现在这里。</p></div>
    {productScope.applies && productScope.evidence_status === 'failed' && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">客户产品范围读取失败，本页暂不提供经营行动建议。</p>}
    {productScope.applies && productScope.evidence_status === 'available' && productScope.status === 'unknown' && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">客户产品范围尚未配置或推断，本页只保留待确认线索，不提供经营行动建议。</p>}
    {productScope.applies && productScope.evidence_status === 'available' && productScope.status !== 'unknown' && <details className="rounded-lg bg-me-ivory px-3 py-2 text-sm"><summary className="cursor-pointer"><strong>分析范围：{productScope.labels.join('、')}团</strong>{productScope.status === 'inferred' ? ' · 来自客户现有业务资料' : ''}</summary><p className="mt-2 text-xs text-me-charcoal/60">判断依据：{productScope.source}{productScope.basis.length ? `（${productScope.basis.join('、')}）` : ''}</p></details>}
    {inScope.length === 0 && <div className={card}><p className="font-bold">{latest.length ? '本次采集尚未找到匹配产品变化' : emptyTitle}</p><p className="text-sm">{latest.length ? `已保留 ${excluded.length} 条当前业务范围外的变化记录；这不代表市场没有竞争。` : emptyCopy}</p></div>}
    {primary && <SignalCard signal={primary} evidence={evidence} asOf={asOf} clientName={clientName} productScope={productScope} featured />}
    <p className="text-xs text-me-charcoal/60">本次监控覆盖：{completed}/{scope} 个页面证据有效{stale ? ` · ${stale} 个已过期` : ''}{pending ? ` · ${pending} 个处理中` : ''}{failed ? ` · ${failed} 个未完成` : ''}{untouched ? ` · ${untouched} 个尚未运行` : ''}</p>
    {additional.length > 0 && <details className="rounded-xl border border-black/10 p-4"><summary className="cursor-pointer text-sm font-bold">其他当前页面判断 · {additional.length} 条</summary><div className="mt-4 space-y-3">{additional.map(s => <SignalCard key={s.id} signal={s} evidence={evidence} asOf={asOf} clientName={clientName} productScope={productScope} />)}</div></details>}
    {excluded.length > 0 && <details className="rounded-xl border border-black/10 p-4"><summary className="cursor-pointer text-sm font-bold">当前业务范围外 · {excluded.length} 条</summary><div className="mt-4 space-y-3">{excluded.map(s => <SignalCard key={s.id} signal={s} evidence={evidence} asOf={asOf} clientName={clientName} productScope={productScope} />)}</div></details>}
    {signals.length > latest.length && <details className="rounded-xl border border-black/10 p-4"><summary className="cursor-pointer text-sm font-bold">历史分析 · {signals.length - latest.length} 条</summary><div className="mt-4 space-y-3">{signals.filter(signal => !currentRunIds.has(signal.run_id)).map(s => <SignalCard key={s.id} signal={s} evidence={evidence} asOf={asOf} clientName={clientName} productScope={productScope} historical />)}</div></details>}
  </section>
}

function Runs({ runs, signals, observations = [] }: { runs: Run[]; signals: Signal[]; observations?: Observation[] }) {
  const labels: Record<string, string> = { complete: '已完成', failed: '未完成', reserved: '排队中', capturing: '采集中', captured: '已采集', reconciliation: '费用待核对' }
  const signalByRun = new Map(signals.map(signal => [signal.run_id, signal]))
  const observationByRun = new Map(observations.map(observation => [observation.run_id, observation]))
  const analysis = (run: Run) => {
    if (run.status !== 'complete') return null
    const signal = signalByRun.get(run.id)
    if (!signal) return { label: '无变化信号', copy: '网页已采集，未发现足够可靠的业务变化；本次只更新了基线。', tone: 'text-me-charcoal/70' }
    if (signal.interpretation_status === 'complete') return { label: '分析已完成', copy: '网页已采集，变化分析已生成。', tone: 'text-green-800' }
    if (signal.interpretation_status === 'failed') return { label: '分析未完成', copy: '网页已采集，但这次没有形成有效分析，当前不能据此决策。', tone: 'text-status-rej' }
    return { label: '正在分析', copy: '网页已采集，变化分析仍在处理中。完成前不建议采取行动。', tone: 'text-amber-800' }
  }
  return <section className="space-y-3" aria-label="采集记录">
    {runs.length === 0 && <p className="text-sm">暂无采集记录。</p>}
    {runs.map(r => {
      const state = analysis(r)
      return <article className={card} key={r.id}>
        <p className="break-all text-sm font-bold">{r.domain} · {labels[r.status] ?? '处理中'}</p>
        <p className="text-sm">{date(r.created_at)} NZ · {r.accounted_nzd == null ? `待结算 NZ$${money(r.reserved_nzd)}` : `已结算 NZ$${money(r.accounted_nzd)}`}</p>
        {observationByRun.get(r.id) && <p className="break-all text-xs text-me-charcoal/65">成功观察：{date(observationByRun.get(r.id)!.observed_at)} NZ · <a className="underline" href={observationByRun.get(r.id)!.url} target="_blank" rel="noopener noreferrer">查看来源网页</a></p>}
        {state && <p className={`text-sm font-bold ${state.tone}`}>分析：{state.label}<span className="ml-2 font-normal">{state.copy}</span></p>}
        {r.error_code && <p className="text-sm text-status-rej">{r.error_code.startsWith('interpretation_') ? '网页已采集，但分析结果未完成。' : r.status === 'reconciliation' ? '费用需要核对后才能继续采集。' : '本次采集未完成。'}</p>}
        <details className="text-xs"><summary className="cursor-pointer">查看诊断信息</summary><div className="mt-2 space-y-2 break-all"><p>{r.url}</p><p>请求编号：{r.id}</p><p>采集状态：{r.provider_status ?? '等待中'} · 采集 US${money(r.capture_cost_usd)} · 分析 US${money(r.interpretation_cost_usd)}</p>{r.error_code && <p>{r.error_code}</p>}</div></details>
      </article>
    })}
  </section>
}
