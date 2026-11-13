'use client'

import { useCallback, useEffect, useState } from 'react'
import { DASHBOARD_COMPETITOR_ADS_REQUEST } from '@/lib/field-agent/contracts'

type ReviewStatus = 'pending' | 'approved' | 'rejected'
type AdCard = {
  id: string
  competitor_name: string
  competitor_domain: string | null
  ad_library_id: string
  primary_text: string
  headline: string
  cta: string
  landing_url: string
  offer_text: string
  platforms: string[]
  started_running_on: string | null
  source_url: string
  observed_at: string
  review_status: ReviewStatus
  review_notes: string | null
  screenshot_url: string | null
}

const STATUS_LABEL: Record<ReviewStatus, string> = { pending: '待审', approved: '已通过', rejected: '已驳回' }

async function postScan(clientId: string): Promise<string> {
  const response = await fetch(`/api/clients/${encodeURIComponent(clientId)}/field-agent/tasks`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(DASHBOARD_COMPETITOR_ADS_REQUEST),
  })
  const payload = await response.json() as { message?: string }
  return payload.message ?? '采集请求没有完成。'
}

async function postReview(clientId: string, adId: string, reviewStatus: 'approved' | 'rejected', notes: string): Promise<string> {
  const response = await fetch(`/api/clients/${encodeURIComponent(clientId)}/field-agent/observations/${adId}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ review_status: reviewStatus, review_notes: notes }),
  })
  const payload = await response.json() as { error?: string }
  if (!response.ok) throw new Error(payload.error ?? '审核没有保存。')
  return reviewStatus === 'approved' ? '已通过。通过后的广告会进入竞品总览。' : '已驳回。'
}

async function fetchAds(clientId: string, nextStatus: ReviewStatus): Promise<AdCard[]> {
  const query = new URLSearchParams({ review_status: nextStatus })
  const response = await fetch(`/api/clients/${encodeURIComponent(clientId)}/field-agent/observations?${query}`, { cache: 'no-store' })
  const payload = await response.json() as { observations?: AdCard[]; error?: string }
  if (!response.ok) throw new Error(payload.error ?? '暂时读不到竞品广告。')
  return payload.observations ?? []
}

export function FieldAgentAdsPanel({ clientId, canEdit }: { clientId: string; canEdit: boolean }) {
  const [status, setStatus] = useState<ReviewStatus>('pending')
  const [competitor, setCompetitor] = useState('')
  const [ads, setAds] = useState<AdCard[]>([])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')

  const load = useCallback(async (nextStatus: ReviewStatus) => {
    setLoading(true)
    setError('')
    try { setAds(await fetchAds(clientId, nextStatus)) }
    catch (reason) { setAds([]); setError(reason instanceof Error ? reason.message : '暂时读不到竞品广告。') }
    finally { setLoading(false) }
  }, [clientId])

  useEffect(() => { void load(status) }, [load, status])

  if (!canEdit) return null

  async function requestScan() {
    setBusy('request'); setMessage('')
    try { setMessage(await postScan(clientId)) }
    catch { setMessage('采集请求没有送出，请稍后重试。') }
    finally { setBusy('') }
  }

  async function review(ad: AdCard, reviewStatus: 'approved' | 'rejected', notes: string) {
    setBusy(ad.id); setMessage('')
    try { setMessage(await postReview(clientId, ad.id, reviewStatus, notes)); await load(status) }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : '审核没有保存。') }
    finally { setBusy('') }
  }

  const names = [...new Set(ads.map(ad => ad.competitor_name).filter(Boolean))]
  const visible = competitor ? ads.filter(ad => ad.competitor_name === competitor || ad.competitor_domain === competitor) : ads
  return <AdsSection status={status} setStatus={setStatus} setCompetitor={setCompetitor} competitor={competitor} names={names} message={message} error={error} loading={loading} busy={busy} visible={visible} requestScan={requestScan} review={review} />
}

function AdsSection(props: {
  status: ReviewStatus
  setStatus: (status: ReviewStatus) => void
  setCompetitor: (competitor: string) => void
  competitor: string
  names: string[]
  message: string
  error: string
  loading: boolean
  busy: string
  visible: AdCard[]
  requestScan: () => Promise<void>
  review: (ad: AdCard, status: 'approved' | 'rejected', notes: string) => Promise<void>
}) {
  const { status, competitor, names, message, error, loading, busy, visible, requestScan, review } = props
  return <section className="rounded-2xl border border-black/10 bg-white p-5" aria-label="竞品广告">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-bold">竞品广告</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-me-charcoal/70">向外部采集助手要一份正在投放的公开广告。助手写回的结果先停在待审，你通过之后才会进入竞品总览。</p>
      </div>
      <button type="button" onClick={() => void requestScan()} disabled={busy === 'request'} className="rounded-lg bg-me-charcoal px-3 py-2 text-sm font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-me-ochre disabled:opacity-50">{busy === 'request' ? '正在发送…' : '请求采集竞品广告'}</button>
    </div>
    {message && <p role="status" className="mt-3 rounded-lg bg-me-ivory px-3 py-2 text-sm">{message}</p>}
    <div className="mt-4 flex flex-wrap gap-3">
      <label className="text-sm font-bold">审核状态
        <select value={status} onChange={event => { props.setStatus(event.target.value as ReviewStatus); props.setCompetitor('') }} className="ml-2 rounded-lg border border-black/15 bg-white px-2 py-1 text-sm font-normal">
          {(Object.keys(STATUS_LABEL) as ReviewStatus[]).map(key => <option key={key} value={key}>{STATUS_LABEL[key]}</option>)}
        </select>
      </label>
      <label className="text-sm font-bold">竞品
        <select value={competitor} onChange={event => props.setCompetitor(event.target.value)} className="ml-2 rounded-lg border border-black/15 bg-white px-2 py-1 text-sm font-normal">
          <option value="">全部</option>
          {names.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
    </div>
    {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
    {loading ? <p className="mt-4 text-sm text-me-charcoal/60">正在读取广告…</p> : visible.length === 0 ? <p className="mt-4 rounded-xl bg-me-ivory p-4 text-sm text-me-charcoal/70">这一栏还没有{STATUS_LABEL[status]}广告。</p> : <div className="mt-4 space-y-3">{visible.map(ad => <AdCardView key={ad.id} ad={ad} busy={busy === ad.id} onReview={review} />)}</div>}
  </section>
}

function AdCardView({ ad, busy, onReview }: { ad: AdCard; busy: boolean; onReview: (ad: AdCard, status: 'approved' | 'rejected', notes: string) => Promise<void> }) {
  const [notes, setNotes] = useState(ad.review_notes ?? '')
  const facts = [
    ad.headline ? `标题：${ad.headline}` : '',
    ad.cta ? `按钮：${ad.cta}` : '',
    ad.offer_text ? `优惠/价格：${ad.offer_text}` : '',
    ad.platforms.length ? `平台：${ad.platforms.join('、')}` : '',
    ad.started_running_on ? `开始投放：${ad.started_running_on}` : '',
  ].filter(Boolean)
  return <article className="grid gap-3 rounded-xl bg-me-ivory/70 p-4 md:grid-cols-[180px_1fr]">
    {ad.screenshot_url ? <img src={ad.screenshot_url} alt={`${ad.competitor_name || '竞品'}的广告截图`} className="h-40 w-full rounded-lg bg-white object-contain" /> : <p className="flex h-40 items-center justify-center rounded-lg bg-white text-sm text-me-charcoal/50">没有截图</p>}
    <div>
      <h3 className="font-bold">{ad.competitor_name || '未填写竞品名'}</h3>
      <p className="mt-2 whitespace-pre-line text-sm leading-6">{ad.primary_text || '这条广告没有主文案。'}</p>
      {facts.length > 0 && <ul className="mt-2 space-y-1 text-sm text-me-charcoal/75">{facts.map(fact => <li key={fact}>{fact}</li>)}</ul>}
      <p className="mt-2 text-xs text-me-charcoal/55">观察于 {new Date(ad.observed_at).toLocaleString('zh-CN', { timeZone: 'Pacific/Auckland' })}{ad.landing_url ? <> · <a className="underline" href={ad.landing_url} target="_blank" rel="noreferrer">落地页</a></> : null}{ad.source_url ? <> · <a className="underline" href={ad.source_url} target="_blank" rel="noreferrer">广告库</a></> : null}</p>
      {ad.review_status === 'pending' && <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="min-w-48 flex-1 text-xs font-bold">备注
          <input value={notes} onChange={event => setNotes(event.target.value)} maxLength={2000} className="mt-1 w-full rounded-lg border border-black/15 px-2 py-1 text-sm font-normal" />
        </label>
        <button type="button" disabled={busy} onClick={() => void onReview(ad, 'approved', notes)} className="rounded-lg bg-me-charcoal px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">通过</button>
        <button type="button" disabled={busy} onClick={() => void onReview(ad, 'rejected', notes)} className="rounded-lg border border-me-charcoal px-3 py-1.5 text-xs font-bold disabled:opacity-50">驳回</button>
      </div>}
    </div>
  </article>
}
