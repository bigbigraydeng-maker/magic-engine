'use client'

/**
 * AI assistant panel — admin types a plain-language request, the assistant
 * replies with proposal cards. Nothing is saved until the admin clicks apply.
 */

import { useCallback, useRef, useState } from 'react'
import type {
  AssistantProposalView,
  AssistantReplyView,
  CatalogDepartureView,
  CatalogItineraryDayView,
  CatalogTourView,
  DeparturePatchView,
  FieldErrorView,
  NewDepartureView,
  ProposalView,
  TourPatchView,
} from './types'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  proposals?: AssistantProposalView[]
}

const HINT =
  '用大白话告诉我要改什么，比如：把 Silk Road 第 3 天的标题改成「乌鲁木齐 — 吐鲁番」。我会先列出要改的内容，你确认后才会保存。'

const FOOTER_HINT = 'AI 只会提建议，点「应用」后才会真正保存，并记入修改记录。'

/** Field labels, matching the change log. */
const FIELD_LABELS: Record<string, string> = {
  name: '团名',
  title: '对外标题',
  displayPriceText: '展示价',
  durationText: '天数',
  shortDescription: '简介',
  highlights: '亮点',
  itinerary: '行程',
  inclusions: '包含',
  exclusions: '不包含',
  tourCities: '途经城市',
  singleSupplement: '单人房差',
  maxGroupSize: '最多人数',
  isActive: '在售',
  managesDepartures: '管理班期',
  returnOn: '返程',
  status: '状态',
  priceTextOverride: '价格',
}

/** Field-error codes, matching the editors. */
const ERROR_LABELS: Record<string, string> = {
  required: '必填',
  too_long: '太长了',
  invalid_price: '价格写法不对',
  invalid_price_text: '价格写法不对',
  invalid_date: '日期要写成 2027-05-13 这样',
  return_before_depart: '返程不能早于出团',
  non_consecutive_days: '行程天数要从第 1 天开始连续',
  duplicate_day: '行程天数有重复',
  tour_not_found: '找不到这个团',
  departure_not_found: '找不到这个班期',
  field_not_editable: '这项不能改',
  depart_on_not_editable: '出团日不能改',
}

const STATUS_LABELS: Record<string, string> = {
  open: '可订',
  limited: '少量余位',
  sold_out: '已满团',
  closed: '已关闭',
  cancelled: '已取消',
}

const LIST_FIELDS = new Set(['highlights', 'inclusions', 'exclusions', 'tourCities'])

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field
}

function errorLabel(code: string): string {
  return ERROR_LABELS[code] ?? code
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status
}

/** Render a scalar value for display; booleans as 是/否, null/empty as 空. */
function scalarText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '空'
  if (typeof value === 'boolean') return value ? '是' : '否'
  return String(value)
}

function tourName(tours: CatalogTourView[], tourId: string): string {
  return tours.find(t => t.id === tourId)?.name ?? tourId
}

function departureOf(
  departures: CatalogDepartureView[],
  departureId: string,
): CatalogDepartureView | undefined {
  return departures.find(d => d.id === departureId)
}

// ---------------------------------------------------------------------------
// Before/after rendering
// ---------------------------------------------------------------------------

function ScalarChange({ field, before, after }: { field: string; before: unknown; after: unknown }) {
  return (
    <li className="text-sm font-semibold text-me-charcoal/70">
      {fieldLabel(field)}：{scalarText(before)} → {scalarText(after)}
    </li>
  )
}

function ListChange({ field, before, after }: { field: string; before: unknown; after: unknown }) {
  const beforeLen = Array.isArray(before) ? before.length : 0
  const afterLen = Array.isArray(after) ? after.length : 0
  const delta = afterLen - beforeLen
  const sign = delta >= 0 ? '+' : '−'
  return (
    <li className="text-sm font-semibold text-me-charcoal/70">
      {fieldLabel(field)}：{sign} {Math.abs(delta)} 项
    </li>
  )
}

