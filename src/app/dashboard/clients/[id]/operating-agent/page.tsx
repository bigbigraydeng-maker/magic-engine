'use client'

import { useEffect, useState } from 'react'
import type { OperatingBrief } from '@/lib/web-intelligence/operating-brief'
import { formatTourLandscapeChatReply, type TourLandscape } from '@/lib/web-intelligence/tour-landscape'

type TrafficDirection = { domain: string; is_client?: boolean; source_url: string; observed_at: string; valid_until: string | null; excerpt: string; observation_count: number; previous_observed_at: string | null; estimated_visits: number | null; previous_estimated_visits: number | null; snapshot_change_pct: number | null; visits_change_pct: number | null; top_country: string | null }
type ExternalSignal = { source_type: 'industry_news' | 'industry_media' | 'jobs'; source_name: string; source_url: string; title: string; excerpt: string; observed_at: string; valid_until: string | null }
type Payload = { operating: OperatingBrief; client: { domain: string | null }; can_run: boolean; client_product_source?: { kind: 'master_brief' | 'first_party_feed' | 'web_snapshot' | 'none'; count: number }; traffic_direction?: TrafficDirection[]; external_signals?: ExternalSignal[]; runs?: Array<{ id: string; status: string; provider_status: string | null }> }
type ComparisonResult = { summary: string; client_strengths: string[]; competitor_strengths: string[]; differences: string[]; recommendations: string[]; unknowns: string[]; confidence: number; evidence_urls: string[] }
type LandscapeChatMessage = { role: 'user' | 'assistant'; content: string }
type CapturePhase = 'idle' | 'queued' | 'capturing' | 'analysing' | 'complete' | 'failed'

const statusLabel = {
  comparable: '找到相近竞品',
  out_of_scope: '不在本次范围',
  insufficient_evidence: '资料还不够',
} as const

