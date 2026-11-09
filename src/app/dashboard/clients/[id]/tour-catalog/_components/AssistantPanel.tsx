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
  ProposalWarningView,
  TourPatchView,
} from './types'
import { assistantErrorLabel, proposalWarningText } from './catalog-format'

/** A proposal plus the frozen diff lines captured when the reply arrived. */
interface ProposalWithDiff extends AssistantProposalView {
  diffLines: string[]
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  proposals?: ProposalWithDiff[]
}

const HINT =
  '用大白话告诉我要改什么，比如：把 Silk Road 第 3 天的标题改成「乌鲁木齐 — 吐鲁番」。我会先列出要改的内容，你确认后才会保存。'

const FOOTER_HINT = 'AI 只会提建议，点「应用」后才会真正保存，并记入修改记录。AI 助手不改图片、搜索设置和评价。'

/** Field labels, matching the change log. */
const FIELD_LABELS: Record<string, string> = {
  name: '团名',
  title: '对外标题',
  displayPriceText: '展示价',
  price: '展示价',
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
  empty_patch: '这条没有可以改的内容',
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
  if (code.startsWith('invalid_price')) return '价格写法不对'
  return ERROR_LABELS[code] ?? code
}

/** Render a field-error as「字段：原因」, or just the reason when the field is '*'. */
function fieldErrorText(e: FieldErrorView): string {
  if (e.field === '*' || e.field === '') return errorLabel(e.code)
  return `${fieldLabel(e.field)}：${errorLabel(e.code)}`
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
// Diff-line computation (frozen at reply time)
// ---------------------------------------------------------------------------

function scalarChangeLine(field: string, before: unknown, after: unknown): string {
  return `${fieldLabel(field)}：${scalarText(before)} → ${scalarText(after)}`
}

function listChangeLine(field: string, before: unknown, after: unknown): string {
  const beforeLen = Array.isArray(before) ? before.length : 0
  const afterLen = Array.isArray(after) ? after.length : 0
  const delta = afterLen - beforeLen
  const sign = delta >= 0 ? '+' : '−'
  return `${fieldLabel(field)}：${sign} ${Math.abs(delta)} 项`
}

function itineraryChangeLines(
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

function tourPatchDiffLines(patch: TourPatchView, tour: CatalogTourView | undefined): string[] {
  const out: string[] = []
  for (const [field, after] of Object.entries(patch) as Array<[string, unknown]>) {
    if (field === 'itinerary') {
      const before = tour?.itinerary ?? []
      out.push(...itineraryChangeLines(before, (after as CatalogItineraryDayView[]) ?? []))
      continue
    }
    const before = tour ? (tour as unknown as Record<string, unknown>)[field] : undefined
    out.push(
      LIST_FIELDS.has(field)
        ? listChangeLine(field, before, after)
        : scalarChangeLine(field, before, after),
    )
  }
  return out
}

function departurePatchDiffLines(
  patch: DeparturePatchView,
  departure: CatalogDepartureView | undefined,
): string[] {
  const out: string[] = []
  for (const [field, after] of Object.entries(patch) as Array<[string, unknown]>) {
    const before = departure ? (departure as unknown as Record<string, unknown>)[field] : undefined
    const beforeText = field === 'status' ? statusLabel(scalarText(before)) : scalarText(before)
    const afterText = field === 'status' ? statusLabel(scalarText(after)) : scalarText(after)
    out.push(`${fieldLabel(field)}：${beforeText} → ${afterText}`)
  }
  return out
}

function createDepartureDiffLines(fields: NewDepartureView): string[] {
  const price = fields.priceTextOverride ? `，价格 ${fields.priceTextOverride}` : ''
  return [`新增班期 ${fields.departOn}，返程 ${fields.returnOn}，${statusLabel(fields.status)}${price}`]
}

/** Compute the frozen diff lines for a proposal using the current snapshot. */
function computeDiffLines(
  proposal: ProposalView,
  tours: CatalogTourView[],
  departures: CatalogDepartureView[],
): string[] {
  if (proposal.kind === 'update_tour') {
    return tourPatchDiffLines(proposal.patch, tours.find(t => t.id === proposal.tourId))
  }
  if (proposal.kind === 'update_departure') {
    return departurePatchDiffLines(
      proposal.patch,
      departureOf(departures, proposal.departureId),
    )
  }
  return createDepartureDiffLines(proposal.fields)
}

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

const warningText = proposalWarningText

function WarningBox({
  warnings,
  confirmed,
  onToggle,
}: {
  warnings: ProposalWarningView[]
  confirmed: boolean
  onToggle: (next: boolean) => void
}) {
  return (
    <div className="mt-2 rounded-lg border border-[#C2453A]/30 bg-[#C2453A]/8 p-2">
      <ul className="space-y-0.5">
        {warnings.map((w, i) => (
          <li key={`${w.code}-${i}`} className="text-xs font-semibold text-[#C2453A]">
            {warningText(w)}
          </li>
        ))}
      </ul>
      <label className="mt-2 flex items-center gap-2 text-xs font-black text-[#C2453A]">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={e => onToggle(e.target.checked)}
        />
        我看过了，确认这样改
      </label>
    </div>
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
  applyingAll,
  confirmed,
  onConfirmChange,
  onApplied,
}: {
  clientId: string
  item: ProposalWithDiff
  tours: CatalogTourView[]
  departures: CatalogDepartureView[]
  applied: boolean
  externalResult?: ApplyResult
  /** Latest known updatedAt per row from earlier applies in this session (beats the snapshot). */
  fresh: Record<string, string>
  applyingAll: boolean
  /** Warning confirmation lives in the panel so「全部应用」can see it too. */
  confirmed: boolean
  onConfirmChange: (next: boolean) => void
  onApplied: (result: ApplyResult) => void
}) {
  const [busy, setBusy] = useState(false)
  const [ownResult, setOwnResult] = useState<ApplyResult | null>(null)
  const { proposal, check, diffLines } = item
  const name = tourName(tours, proposal.tourId)
  const result = ownResult ?? externalResult ?? null
  const warnings = check.ok ? check.warnings ?? [] : []
  const needsConfirm = warnings.length > 0
  const canApply = check.ok && (!needsConfirm || confirmed)

  const apply = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setOwnResult(null)
    try {
      const res = await applyProposal(clientId, proposal, tours, departures, fresh)
      setOwnResult(res)
      if (res.ok) onApplied(res)
    } finally {
      setBusy(false)
    }
  }, [busy, clientId, proposal, tours, departures, onApplied, fresh])

  return (
    <div className="mt-3 rounded-lg border border-black/10 bg-me-ivory/60 p-3">
      <p className="text-sm font-black text-me-charcoal">{name}</p>
      <p className="text-sm font-semibold text-me-charcoal/70">{proposal.summary}</p>

      {proposal.kind === 'update_departure' && (
        <p className="mt-2 text-sm font-black text-me-charcoal/70">
          班期 {departureOf(departures, proposal.departureId)?.departOn ?? proposal.departureId}
        </p>
      )}

      <ul className="mt-2 space-y-1">
        {diffLines.map((line, i) => (
          <li key={`${i}-${line}`} className="text-sm font-semibold text-me-charcoal/70">
            {line}
          </li>
        ))}
      </ul>

      {!check.ok && (
        <div className="mt-2 rounded-lg border border-[#C2453A]/30 bg-[#C2453A]/8 p-2">
          <p className="text-sm font-black text-[#C2453A]">这条改不了：</p>
          <ul className="mt-1 space-y-0.5">
            {check.errors.map((e, i) => (
              <li key={`${e.field}-${i}`} className="text-xs font-semibold text-[#C2453A]">
                {fieldErrorText(e)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {check.ok && needsConfirm && (
        <WarningBox warnings={warnings} confirmed={confirmed} onToggle={onConfirmChange} />
      )}

      {check.ok && (
        <div className="mt-2 flex items-center gap-2">
          {applied ? (
            <span className="text-sm font-black text-[#5C8A4A]">已应用</span>
          ) : (
            <button
              type="button"
              onClick={apply}
              disabled={busy || applyingAll || !canApply}
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
              {result.errors.map(fieldErrorText).join('；')}
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
    res = await fetch(`${base}/tours/${proposal.tourId}?via=assistant`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedUpdatedAt: fresh[proposal.tourId] ?? tour?.updatedAt,
        patch: proposal.patch,
      }),
    })
  } else if (proposal.kind === 'update_departure') {
    const dep = departures.find(d => d.id === proposal.departureId)
    res = await fetch(`${base}/departures/${proposal.departureId}?via=assistant`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tourId: proposal.tourId,
        expectedUpdatedAt: fresh[proposal.departureId] ?? dep?.updatedAt,
        patch: proposal.patch,
      }),
    })
  } else {
    res = await fetch(`${base}/tours/${proposal.tourId}/departures?via=assistant`, {
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
    if (proposal.kind === 'update_tour') {
      return { ok: false, message: '这个团刚被别人改过，请刷新页面后再让我改' }
    }
    return { ok: false, message: '这个班期刚被别人改过，请刷新页面后再让我改' }
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
  /** Has an unconfirmed warning: skipped by「全部应用」until the PM ticks the box. */
  needsConfirm: boolean
}

function patchKeysOverlap(a: TourPatchView, b: TourPatchView): boolean {
  const aKeys = Object.keys(a)
  return Object.keys(b).some(k => aKeys.includes(k))
}

/** Merge consecutive update_tour proposals for the same tour into one PATCH, unless their patch keys overlap. */
function buildApplyUnits(
  messages: ChatMessage[],
  appliedKeys: Set<string>,
  confirmedKeys: Set<string>,
): ApplyUnit[] {
  const units: ApplyUnit[] = []
  for (const m of messages) {
    if (!m.proposals) continue
    for (let i = 0; i < m.proposals.length; i++) {
      const item = m.proposals[i]
      const key = `${messages.indexOf(m)}-${i}`
      if (!item.check.ok || appliedKeys.has(key)) continue
      const hasWarnings = (item.check.warnings?.length ?? 0) > 0
      const needsConfirm = hasWarnings && !confirmedKeys.has(key)
      const last = units[units.length - 1]
      if (
        last &&
        !hasWarnings &&
        !last.needsConfirm &&
        last.proposal.kind === 'update_tour' &&
        item.proposal.kind === 'update_tour' &&
        last.proposal.tourId === item.proposal.tourId &&
        !patchKeysOverlap(last.proposal.patch, item.proposal.patch)
      ) {
        last.proposal = {
          ...last.proposal,
          patch: { ...last.proposal.patch, ...item.proposal.patch },
        }
        last.keys.push(key)
      } else {
        units.push({ keys: [key], proposal: item.proposal, needsConfirm })
      }
    }
  }
  return units
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

/** Append applied/unapplied markers for a message's proposals to its history content. */
function historyContent(m: ChatMessage, index: number, appliedKeys: Set<string>): string {
  if (!m.proposals || m.proposals.length === 0) return m.content
  const lines = m.proposals.map((p, i) => {
    const key = `${index}-${i}`
    const state = appliedKeys.has(key) ? '已应用' : '未应用'
    return `[建议] ${p.proposal.summary} — ${state}`
  })
  return `${m.content}\n${lines.join('\n')}`
}

export function AssistantPanel({
  clientId,
  tours,
  departures,
  onApplied,
  focusTourId = null,
}: {
  /** The tour open in the page; sent with each message so "the departure date" means this tour. */
  focusTourId?: string | null
  clientId: string
  tours: CatalogTourView[]
  departures: CatalogDepartureView[]
  onApplied: () => void
}) {
  const focusTourName = tours.find(t => t.id === focusTourId)?.name ?? null
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [applyingAll, setApplyingAll] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [appliedKeys, setAppliedKeys] = useState<Set<string>>(new Set())
  const [freshUpdatedAt, setFreshUpdatedAt] = useState<Record<string, string>>({})
  const [confirmedKeys, setConfirmedKeys] = useState<Set<string>>(new Set())
  const setConfirmedKey = useCallback((key: string, next: boolean) => {
    setConfirmedKeys(prev => {
      const out = new Set(prev)
      if (next) out.add(key)
      else out.delete(key)
      return out
    })
  }, [])
  const [cardResults, setCardResults] = useState<Record<string, ApplyResult>>({})
  const [ignoredCount, setIgnoredCount] = useState(0)
  const [skippedWarningCount, setSkippedWarningCount] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const send = useCallback(async () => {
    const text = input.trim()
    if (text === '' || busy) return
    const history = messages.map((m, mi) => ({
      role: m.role,
      content: m.role === 'assistant' ? historyContent(m, mi, appliedKeys) : m.content,
    }))
    setMessages(prev => [...prev, { role: 'user', content: text }])
    setInput('')
    setBusy(true)
    setError(null)
    setSkippedWarningCount(0)
    try {
      const res = await fetch(`/api/clients/${clientId}/tour-catalog/assistant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history, focusTourId }),
      })
      if (!res.ok) {
        const { error: code } = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(assistantErrorLabel(code, res.status))
      }
      const data = (await res.json()) as AssistantReplyView
      setIgnoredCount(data.ignoredCount ?? 0)
      const proposals: ProposalWithDiff[] = data.proposals.map(p => ({
        ...p,
        diffLines: computeDiffLines(p.proposal, tours, departures),
      }))
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: data.reply, proposals },
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      requestAnimationFrame(() => {
        listRef.current?.scrollTo?.({ top: listRef.current.scrollHeight })
      })
    }
  }, [clientId, input, busy, messages, appliedKeys, tours, departures])

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

  const unappliedValidCount = messages.reduce((n, m, mi) => {
    if (!m.proposals) return n
    return (
      n +
      m.proposals.filter((p, i) => p.check.ok && !appliedKeys.has(`${mi}-${i}`)).length
    )
  }, 0)

  const applyAll = useCallback(async () => {
    if (applyingAll) return
    const units = buildApplyUnits(messages, appliedKeys, confirmedKeys)
    let fresh = freshUpdatedAt
    let skipped = 0
    setApplyingAll(true)
    try {
      for (const unit of units) {
        if (unit.needsConfirm) {
          skipped += unit.keys.length
          continue
        }
        const res = await applyProposal(clientId, unit.proposal, tours, departures, fresh)
        if (res.ok) {
          fresh = mergeFresh(fresh, res)
          markApplied(unit.keys)
        }
        recordResult(unit.keys, res)
      }
    } finally {
      setApplyingAll(false)
    }
    setFreshUpdatedAt(fresh)
    setSkippedWarningCount(skipped)
    onApplied()
  }, [
    applyingAll,
    messages,
    appliedKeys,
    confirmedKeys,
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
              {m.role === 'assistant' && i === messages.length - 1 && ignoredCount > 0 && (
                <p className="mt-1 text-xs font-semibold text-me-charcoal/40">
                  有 {ignoredCount} 条建议我没看懂，已忽略
                </p>
              )}
              {m.proposals?.map((item, j) => {
                const key = `${i}-${j}`
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
                    applyingAll={applyingAll}
                    confirmed={confirmedKeys.has(key)}
                    onConfirmChange={next => setConfirmedKey(key, next)}
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

      {unappliedValidCount >= 2 && (
        <button
          type="button"
          onClick={() => { void applyAll() }}
          disabled={applyingAll}
          className="rounded-lg border border-black/10 bg-white px-3 py-1 text-xs font-black text-me-charcoal hover:bg-me-ivory disabled:opacity-40"
        >
          全部应用
        </button>
      )}

      {skippedWarningCount > 0 && (
        <p className="text-xs font-semibold text-me-charcoal/55">
          有 {skippedWarningCount} 条需要你先勾选确认
        </p>
      )}

      {focusTourName !== null && (
        <p className="text-xs font-semibold text-me-charcoal/55">
          当前打开：{focusTourName}。没点名的修改，默认改这个团。
        </p>
      )}
      <textarea
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={3}
        placeholder="用大白话告诉我要改什么…"
        className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal focus:outline-none focus:ring-2 focus:ring-me-charcoal/20"
      />
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => { void send() }}
          disabled={busy || input.trim() === ''}
          className="whitespace-nowrap rounded-lg bg-me-charcoal px-4 py-2 text-sm font-black text-white hover:bg-me-charcoal/85 disabled:cursor-not-allowed disabled:opacity-40"
        >
          发送
        </button>
        <span className="min-w-0 text-xs font-semibold text-me-charcoal/40">{FOOTER_HINT}</span>
      </div>
    </div>
  )
}