function itineraryChangeText(
  before: CatalogItineraryDayView[],
  after: CatalogItineraryDayView[],
): string[] {
  const beforeByDay = new Map(before.map(d => [d.day, d]))
  const afterByDay = new Map(after.map(d => [d.day, d]))
  const days = Array.from(new Set([...beforeByDay.keys(), ...afterByDay.keys()])).sort((a, b) => a - b)
  const out: string[] = []
  for (const day of days) {
    const b = beforeByDay.get(day)
    const a = afterByDay.get(day)
    if (!b && a) out.push(`第 ${day} 天：新增`)
    else if (b && !a) out.push(`第 ${day} 天：删除`)
    else if (b && a) {
      if (b.title !== a.title) out.push(`第 ${day} 天：标题 ${b.title} → ${a.title}`)
      else if (b.description !== a.description) out.push(`第 ${day} 天：内容已修改`)
    }
  }
  return out
}

function TourPatchChanges({
  patch,
  tour,
}: {
  patch: TourPatchView
  tour: CatalogTourView | undefined
}) {
  const entries = Object.entries(patch) as Array<[string, unknown]>
  return (
    <ul className="mt-2 space-y-1">
      {entries.map(([field, after]) => {
        if (field === 'itinerary') {
          const before = tour?.itinerary ?? []
          const lines = itineraryChangeText(before, (after as CatalogItineraryDayView[]) ?? [])
          return lines.map(line => (
            <li key={`itinerary-${line}`} className="text-sm font-semibold text-me-charcoal/70">
              {line}
            </li>
          ))
        }
        const before = tour ? (tour as unknown as Record<string, unknown>)[field] : undefined
        if (LIST_FIELDS.has(field)) {
          return <ListChange key={field} field={field} before={before} after={after} />
        }
        return <ScalarChange key={field} field={field} before={before} after={after} />
      })}
    </ul>
  )
}

function DeparturePatchChanges({
  patch,
  departure,
}: {
  patch: DeparturePatchView
  departure: CatalogDepartureView | undefined
}) {
  const entries = Object.entries(patch) as Array<[string, unknown]>
  return (
    <ul className="mt-2 space-y-1">
      {entries.map(([field, after]) => {
        const before = departure ? (departure as unknown as Record<string, unknown>)[field] : undefined
        const beforeText = field === 'status' ? statusLabel(scalarText(before)) : scalarText(before)
        const afterText = field === 'status' ? statusLabel(scalarText(after)) : scalarText(after)
        return (
          <li key={field} className="text-sm font-semibold text-me-charcoal/70">
            {fieldLabel(field)}：{beforeText} → {afterText}
          </li>
        )
      })}
    </ul>
  )
}

function CreateDepartureSummary({ fields }: { fields: NewDepartureView }) {
  const price = fields.priceTextOverride ? `，价格 ${fields.priceTextOverride}` : ''
  return (
    <p className="mt-2 text-sm font-semibold text-me-charcoal/70">
      新增班期 {fields.departOn}，返程 {fields.returnOn}，{statusLabel(fields.status)}
      {price}
    </p>
  )
}

// ---------------------------------------------------------------------------
// Proposal card
// ---------------------------------------------------------------------------

interface ApplyResult {
  ok: boolean
  message?: string
  errors?: FieldErrorView[]
  tour?: CatalogTourView
  departure?: CatalogDepartureView
}