export default function OperatingAgentPage({ params }: { params: { id: string } }) {
  const [data, setData] = useState<OperatingBrief | null>(null)
  const [clientProductSource, setClientProductSource] = useState<Payload['client_product_source']>()
  const [clientDomain, setClientDomain] = useState<string | null>(null)
  const [trafficDirection, setTrafficDirection] = useState<TrafficDirection[]>([])
  const [externalSignals, setExternalSignals] = useState<ExternalSignal[]>([])
  const [externalBusy, setExternalBusy] = useState('')
  const [externalMessage, setExternalMessage] = useState('')
  const [trafficBusy, setTrafficBusy] = useState(false)
  const [trafficMessage, setTrafficMessage] = useState('')
  const [canRun, setCanRun] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [captureRequestId, setCaptureRequestId] = useState<string | null>(null)
  const [capturePhase, setCapturePhase] = useState<CapturePhase>('idle')
  const [completionReloaded, setCompletionReloaded] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    fetch(`/api/clients/${encodeURIComponent(params.id)}/web-intelligence`, { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('暂时无法读取经营上下文。')
        return response.json() as Promise<Payload>
      })
      .then(value => {
        setData(value.operating); setClientProductSource(value.client_product_source); setTrafficDirection(value.traffic_direction ?? []); setExternalSignals(value.external_signals ?? []); setClientDomain(value.client.domain); setCanRun(value.can_run)
        if (captureRequestId) {
          const run = value.runs?.find(item => item.id === captureRequestId)
          if (run?.status === 'complete') setCapturePhase('complete')
          else if (run?.status === 'failed' || run?.status === 'reconciliation') setCapturePhase('failed')
          else if (run?.provider_status) setCapturePhase('analysing')
          else if (run) setCapturePhase('capturing')
          else setCapturePhase('queued')
        }
      })
      .catch(reason => setError(reason instanceof Error ? reason.message : '暂时无法读取经营上下文。'))
  }, [params.id, refresh, captureRequestId])

  useEffect(() => {
    if (!captureRequestId || capturePhase === 'complete' || capturePhase === 'failed') return
    const timer = window.setTimeout(() => setRefresh(value => value + 1), 4000)
    return () => window.clearTimeout(timer)
  }, [captureRequestId, capturePhase, refresh])

  useEffect(() => {
    if (capturePhase !== 'complete' || completionReloaded) return
    setCompletionReloaded(true)
    const first = window.setTimeout(() => setRefresh(value => value + 1), 750)
    const second = window.setTimeout(() => setRefresh(value => value + 1), 4000)
    return () => { window.clearTimeout(first); window.clearTimeout(second) }
  }, [capturePhase, completionReloaded])

  async function captureClientProducts() {
    if (!clientDomain) return
    setCompletionReloaded(false)
    setCapturePhase('capturing')
    try {
      const response = await fetch(`/api/clients/${encodeURIComponent(params.id)}/web-intelligence`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: clientDomain, url: `https://${clientDomain}/` }),
      })
      const payload = await response.json() as { error?: string; request_id?: string }
      if (!response.ok) throw new Error(payload.error ?? '暂时无法读取 CTS 官网。')
      setCaptureRequestId(payload.request_id ?? null)
      setCapturePhase('queued')
      setRefresh(value => value + 1)
    } catch { setCaptureRequestId(null); setCapturePhase('failed') }
  }

  async function collectExternal(sourceId: string) {
    setExternalBusy(sourceId); setExternalMessage('')
    try {
      const response = await fetch(`/api/clients/${encodeURIComponent(params.id)}/web-intelligence/external`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source_id: sourceId, queries: ['China travel', 'tour manager', 'travel consultant'], max_results: 20 }) })
      const payload = await response.json() as { persisted?: number; duplicates?: number; rejected?: number; filtered?: number; error?: string }
      if (!response.ok) throw new Error(payload.error ?? '外部信息读取失败。')
      setExternalMessage(`本次读取完成：新增 ${payload.persisted ?? 0} 条${payload.filtered ? `，过滤 ${payload.filtered} 条与当前市场无关` : ''}${payload.duplicates ? `，${payload.duplicates} 条已存在` : ''}${payload.rejected ? `，${payload.rejected} 条资料不完整` : ''}。`)
      setRefresh(value => value + 1)
    } catch (reason) { setExternalMessage(reason instanceof Error ? reason.message : '外部信息读取失败。') }
    finally { setExternalBusy('') }
  }

  if (error) return <main className="mx-auto max-w-5xl p-6"><p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p></main>
  if (!data) return <main className="mx-auto max-w-5xl p-6"><p role="status" className="text-sm text-me-charcoal/60">正在整理客户经营上下文…</p></main>

  const { decision } = data
  return <main className="mx-auto max-w-5xl space-y-6 p-6 text-me-charcoal">
    <header className="rounded-2xl bg-me-charcoal p-6 text-white">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-me-gold">经营 Agent · Detect / Understand / Recommend</p>
      <h1 className="mt-2 text-2xl font-bold">{data.client_name} 当前该关注什么</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-white/75">先把 CTS 自己的 Tour 资料读出来，再和主要竞品比较。所有动作仍需人工复核。</p>
      <div className="mt-4 space-y-3">
        <button type="button" onClick={() => void captureClientProducts()} disabled={!canRun || !clientDomain || ['queued', 'capturing', 'analysing'].includes(capturePhase)} className="rounded-lg bg-me-gold px-3 py-2 text-sm font-bold text-me-charcoal disabled:opacity-50">{['queued', 'capturing', 'analysing'].includes(capturePhase) ? '正在读取…' : capturePhase === 'complete' ? '重新读取 CTS 产品' : '读取 CTS 官网产品'}</button>
        {capturePhase !== 'idle' && <CaptureProgress phase={capturePhase} />}
      </div>
    </header>

    <section className="grid gap-4 md:grid-cols-3" aria-label="客户上下文">
      <ContextCard title="当前目标" values={decision.context} />
      <ContextCard title="客户产品范围" values={data.product_scope.labels.length ? [`${data.product_scope.labels.join('、')}（${data.product_scope.source}）`] : ['尚无可靠产品范围']} />
      <ContextCard title="授权边界" values={['本页只提供建议', '不调价、不改广告、不发布']} />
    </section>
    <ProductSourceStatus source={clientProductSource} />
    <TourComparisonSection clientId={params.id} candidates={data.comparison_candidates} marketScope={data.product_scope.labels} externalSignalCount={externalSignals.filter(signal => signal.source_type !== 'jobs').length} />
    <TrafficDirectionSection clientId={params.id} signals={trafficDirection} busy={trafficBusy} message={trafficMessage} onRun={async () => {
      setTrafficBusy(true); setTrafficMessage('')
      try {
        const response = await fetch(`/api/clients/${encodeURIComponent(params.id)}/web-intelligence/traffic-direction`, { method: 'POST' })
        const payload = await response.json() as { error?: string; persisted?: number; duplicates?: number; rejected?: number; write_failures?: number; returned?: number; domains?: number }
        if (!response.ok) throw new Error(payload.error ?? '竞品流量方向读取失败。')
        const persisted = payload.persisted ?? 0
        const duplicates = payload.duplicates ?? 0
        const rejected = payload.rejected ?? 0
        const writeFailures = payload.write_failures ?? 0
        const detail = [
          duplicates ? `${duplicates} 条已存在` : '',
          rejected ? `${rejected} 条无法确认数据` : '',
          writeFailures ? `${writeFailures} 条写入失败` : '',
        ].filter(Boolean).join('；')
        setTrafficMessage(`本次已完成 ${payload.domains ?? 0} 个竞品网站读取，新增 ${persisted} 条结果${detail ? `（${detail}）` : '。'}`)
        setRefresh(value => value + 1)
      } catch (reason) { setTrafficMessage(reason instanceof Error ? reason.message : '竞品流量方向读取失败。') }
      finally { setTrafficBusy(false) }
    }} />
    <ExternalSignalsSection signals={externalSignals} busy={externalBusy} message={externalMessage} onCollect={collectExternal} />

    <section className="rounded-2xl border border-me-ochre/30 bg-me-ochre/10 p-5">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-me-ochre">本轮经营问题</p>
      <h2 className="mt-2 text-xl font-bold">{decision.question}</h2>
      <p className="mt-3 text-sm leading-6">{decision.impact}</p>
      <p className="mt-4 rounded-xl bg-white p-4 text-sm font-bold leading-6">建议：{decision.recommendation}</p>
    </section>

    <section className="grid gap-4 lg:grid-cols-2">
      <article className="rounded-2xl border border-black/10 bg-white p-5">
        <h2 className="text-lg font-bold">关键竞品证据</h2>
        <p className="mt-2 text-sm text-me-charcoal/65">已找到 {decision.external_signal.length} 条近期、与当前业务范围有关的证据。</p>
        <details className="mt-3 rounded-lg bg-me-ivory p-3"><summary className="cursor-pointer text-sm font-bold">查看来源和观察时间</summary>{decision.external_signal.length ? <ul className="mt-3 space-y-2 text-sm leading-6">{decision.external_signal.map(item => <li key={`${item.source_url}-${item.observed_at ?? 'unknown'}`} className="rounded-lg bg-white p-3"><p>{item.statement}</p><p className="mt-2 text-xs text-me-charcoal/60"><a className="underline" href={item.source_url} target="_blank" rel="noreferrer">来源</a> · 观察于 {item.observed_at ? new Date(item.observed_at).toLocaleString('zh-CN') : '时间未知'} · 有效至 {item.valid_until ? new Date(item.valid_until).toLocaleDateString('zh-CN') : '未知'}</p></li>)}</ul> : <p className="mt-3 text-sm text-me-charcoal/60">尚无可用竞品产品证据。</p>}</details>
      </article>
      <article className="rounded-2xl border border-black/10 bg-white p-5">
        <h2 className="text-lg font-bold">逐条候选证据</h2>
        <p className="mt-2 text-sm text-me-charcoal/65">这些候选只用于支持 AI 总览，不代表竞品和 CTS 一一对应。</p>
        <ProductMatches matches={data.matches} />
      </article>
    </section>

    <section className="grid gap-4 lg:grid-cols-2">
      <EvidenceCard title="证据" evidence={decision.evidence} />
      <article className="rounded-2xl border border-black/10 bg-white p-5"><h2 className="text-lg font-bold">还缺什么信息？下一步怎么做</h2><ul className="mt-3 space-y-2 text-sm leading-6">{decision.unknowns.map(item => <li key={item} className="rounded-lg bg-black/[0.03] p-3">{item}</li>)}</ul><p className="mt-4 border-t border-black/5 pt-4 text-sm leading-6"><strong>下一步：</strong>{decision.check_and_tune}</p></article>
    </section>
    <p className="text-xs text-me-charcoal/45">截至 {new Date(data.as_of).toLocaleString('zh-CN', { timeZone: 'Pacific/Auckland' })}（Pacific/Auckland）· 事实、推断、建议和未知已分开显示。</p>
  </main>
}

function ExternalSignalsSection({ signals, busy, message, onCollect }: { signals: ExternalSignal[]; busy: string; message: string; onCollect: (sourceId: string) => Promise<void> }) {
  const latest = signals.slice(0, 6)
  const labels: Record<string, string> = { 'industry_media': '行业媒体', 'industry_news': '行业新闻', jobs: '招聘信息' }
  return <section className="rounded-2xl border border-black/10 bg-white p-5" aria-label="行业动态和招聘信息">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-me-charcoal/50">其他外部信号</p><h2 className="mt-1 text-lg font-bold">行业动态与招聘信息</h2><p className="mt-1 text-sm leading-6 text-me-charcoal/65">用行业媒体、行业新闻和招聘需求补充市场变化；每条信息都保留来源和观察时间。</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => void onCollect('travel-today')} disabled={Boolean(busy)} className="rounded-lg border border-me-ochre px-3 py-1.5 text-xs font-bold text-me-ochre disabled:opacity-50">{busy === 'travel-today' ? '读取中…' : '读取行业媒体'}</button><button type="button" onClick={() => void onCollect('seek-nz')} disabled={Boolean(busy)} className="rounded-lg border border-me-ochre px-3 py-1.5 text-xs font-bold text-me-ochre disabled:opacity-50">{busy === 'seek-nz' ? '读取中…' : '读取 SEEK 招聘'}</button></div></div>
    {message && <p role="status" className="mt-3 rounded-lg bg-me-ivory px-3 py-2 text-sm">{message}</p>}
    {latest.length ? <div className="mt-4 space-y-2">{latest.map(signal => <article key={`${signal.source_url}-${signal.observed_at}`} className="rounded-xl bg-me-ivory/60 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-me-charcoal/55">{labels[signal.source_type] ?? signal.source_name}</p><h3 className="mt-1 font-bold">{signal.title || signal.source_name}</h3></div><a className="shrink-0 text-xs font-bold underline" href={signal.source_url} target="_blank" rel="noreferrer">查看来源</a></div><p className="mt-2 line-clamp-3 whitespace-pre-line text-sm leading-6 text-me-charcoal/75">{signal.excerpt}</p><p className="mt-2 text-xs text-me-charcoal/50">观察于 {new Date(signal.observed_at).toLocaleDateString('zh-CN')} · 有效至 {signal.valid_until ? new Date(signal.valid_until).toLocaleDateString('zh-CN') : '未知'}</p></article>)}</div> : <p className="mt-4 rounded-xl bg-me-ivory p-4 text-sm text-me-charcoal/60">目前没有与客户目标市场相关的行业媒体或招聘信息。系统已自动过滤无关内容。</p>}
    {signals.length > 6 && <details className="mt-3"><summary className="cursor-pointer text-sm font-bold text-me-ochre">查看其余 {signals.length - 6} 条信息</summary><div className="mt-3 space-y-2">{signals.slice(6).map(signal => <article key={`${signal.source_url}-${signal.observed_at}-extra`} className="rounded-xl bg-me-ivory/60 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-me-charcoal/55">{labels[signal.source_type] ?? signal.source_name}</p><h3 className="mt-1 font-bold">{signal.title || signal.source_name}</h3></div><a className="shrink-0 text-xs font-bold underline" href={signal.source_url} target="_blank" rel="noreferrer">查看来源</a></div><p className="mt-2 whitespace-pre-line text-sm leading-6 text-me-charcoal/75">{signal.excerpt}</p><p className="mt-2 text-xs text-me-charcoal/50">观察于 {new Date(signal.observed_at).toLocaleDateString('zh-CN')} · 有效至 {signal.valid_until ? new Date(signal.valid_until).toLocaleDateString('zh-CN') : '未知'}</p></article>)}</div></details>}
  </section>
}