function ProposalCard({
  clientId,
  item,
  tours,
  departures,
  applied,
  externalResult,
  fresh,
  onApplied,
}: {
  clientId: string
  item: AssistantProposalView
  tours: CatalogTourView[]
  departures: CatalogDepartureView[]
  applied: boolean
  externalResult?: ApplyResult
  /** Latest known updatedAt per row from earlier applies in this session (beats the snapshot). */
  fresh: Record<string, string>
  onApplied: (result: ApplyResult) => void
}) {
  const [busy, setBusy] = useState(false)
  const [ownResult, setOwnResult] = useState<ApplyResult | null>(null)
  const { proposal, check } = item
  const name = tourName(tours, proposal.tourId)
  const result = ownResult ?? externalResult ?? null

  const apply = useCallback(async () => {
    setBusy(true)
    setOwnResult(null)
    try {
      const res = await applyProposal(clientId, proposal, tours, departures, fresh)
      setOwnResult(res)
      if (res.ok) onApplied(res)
    } finally {
      setBusy(false)
    }
  }, [clientId, proposal, tours, departures, onApplied, fresh])

  return (
    <div className="mt-3 rounded-lg border border-black/10 bg-me-ivory/60 p-3">
      <p className="text-sm font-black text-me-charcoal">{name}</p>
      <p className="text-sm font-semibold text-me-charcoal/70">{proposal.summary}</p>

      {proposal.kind === 'update_tour' && (
        <TourPatchChanges patch={proposal.patch} tour={tours.find(t => t.id === proposal.tourId)} />
      )}
      {proposal.kind === 'update_departure' && (
        <>
          <p className="mt-2 text-sm font-black text-me-charcoal/70">
            班期 {departureOf(departures, proposal.departureId)?.departOn ?? proposal.departureId}
          </p>
          <DeparturePatchChanges
            patch={proposal.patch}
            departure={departureOf(departures, proposal.departureId)}
          />
        </>
      )}
      {proposal.kind === 'create_departure' && <CreateDepartureSummary fields={proposal.fields} />}

      {!check.ok && (
        <div className="mt-2 rounded-lg border border-[#C2453A]/30 bg-[#C2453A]/8 p-2">
          <p className="text-sm font-black text-[#C2453A]">这条改不了：</p>
          <ul className="mt-1 space-y-0.5">
            {check.errors.map((e, i) => (
              <li key={`${e.field}-${i}`} className="text-xs font-semibold text-[#C2453A]">
                {fieldLabel(e.field)}：{errorLabel(e.code)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {check.ok && (
        <div className="mt-2 flex items-center gap-2">
          {applied ? (
            <span className="text-sm font-black text-[#5C8A4A]">已应用</span>
          ) : (
            <button
              onClick={apply}
              disabled={busy}
              className="rounded-lg bg-me-charcoal px-3 py-1 text-xs font-black text-white hover:bg-me-charcoal/85 disabled:opacity-40"
            >
              {busy ? '正在保存…' : '应用这条'}
            </button>
          )}
          {result && !result.ok && result.message && (
            <span className="text-xs font-black text-[#C2453A]">{result.message}</span>
          )}
          {result && !result.ok && result.errors && (
            <span className="text-xs font-black text-[#C2453A]">
              {result.errors.map(e => `${fieldLabel(e.field)}：${errorLabel(e.code)}`).join('；')}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Apply helpers
// ---------------------------------------------------------------------------

async function applyProposal(
  clientId: string,
  proposal: ProposalView,
  tours: CatalogTourView[],
  departures: CatalogDepartureView[],
  fresh: Record<string, string>,
): Promise<ApplyResult> {
  const base = `/api/clients/${clientId}/tour-catalog`
  let res: Response
  if (proposal.kind === 'update_tour') {
    const tour = tours.find(t => t.id === proposal.tourId)
    res = await fetch(`${base}/tours/${proposal.tourId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedUpdatedAt: fresh[proposal.tourId] ?? tour?.updatedAt,
        patch: proposal.patch,
      }),
    })
  } else if (proposal.kind === 'update_departure') {
    const dep = departures.find(d => d.id === proposal.departureId)
    res = await fetch(`${base}/departures/${proposal.departureId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tourId: proposal.tourId,
        expectedUpdatedAt: fresh[proposal.departureId] ?? dep?.updatedAt,
        patch: proposal.patch,
      }),
    })
  } else {
    res = await fetch(`${base}/tours/${proposal.tourId}/departures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(proposal.fields),
    })
  }

  if (res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      tour?: CatalogTourView
      departure?: CatalogDepartureView
    }
    return { ok: true, tour: body.tour, departure: body.departure }
  }

  const body = (await res.json().catch(() => ({}))) as {
    error?: string
    errors?: FieldErrorView[]
  }
  if (res.status === 409 && body.error === 'duplicate_departure') {
    return { ok: false, message: '这一天已经有班期了' }
  }
  if (res.status === 409) {
    return { ok: false, message: '这个团刚被别人改过，请刷新页面后再让我改' }
  }
  if (res.status === 400 && body.errors) {
    return { ok: false, errors: body.errors }
  }
  return { ok: false, message: '保存失败，请稍后重试' }
}

/** Merge the returned row's id/updatedAt into the fresh map. */
function mergeFresh(
  fresh: Record<string, string>,
  result: ApplyResult,
): Record<string, string> {
  if (result.tour?.updatedAt) return { ...fresh, [result.tour.id]: result.tour.updatedAt }
  if (result.departure?.updatedAt) {
    return { ...fresh, [result.departure.id]: result.departure.updatedAt }
  }
  return fresh
}

/** A runnable unit of applyAll: one or more proposal keys sharing a single PATCH. */
interface ApplyUnit {
  keys: string[]
  proposal: ProposalView
}

/** Merge consecutive update_tour proposals for the same tour into one PATCH. */
function buildApplyUnits(messages: ChatMessage[], appliedKeys: Set<string>): ApplyUnit[] {
  const units: ApplyUnit[] = []
  for (const m of messages) {
    if (!m.proposals) continue
    for (let i = 0; i < m.proposals.length; i++) {
      const item = m.proposals[i]
      const key = `${m.content}-${i}`
      if (!item.check.ok || appliedKeys.has(key)) continue
      const last = units[units.length - 1]
      if (
        last &&
        last.proposal.kind === 'update_tour' &&
        item.proposal.kind === 'update_tour' &&
        last.proposal.tourId === item.proposal.tourId
      ) {
        last.proposal = {
          ...last.proposal,
          patch: { ...last.proposal.patch, ...item.proposal.patch },
        }
        last.keys.push(key)
      } else {
        units.push({ keys: [key], proposal: item.proposal })
      }
    }
  }
  return units
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

function assistantErrorLabel(code: string): string {
  if (code === 'assistant_truncated') return '这个改动太长，AI 一次没写完，请拆成几步再说'
  if (code === 'assistant_unavailable') return 'AI 助手暂时用不了，请稍后再试'
  return code
}

export function AssistantPanel({
  clientId,
  tours,
  departures,
  onApplied,
}: {
  clientId: string
  tours: CatalogTourView[]
  departures: CatalogDepartureView[]
  onApplied: () => void
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [appliedKeys, setAppliedKeys] = useState<Set<string>>(new Set())
  const [freshUpdatedAt, setFreshUpdatedAt] = useState<Record<string, string>>({})
  const [cardResults, setCardResults] = useState<Record<string, ApplyResult>>({})
  const listRef = useRef<HTMLDivElement>(null)

  const send = useCallback(async () => {
    const text = input.trim()
    if (text === '' || busy) return
    const history = messages.map(m => ({ role: m.role, content: m.content }))
    setMessages(prev => [...prev, { role: 'user', content: text }])
    setInput('')
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/tour-catalog/assistant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history }),
      })
      if (!res.ok) {
        const { error: code } = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(assistantErrorLabel(code ?? `HTTP ${res.status}`))
      }
      const data = (await res.json()) as AssistantReplyView
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: data.reply, proposals: data.proposals },
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      requestAnimationFrame(() => {
        listRef.current?.scrollTo?.({ top: listRef.current.scrollHeight })
      })
    }
  }, [clientId, input, busy, messages])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  const markApplied = useCallback((keys: string[]) => {
    setAppliedKeys(prev => {
      const next = new Set(prev)
      for (const k of keys) next.add(k)
      return next
    })
  }, [])

  const recordResult = useCallback((keys: string[], result: ApplyResult) => {
    setCardResults(prev => {
      const next = { ...prev }
      for (const k of keys) next[k] = result
      return next
    })
  }, [])

  const handleCardApplied = useCallback(
    (key: string, result: ApplyResult) => {
      markApplied([key])
      recordResult([key], result)
      setFreshUpdatedAt(prev => mergeFresh(prev, result))
      onApplied()
    },
    [markApplied, recordResult, onApplied],
  )

  const validCount = messages.reduce(
    (n, m) => n + (m.proposals?.filter(p => p.check.ok).length ?? 0),
    0,
  )

  const applyAll = useCallback(async () => {
    const units = buildApplyUnits(messages, appliedKeys)
    let fresh = freshUpdatedAt
    for (const unit of units) {
      const res = await applyProposal(clientId, unit.proposal, tours, departures, fresh)
      if (res.ok) {
        fresh = mergeFresh(fresh, res)
        markApplied(unit.keys)
      }
      recordResult(unit.keys, res)
    }
    setFreshUpdatedAt(fresh)
    onApplied()
  }, [
    messages,
    appliedKeys,
    freshUpdatedAt,
    clientId,
    tours,
    departures,
    markApplied,
    recordResult,
    onApplied,
  ])

  return (
    <div className="space-y-3 rounded-xl border border-black/10 bg-white p-5 shadow-sm">
      <h2 className="font-display font-black text-me-charcoal">AI 助手</h2>
      <p className="text-sm font-semibold text-me-charcoal/55">{HINT}</p>

      <div
        ref={listRef}
        className="max-h-[60vh] space-y-3 overflow-y-auto rounded-lg bg-me-ivory/40 p-3"
      >
        {messages.length === 0 && (
          <p className="text-sm font-semibold text-me-charcoal/40">还没有对话，先说一句试试。</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div
              className={
                m.role === 'user'
                  ? 'max-w-[85%] rounded-lg bg-me-charcoal px-3 py-2 text-sm font-semibold text-white'
                  : 'max-w-[95%] rounded-lg bg-white px-3 py-2 text-sm font-semibold text-me-charcoal shadow-sm'
              }
            >
              <p className="whitespace-pre-wrap">{m.content}</p>
              {m.proposals?.map((item, j) => {
                const key = `${m.content}-${j}`
                return (
                  <ProposalCard
                    key={key}
                    clientId={clientId}
                    item={item}
                    tours={tours}
                    departures={departures}
                    applied={appliedKeys.has(key)}
                    externalResult={cardResults[key]}
                    fresh={freshUpdatedAt}
                    onApplied={result => handleCardApplied(key, result)}
                  />
                )
              })}
            </div>
          </div>
        ))}
        {busy && <p className="text-sm font-semibold text-me-charcoal/40">正在想…</p>}
      </div>

      {error && <p className="text-sm font-black text-[#C2453A]">{error}</p>}

      {validCount >= 2 && (
        <button
          onClick={() => { void applyAll() }}
          className="rounded-lg border border-black/10 bg-white px-3 py-1 text-xs font-black text-me-charcoal hover:bg-me-ivory"
        >
          全部应用
        </button>
      )}

      <textarea
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={3}
        placeholder="用大白话告诉我要改什么…"
        className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal focus:outline-none focus:ring-2 focus:ring-me-charcoal/20"
      />
      <div className="flex items-center justify-between">
        <button
          onClick={() => { void send() }}
          disabled={busy || input.trim() === ''}
          className="rounded-lg bg-me-charcoal px-4 py-2 text-sm font-black text-white hover:bg-me-charcoal/85 disabled:cursor-not-allowed disabled:opacity-40"
        >
          发送
        </button>
        <span className="text-xs font-semibold text-me-charcoal/40">{FOOTER_HINT}</span>
      </div>
    </div>
  )
}