function TrafficDirectionSection({ clientId, signals, busy, message, onRun }: { clientId: string; signals: TrafficDirection[]; busy: boolean; message: string; onRun: () => Promise<void> }) {
  const [showAll, setShowAll] = useState(false)
  const orderedSignals = [...signals].sort((a, b) => {
    if (a.is_client !== b.is_client) return a.is_client ? -1 : 1
    const aHasEstimate = a.estimated_visits !== null ? 1 : 0
    const bHasEstimate = b.estimated_visits !== null ? 1 : 0
    return bHasEstimate - aHasEstimate || Date.parse(b.observed_at) - Date.parse(a.observed_at)
  })
  const latest = showAll ? orderedSignals : orderedSignals.slice(0, 6)
  return <section className="rounded-2xl border border-black/10 bg-white p-5" aria-label="网站流量方向">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-me-charcoal/50">网站市场信号</p><h2 className="mt-1 text-lg font-bold">网站流量方向</h2><p className="mt-1 text-sm leading-6 text-me-charcoal/65">先看 CTS 自己的网站，再看竞品公开估算的变化方向；不代表真实访问量、订单或销售影响。</p></div>
      <div className="flex items-center gap-2"><span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">公开估算·低置信度</span><button type="button" onClick={() => void onRun()} disabled={busy} aria-label={`读取 ${clientId} 网站流量方向`} className="rounded-lg border border-me-ochre px-3 py-1.5 text-xs font-bold text-me-ochre disabled:opacity-50">{busy ? '读取中…' : '立即读取'}</button></div>
    </div>
    {message && <p role="status" className="mt-3 rounded-lg bg-me-ivory px-3 py-2 text-sm">{message}</p>}
    {latest.length ? <div className="mt-4 grid gap-3 md:grid-cols-2">{latest.map(signal => {
      const facts = signal.excerpt.split('\n').filter(line => !line.startsWith('数据性质：')).slice(0, 4)
      const trend = signal.snapshot_change_pct === null ? signal.observation_count > 1 ? '暂无法比较上一期' : '仅有一次观察' : `较上次估算 ${signal.snapshot_change_pct > 0 ? '+' : ''}${signal.snapshot_change_pct}%`
      return <article key={`${signal.domain}-${signal.observed_at}`} className={`rounded-xl border p-4 ${signal.is_client ? 'border-me-ochre/40 bg-me-ochre/10' : 'border-black/5 bg-me-ivory/60'}`}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-me-charcoal/55">{signal.is_client ? 'CTS 自己的网站' : '竞品网站'}</p><h3 className="font-bold">{signal.domain}</h3><p className={`mt-1 text-sm font-bold ${signal.snapshot_change_pct === null ? 'text-me-charcoal/55' : signal.snapshot_change_pct > 0 ? 'text-red-700' : 'text-green-800'}`}>{trend}</p></div><a className="shrink-0 text-xs font-bold underline" href={signal.source_url} target="_blank" rel="noreferrer">查看来源</a></div><ul className="mt-3 space-y-1 text-sm leading-6">{facts.map(fact => <li key={fact}>{fact}</li>)}</ul><p className="mt-3 text-xs text-me-charcoal/50">观察于 {new Date(signal.observed_at).toLocaleDateString('zh-CN')} · {signal.observation_count} 次观察 · 有效至 {signal.valid_until ? new Date(signal.valid_until).toLocaleDateString('zh-CN') : '未知'}</p></article>
    })}</div> : <p className="mt-4 rounded-xl bg-me-ivory p-4 text-sm text-me-charcoal/60">尚未测量竞品网站流量方向；完成首轮 Apify 采集后，这里只显示每个竞品最新结果。</p>}
    {signals.length > 6 && <button type="button" onClick={() => setShowAll(value => !value)} className="mt-4 text-sm font-bold text-me-ochre underline">{showAll ? '收起其他竞品' : `查看其余 ${signals.length - 6} 个竞品`}</button>}
  </section>
}

function CaptureProgress({ phase }: { phase: Exclude<CapturePhase, 'idle'> }) {
  const details: Record<Exclude<CapturePhase, 'idle'>, { label: string; copy: string; width: number; tone: string }> = {
    queued: { label: '已排队', copy: '请求已提交，等待读取服务开始。页面会自动检查状态。', width: 20, tone: 'text-amber-100' },
    capturing: { label: '正在读取网页', copy: '正在读取 CTS 官网内容，暂时不用手动刷新。', width: 48, tone: 'text-amber-100' },
    analysing: { label: '正在整理产品资料', copy: '网页已读到，正在整理 Tour、路线、天数和价格。', width: 78, tone: 'text-amber-100' },
    complete: { label: '本次官网读取已完成', copy: '网页读取已完成。若 CTS 第一方产品源已部署，刷新后产品盘面会使用它；否则暂时沿用已有资料。', width: 100, tone: 'text-green-200' },
    failed: { label: '读取未完成', copy: '这次没有完成读取，可以稍后点击按钮重试。', width: 100, tone: 'text-red-200' },
  }
  const detail = details[phase]
  return <div role="status" className="max-w-2xl rounded-xl border border-white/15 bg-white/10 p-3">
    <div className="flex items-center justify-between gap-3 text-xs font-bold"><span className={detail.tone}>{detail.label}</span><span className="text-white/60">{phase === 'complete' || phase === 'failed' ? '无需等待' : '自动更新中'}</span></div>
    <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/15" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={detail.width} aria-valuetext={detail.label}><div className={`h-full rounded-full transition-all duration-500 ${phase === 'failed' ? 'bg-red-300' : phase === 'complete' ? 'bg-green-300' : 'animate-pulse bg-me-gold'}`} style={{ width: `${detail.width}%` }} /></div>
    <p className="mt-2 text-xs leading-5 text-white/75">{detail.copy}</p>
  </div>
}

function ProductSourceStatus({ source }: { source?: Payload['client_product_source'] }) {
  const details = {
    master_brief: { label: '客户已确认产品资料', copy: '当前经营判断使用客户已确认的产品资料。', tone: 'border-green-200 bg-green-50 text-green-900' },
    first_party_feed: { label: '已读取 CTS 第一方产品库', copy: `已读到 ${source?.count ?? 0} 条 active Tour；页面不需要再手动刷新。`, tone: 'border-green-200 bg-green-50 text-green-900' },
    web_snapshot: { label: '当前使用官网网页快照', copy: `已读到 ${source?.count ?? 0} 条产品；第一方产品库尚未成为当前来源。`, tone: 'border-amber-200 bg-amber-50 text-amber-900' },
    none: { label: '尚未读到 CTS 产品', copy: '当前没有可用于经营比较的 CTS 产品资料。', tone: 'border-amber-200 bg-amber-50 text-amber-900' },
  } as const
  const detail = details[source?.kind ?? 'none']
  return <section className={`rounded-xl border p-4 ${detail.tone}`} role="status"><div className="flex flex-wrap items-center justify-between gap-2"><strong>{detail.label}</strong><span className="text-xs font-bold">{source?.count ?? 0} 条</span></div><p className="mt-1 text-sm">{detail.copy}</p></section>
}

function ProductMatches({ matches }: { matches: OperatingBrief['matches'] }) {
  return <details className="mt-3 rounded-lg bg-black/[0.03] p-3"><summary className="cursor-pointer text-sm font-bold">查看逐条候选（{matches.length} 条，仅作证据参考）</summary><div className="mt-3 space-y-2">{matches.length ? matches.map(match => <div key={`${match.client_product ?? 'missing'}-${match.competitor_product ?? 'missing'}`} className="rounded-lg border border-black/5 bg-white p-3 text-sm"><div className="flex items-start justify-between gap-3"><strong>{match.client_product ?? 'CTS 产品未提供'}</strong><span className="shrink-0 rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-800">{statusLabel[match.status]}</span></div>{match.client_product && <p className="mt-2 text-xs text-me-charcoal/60">CTS：{match.client_duration_days ? `${match.client_duration_days} 天` : '天数待补'} · {match.client_price ?? '价格待补'}</p>}<p className="mt-2 text-xs font-bold text-me-charcoal/55">竞品候选（不是 CTS 产品）</p><p className="mt-1 text-me-charcoal/65">{match.competitor_product ?? '没有可确认的竞品对位'}</p>{match.competitor_domain && <p className="mt-1 text-xs text-me-charcoal/60">竞品：{match.competitor_domain} · {match.competitor_duration_days ? `${match.competitor_duration_days} 天` : '天数未知'} · {match.competitor_price ?? '价格未知'}</p>}<p className="mt-2 text-xs leading-5 text-me-charcoal/55">{match.reason}</p></div>) : <p className="text-sm text-me-charcoal/60">尚无可判断的产品记录。</p>}</div></details>
}

function TourComparisonSection({ clientId, candidates, marketScope, externalSignalCount }: { clientId: string; candidates: OperatingBrief['comparison_candidates']; marketScope: string[]; externalSignalCount: number }) {
  const [selected, setSelected] = useState<number | null>(null)
  const [results, setResults] = useState<Record<number, ComparisonResult>>({})
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [landscape, setLandscape] = useState<TourLandscape | null>(null)
  const [landscapeMode, setLandscapeMode] = useState<'ai' | 'fallback'>('ai')
  const [landscapeBusy, setLandscapeBusy] = useState(false)
  const [landscapeError, setLandscapeError] = useState('')
  const [chatMessages, setChatMessages] = useState<LandscapeChatMessage[]>([])
  const [chatQuestion, setChatQuestion] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const [chatError, setChatError] = useState('')
  async function analyse(index: number) {
    const candidate = candidates[index]
    setSelected(index); setBusy(index); setError('')
    try {
      const response = await fetch(`/api/clients/${encodeURIComponent(clientId)}/web-intelligence/tour-comparison`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ market_scope: marketScope, client_product: { name: candidate.client_product.name, record: { name: candidate.client_product.name, duration_days: candidate.client_product.duration_days, price: candidate.client_product.price, route: candidate.client_product.route, departure_window: candidate.client_product.departure_window, includes: candidate.client_product.includes, positioning: candidate.client_product.positioning, audience: candidate.client_product.audience } }, competitor_product: candidate.competitor_product }) })
      const payload = await response.json() as { comparison?: ComparisonResult; error?: string }
      if (!response.ok || !payload.comparison) throw new Error(payload.error ?? '对比失败')
      setResults(previous => ({ ...previous, [index]: payload.comparison! }))
    } catch (reason) { setError(reason instanceof Error ? reason.message : '暂时无法生成对比。') }
    finally { setBusy(null) }
  }
  async function askLandscape() {
    const question = chatQuestion.trim()
    if (!question || chatBusy) return
    const nextMessages = [...chatMessages, { role: 'user' as const, content: question }]
    setChatMessages(nextMessages); setChatQuestion(''); setChatBusy(true); setChatError('')
    try {
      const response = await fetch(`/api/clients/${encodeURIComponent(clientId)}/web-intelligence/tour-landscape/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, history: chatMessages, landscape }) })
      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.includes('application/json')) throw new Error(`对话服务暂时不可用（HTTP ${response.status}），请稍后重试。`)
      const payload = await response.json() as { text?: string; error?: string }
      if (!response.ok || !payload.text) throw new Error(payload.error ?? '对话分析暂时不可用，请稍后重试。')
      setChatMessages([...nextMessages, { role: 'assistant', content: payload.text }])
    } catch (reason) { setChatError(reason instanceof Error ? reason.message : '对话分析暂时不可用，请稍后重试。'); setChatMessages(chatMessages) }
    finally { setChatBusy(false) }
  }
  const result = selected == null ? null : results[selected]
  async function summariseLandscape() {
    setLandscapeBusy(true); setLandscapeError('')
    try {
      const response = await fetch(`/api/clients/${encodeURIComponent(clientId)}/web-intelligence/tour-landscape`, { method: 'POST' })
      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.includes('application/json')) throw new Error(`总览服务暂时不可用（HTTP ${response.status}），请稍后重试。`)
      const payload = await response.json() as { landscape?: TourLandscape; error?: string; degraded?: boolean }
      if (!response.ok || !payload.landscape) throw new Error(payload.error ?? '总览生成失败，请稍后重试。')
      setLandscape(payload.landscape); setLandscapeMode(payload.degraded ? 'fallback' : 'ai')
    }
    catch (reason) { setLandscapeError(reason instanceof Error ? reason.message : '暂时无法生成竞品总览。') }
    finally { setLandscapeBusy(false) }
  }
  return <section className="space-y-4 rounded-2xl border border-me-ochre/30 bg-me-ochre/5 p-5" aria-label="AI Tour 产品总览">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-me-ochre">AI 竞品总览</p><h2 className="mt-1 text-xl font-bold">本次监控范围内，CTS 该关注什么？</h2><p className="mt-2 text-sm leading-6 text-me-charcoal/70">只分析当前客户市场范围和指定监控对象；竞品名单不代表其完整产品线，也不等于整个市场。</p></div><button type="button" onClick={() => void summariseLandscape()} disabled={landscapeBusy} className="rounded-lg bg-me-ochre px-3 py-2 text-sm font-bold text-white disabled:opacity-50">{landscapeBusy ? '正在汇总…' : landscape ? '重新生成总览' : '生成竞品总览'}</button></div>
    {landscapeError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{landscapeError}</p>}
    {landscape && <article className="space-y-4 rounded-xl border border-black/10 bg-white p-5"><div><p className="text-xs font-bold text-me-charcoal/55">现在最重要的判断</p><h3 className="mt-1 text-lg font-black">{landscape.headline}</h3><p className="mt-2 text-sm leading-6">{landscape.market_summary}</p><p className="mt-2 text-xs text-me-charcoal/50">本次判断基于 CTS 产品资料、指定竞品样本{externalSignalCount ? `及 ${externalSignalCount} 条行业/媒体证据` : ''}；不代表竞品完整产品线。</p></div><div className="grid gap-3 md:grid-cols-2"><ComparisonList title="建议现在做" items={landscape.client_opportunities} tone="green" /><ComparisonList title="暂时不要做" items={landscape.client_risks} tone="amber" /><ComparisonList title="下一步先确认" items={landscape.recommended_focus} tone="ochre" /><ComparisonList title="还缺的关键证据" items={landscape.unknowns} tone="muted" /></div><p className="border-t border-black/5 pt-3 text-xs text-me-charcoal/50">{landscapeMode === 'ai' ? 'Haiku AI 汇总' : '规则兜底结论（AI 服务暂时不可用）'} · 置信度 {Math.round(landscape.confidence * 100)}% · 仅供人工复核</p><div className="border-t border-black/5 pt-4"><p className="text-sm font-bold">继续问 Agent</p><p className="mt-1 text-xs text-me-charcoal/55">可以问：现在最该调整哪个产品？为什么不建议降价？还缺哪条证据？</p>{chatMessages.length > 0 && <div className="mt-3 max-h-72 space-y-2 overflow-y-auto rounded-lg bg-me-ivory p-3">{chatMessages.map((message, index) => <div key={`${message.role}-${index}`} className={message.role === 'user' ? 'text-right' : 'text-left'}><span className={`inline-block max-w-[90%] rounded-lg px-3 py-2 text-sm leading-6 ${message.role === 'user' ? 'bg-me-ochre text-white' : 'bg-white'}`}>{message.role === 'user' ? message.content : <span className="whitespace-pre-line">{formatTourLandscapeChatReply(message.content)}</span>}</span></div>)}</div>}<div className="mt-3 flex gap-2"><input aria-label="询问竞品总览 Agent" value={chatQuestion} onChange={event => setChatQuestion(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void askLandscape() }} placeholder="例如：CTS现在最应该先改哪个产品？" className="min-w-0 flex-1 rounded-lg border border-black/15 bg-white px-3 py-2 text-sm" disabled={chatBusy} /><button type="button" onClick={() => void askLandscape()} disabled={!chatQuestion.trim() || chatBusy} className="rounded-lg border border-me-ochre px-3 py-2 text-sm font-bold text-me-ochre disabled:opacity-50">{chatBusy ? '分析中…' : '发送'}</button></div>{chatError && <p role="alert" className="mt-2 text-sm text-red-700">{chatError}</p>}</div></article>}
    {landscape?.evidence_urls.length ? <LandscapeEvidenceLinks urls={landscape.evidence_urls} /> : null}
    {!landscape && <p className="rounded-xl bg-white/70 p-4 text-sm text-me-charcoal/65">点击“生成竞品总览”，查看当前市场组合的整体判断。</p>}
    {candidates.length > 0 ? <details className="rounded-xl border border-black/10 bg-white p-4"><summary className="cursor-pointer text-sm font-bold">查看逐条候选证据（{candidates.length} 条）</summary><div className="mt-4 grid gap-3 lg:grid-cols-2">{candidates.map((candidate, index) => <button type="button" key={`${candidate.client_product.name}-${candidate.competitor_product.source_url}`} onClick={() => void analyse(index)} disabled={busy !== null} className={`text-left rounded-xl border bg-white p-4 transition ${selected === index ? 'border-me-ochre ring-2 ring-me-ochre/20' : 'border-black/10 hover:border-me-ochre/50'}`}><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-me-charcoal/55">CTS：{candidate.client_product.name}</p><p className="mt-1 font-black">竞品：{candidate.competitor_product.name}</p></div><span className="shrink-0 rounded-full bg-me-ivory px-2 py-1 text-[11px] font-bold">相似度 {candidate.match_score}</span></div><p className="mt-3 text-xs font-bold text-me-ochre">{busy === index ? '正在分析…' : results[index] ? '重新生成对比' : '点击查看优劣势对比 →'}</p></button>)}</div></details> : <p className="rounded-xl bg-white/70 p-4 text-sm text-me-charcoal/65">当前没有逐团明细可供核对；仍可生成整体竞品总览。</p>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {result && <article className="space-y-4 rounded-xl border border-black/10 bg-white p-5"><div><p className="text-xs font-bold text-me-charcoal/55">结论</p><h3 className="mt-1 text-lg font-black leading-7">{result.summary}</h3><p className="mt-2 text-xs text-me-charcoal/55">AI 置信度 {Math.round(result.confidence * 100)}% · 来源已锁定为客户与竞品页面</p></div><div className="grid gap-3 md:grid-cols-2"><ComparisonList title="CTS 的优势" items={result.client_strengths} tone="green" /><ComparisonList title="竞品的优势" items={result.competitor_strengths} tone="amber" /></div><ComparisonList title="消费者能感知的差异" items={result.differences} /><ComparisonList title="可以考虑的方向" items={result.recommendations} tone="ochre" />{result.unknowns.length > 0 && <ComparisonList title="仍需补证的信息" items={result.unknowns} tone="muted" />}<div className="border-t border-black/5 pt-3 text-xs text-me-charcoal/55">仅供人工评估，不代表已调整产品或执行营销动作。{result.evidence_urls.map(url => <a key={url} className="ml-3 underline" href={url} target="_blank" rel="noreferrer">查看来源</a>)}</div></article>}
  </section>
}

function ComparisonList({ title, items, tone = 'muted' }: { title: string; items: string[]; tone?: 'green' | 'amber' | 'ochre' | 'muted' }) {
  const styles = { green: 'bg-green-50/70', amber: 'bg-amber-50/70', ochre: 'bg-me-ochre/10', muted: 'bg-black/[0.03]' }
  return <div className={`rounded-lg p-4 ${styles[tone]}`}><h4 className="text-sm font-bold">{title}</h4>{items.length ? <ul className="mt-2 space-y-2 text-sm leading-6">{items.map(item => <li key={item}>• {item}</li>)}</ul> : <p className="mt-2 text-sm text-me-charcoal/55">暂无足够证据。</p>}</div>
}

function LandscapeEvidenceLinks({ urls }: { urls: string[] }) {
  return <p className="rounded-lg border border-black/5 bg-white px-4 py-3 text-xs text-me-charcoal/60">总览依据：{urls.map((url, index) => <span key={url}>{index > 0 && ' · '}<a className="font-bold underline" href={url} target="_blank" rel="noreferrer">来源 {index + 1}</a></span>)}</p>
}

function ContextCard({ title, values }: { title: string; values: string[] }) {
  return <article className="rounded-xl border border-black/10 bg-white p-4"><h2 className="text-sm font-bold text-me-charcoal/60">{title}</h2><ul className="mt-2 space-y-1 text-sm leading-6">{values.map(value => <li key={value}>{value}</li>)}</ul></article>
}

function EvidenceCard({ title, evidence }: Pick<{ title: string; evidence: OperatingBrief['decision']['evidence'] }, 'title' | 'evidence'>) {
  return <article className="rounded-2xl border border-black/10 bg-white p-5"><h2 className="text-lg font-bold">{title}</h2>{evidence.length ? <ul className="mt-3 space-y-2 text-sm leading-6">{evidence.map(item => <li key={item.id} className="rounded-lg bg-me-ivory p-3"><p>{item.statement}</p><p className="mt-1 text-xs text-me-charcoal/50">{/^https?:\/\//i.test(item.source) ? <a className="font-bold underline" href={item.source} target="_blank" rel="noreferrer">打开竞品产品页面</a> : item.source} · {item.observed_at ? new Date(item.observed_at).toLocaleDateString('en-NZ') : '时间未知'} · {item.confidence}</p></li>)}</ul> : <p className="mt-3 text-sm text-me-charcoal/60">尚无可展示的证据。</p>}</article>
}
