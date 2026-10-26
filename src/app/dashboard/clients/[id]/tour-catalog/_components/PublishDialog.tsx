'use client'

import { useEffect, useState } from 'react'
import type {
  FirstPublishRow,
  PublishPreviewResponse,
  PublishResponse,
  PublishRequest,
} from '@/lib/tour-catalog/publish-contract'
import type { PublishContributor } from '@/lib/tour-catalog/catalog-contract'
import { priceText } from './catalog-format'
import { SYSTEM_ACTOR_LABEL } from './change-source'
import { BRAND_BUTTON_CLASS } from './catalog-brand'
import { useChannelsConnected } from './catalog-context'
import type { IncompleteNewTour } from './incomplete-new-tours'
import {
  AckCheckbox,
  ChangeList,
  DialogShell,
  RiskLegend,
  SellableCountConfirm,
  STALE_TEXT,
  publishErrorText,
  sellableConfirmed,
} from './publish-parts'

function FirstPublishTable(props: { rows: FirstPublishRow[] }): JSX.Element {
  const { rows } = props
  const outward = useChannelsConnected() ? '对外' : ''
  const sellableCount = rows.filter(r => r.sellable).length
  return (
    <div>
      <p className="text-sm font-black text-me-charcoal">
        首次上架：共 {rows.length} 个团，其中 {sellableCount} 个{outward}可售
      </p>
      <div className="mt-2 max-h-[50vh] overflow-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-me-charcoal/55">
              <th className="px-2 py-1 font-semibold">团名</th>
              <th className="px-2 py-1 font-semibold">展示价</th>
              <th className="px-2 py-1 font-semibold">未来班期数</th>
              <th className="px-2 py-1 font-semibold">下一班</th>
              <th className="px-2 py-1 font-semibold">是否{outward}可售</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.tourId} className="border-t border-black/10">
                <td className="px-2 py-1 font-semibold text-me-charcoal">{row.tourName}</td>
                <td className="px-2 py-1 text-me-charcoal/70">{priceText(row.displayPriceText)}</td>
                <td className="px-2 py-1 text-me-charcoal/70">{row.upcomingDepartures}</td>
                <td className="px-2 py-1 text-me-charcoal/70">
                  {row.nextDepartOn ?? '无固定班期'}
                </td>
                <td className="px-2 py-1 text-me-charcoal/70">
                  {row.sellable ? '可售' : '不可售'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function IncompleteNewToursWarning(props: {
  incomplete: IncompleteNewTour[]
  ack: boolean
  onAck: (v: boolean) => void
}): JSX.Element | null {
  if (props.incomplete.length === 0) return null
  return (
    <div data-testid="incomplete-new-tours" className="rounded-lg border border-[#C2453A]/30 bg-[#C2453A]/5 p-3">
      <p className="text-sm font-black text-[#C2453A]">
        这次要上架的新团里，有 {props.incomplete.length} 个还没补齐（规矩：补齐再上架）
      </p>
      <ul className="mt-1 space-y-0.5">
        {props.incomplete.map(t => (
          <li key={t.tourId} className="break-words text-sm font-semibold text-me-charcoal/80">
            {t.tourName}：缺 {t.missing.join('、')}
          </li>
        ))}
      </ul>
      <AckCheckbox checked={props.ack} onChange={props.onAck}>
        我知道这些新团还没补齐，PM 已同意先上架
      </AckCheckbox>
    </div>
  )
}

function PublishGates(props: {
  preview: PublishPreviewResponse
  ackHigh: boolean
  setAckHigh: (v: boolean) => void
  ackRevert: boolean
  setAckRevert: (v: boolean) => void
  countText: string
  setCountText: (v: string) => void
  incomplete: IncompleteNewTour[]
  ackIncomplete: boolean
  setAckIncomplete: (v: boolean) => void
}): JSX.Element {
  const { preview, ackHigh, setAckHigh, ackRevert, setAckRevert, countText, setCountText } = props
  const live = useChannelsConnected() ? '对外内容' : '已上架的内容'
  return (
    <>
      <IncompleteNewToursWarning
        incomplete={props.incomplete}
        ack={props.ackIncomplete}
        onAck={props.setAckIncomplete}
      />
      {preview.highRiskCount > 0 ? (
        <AckCheckbox checked={ackHigh} onChange={setAckHigh}>
          我已核对上面标红的 {preview.highRiskCount} 处价格和班期改动
        </AckCheckbox>
      ) : null}
      {preview.afterRevert ? (
        <AckCheckbox checked={ackRevert} onChange={setAckRevert}>
          我知道上一次是把{live}换回了第 {preview.afterRevert.toVersion}{' '}
          版，这次上架会把当时换掉的内容重新发出去
        </AckCheckbox>
      ) : null}
      <SellableCountConfirm
        sellable={preview.sellable}
        value={countText}
        onChange={setCountText}
        firstPublish={preview.firstPublish}
      />
    </>
  )
}

function buildRequest(
  preview: PublishPreviewResponse,
  ackHigh: boolean,
  ackRevert: boolean,
  countText: string,
  note: string,
): PublishRequest {
  return {
    draftVersion: preview.draftVersion,
    publishedVersion: preview.publishedVersion,
    diffHash: preview.diffHash,
    acknowledgeHighRisk: ackHigh,
    acknowledgeAfterRevert: ackRevert,
    confirmSellableCount: preview.sellable.needsCountConfirm ? Number(countText.trim()) : null,
    note: note.trim(),
  }
}

function usePublishSubmit(
  clientId: string,
  preview: PublishPreviewResponse,
  onRefresh: () => void | Promise<void>,
  onPublished: (websiteSync: PublishResponse['websiteSync']) => void,
  ackHigh: boolean,
  ackRevert: boolean,
  countText: string,
  note: string,
): { submitting: boolean; message: string | null; submit: () => Promise<void> } {
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const connected = useChannelsConnected()

  async function submit() {
    setSubmitting(true)
    setMessage(null)
    const body = buildRequest(preview, ackHigh, ackRevert, countText, note)
    try {
      const res = await fetch(`/api/clients/${clientId}/tour-catalog/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as Partial<PublishResponse>
        const websiteSync = data.websiteSync === 'revalidated' || data.websiteSync === 'failed'
          ? data.websiteSync
          : 'not_configured'
        onPublished(websiteSync)
        return
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (res.status === 409 || data.error === 'stale') {
        setMessage(STALE_TEXT)
        await onRefresh()
      } else {
        setMessage(publishErrorText(data.error, connected))
      }
    } catch {
      setMessage(publishErrorText('publish_failed', connected))
    } finally {
      setSubmitting(false)
    }
  }

  return { submitting, message, submit }
}

function NoteField(props: {
  value: string
  onChange: (value: string) => void
}): JSX.Element {
  const { value, onChange } = props
  return (
    <label className="block text-sm font-semibold text-me-charcoal/55">
      这次改了什么（选填）
      <textarea
        rows={2}
        aria-label="这次改了什么（选填）"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
      />
    </label>
  )
}

function DialogActions(props: {
  submitting: boolean
  canSubmit: boolean
  onClose: () => void
  onSubmit: () => void
}): JSX.Element {
  const { submitting, canSubmit, onClose, onSubmit } = props
  return (
    <div className="flex justify-end gap-2">
      <button
        type="button"
        onClick={onClose}
        className="rounded-lg border border-black/10 bg-white px-3 py-1 text-sm font-semibold text-me-charcoal hover:bg-me-ivory"
      >
        取消
      </button>
      <button
        type="button"
        onClick={onSubmit}
        disabled={!canSubmit}
        className={`rounded-lg px-4 py-2 text-sm font-black disabled:cursor-not-allowed disabled:opacity-40 ${BRAND_BUTTON_CLASS}`}
      >
        {submitting ? '正在上架…' : '确认上架'}
      </button>
    </div>
  )
}

interface PublishGatesState {
  ackHigh: boolean
  setAckHigh: (v: boolean) => void
  ackRevert: boolean
  setAckRevert: (v: boolean) => void
  countText: string
  setCountText: (v: string) => void
  ackIncomplete: boolean
  setAckIncomplete: (v: boolean) => void
  satisfied: boolean
}

function usePublishGates(preview: PublishPreviewResponse, incompleteCount: number): PublishGatesState {
  const [ackHigh, setAckHigh] = useState(false)
  const [ackRevert, setAckRevert] = useState(false)
  const [countText, setCountText] = useState('')
  const [ackIncomplete, setAckIncomplete] = useState(false)

  useEffect(() => {
    setAckHigh(false)
    setAckRevert(false)
    setCountText('')
    setAckIncomplete(false)
  }, [preview.diffHash])

  const satisfied =
    (preview.highRiskCount === 0 || ackHigh) &&
    (preview.afterRevert === null || ackRevert) &&
    (incompleteCount === 0 || ackIncomplete) &&
    sellableConfirmed(preview.sellable, countText)

  return {
    ackHigh,
    setAckHigh,
    ackRevert,
    setAckRevert,
    countText,
    setCountText,
    ackIncomplete,
    setAckIncomplete,
    satisfied,
  }
}

interface PublishBodyProps {
  preview: PublishPreviewResponse
  incomplete: IncompleteNewTour[]
  gates: PublishGatesState
  note: string
  setNote: (v: string) => void
  message: string | null
  submitting: boolean
  canSubmit: boolean
  onClose: () => void
  onSubmit: () => void
}

function PublishBody(props: PublishBodyProps): JSX.Element {
  const { preview, incomplete, gates, note, setNote, message, submitting, canSubmit, onClose, onSubmit } = props
  return (
    <div className="mt-4 space-y-4">
      {preview.firstPublish ? (
        <FirstPublishTable rows={preview.firstPublishRows} />
      ) : (
        <>
          <RiskLegend />
          <div className="max-h-[50vh] space-y-3 overflow-auto">
            <ChangeList changes={preview.changes} />
          </div>
        </>
      )}

      <PublishGates
        preview={preview}
        ackHigh={gates.ackHigh}
        setAckHigh={gates.setAckHigh}
        ackRevert={gates.ackRevert}
        setAckRevert={gates.setAckRevert}
        countText={gates.countText}
        setCountText={gates.setCountText}
        incomplete={incomplete}
        ackIncomplete={gates.ackIncomplete}
        setAckIncomplete={gates.setAckIncomplete}
      />

      <NoteField value={note} onChange={setNote} />

      {message ? (
        <p role="alert" className="text-sm font-black text-[#C2453A]">
          {message}
        </p>
      ) : null}

      <DialogActions
        submitting={submitting}
        canSubmit={canSubmit}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    </div>
  )
}

/** The preview may carry who contributed how many changes since the last publish. */
type PreviewWithContributors = PublishPreviewResponse & { contributors?: PublishContributor[] }

export const PUBLISH_ALL_TEXT = '上架会把所有人还没上架的修改一起发出去'

export const PUBLISH_SUBTITLE_CONNECTED =
  '上架后，客人在官网等地方看到的内容会变成下面这样。这次会把所有人还没上架的改动一起发出去。'
export const PUBLISH_SUBTITLE_UNCONNECTED =
  '上架后，已上架的目录会变成下面这样（官网等渠道目前还没有接通，不会跟着变）。这次会把所有人还没上架的改动一起发出去。'

function ContributorsLine(props: { preview: PreviewWithContributors }): JSX.Element | null {
  const list = (props.preview.contributors ?? []).filter(c => c.changes > 0 && c.actorLabel)
  if (list.length === 0) return null
  // "系统" (e.g. the first read-in from the website) is not somebody's account: count it apart.
  const accounts = list.filter(c => c.actorLabel !== SYSTEM_ACTOR_LABEL)
  const systemChanges = list
    .filter(c => c.actorLabel === SYSTEM_ACTOR_LABEL)
    .reduce((sum, c) => sum + c.changes, 0)
  const parts = accounts.map(c => `${c.actorLabel} ${c.changes} 处`).join('、')
  const systemPart = systemChanges > 0 ? `另有系统读入 ${systemChanges} 处` : ''
  const text =
    accounts.length === 0
      ? `这次的修改是系统读入的 ${systemChanges} 处`
      : `这次包含 ${accounts.length} 个账号的修改：${parts}${systemPart ? `，${systemPart}` : ''}`
  return (
    <p
      data-testid="publish-contributors"
      className="mt-3 rounded-lg border border-black/10 bg-me-ivory px-3 py-2 text-sm font-semibold text-me-charcoal/80"
    >
      {text}。{PUBLISH_ALL_TEXT}。
    </p>
  )
}

export function PublishDialog(props: {
  clientId: string
  preview: PublishPreviewResponse
  /** New tours in this publish that still miss SOP items; empty when everything is filled in. */
  incompleteNewTours?: IncompleteNewTour[]
  onRefresh: () => void | Promise<void>
  onClose: () => void
  onPublished: (websiteSync: PublishResponse['websiteSync']) => void
}): JSX.Element {
  const { clientId, preview, onRefresh, onClose, onPublished } = props
  const incomplete = props.incompleteNewTours ?? []
  const gates = usePublishGates(preview, incomplete.length)
  const [note, setNote] = useState('')

  const hasChanges = preview.firstPublish || preview.changes.length > 0
  const { submitting, message, submit } = usePublishSubmit(
    clientId,
    preview,
    onRefresh,
    onPublished,
    gates.ackHigh,
    gates.ackRevert,
    gates.countText,
    note,
  )
  const canSubmit = !submitting && hasChanges && gates.satisfied
  const connected = useChannelsConnected()

  return (
    <DialogShell
      title="上架前请核对"
      subtitle={connected ? PUBLISH_SUBTITLE_CONNECTED : PUBLISH_SUBTITLE_UNCONNECTED}
      onClose={onClose}
    >
      <ContributorsLine preview={preview} />
      <PublishBody
        preview={preview}
        incomplete={incomplete}
        gates={gates}
        note={note}
        setNote={setNote}
        message={message}
        submitting={submitting}
        canSubmit={canSubmit}
        onClose={onClose}
        onSubmit={() => {
          if (canSubmit) void submit()
        }}
      />
    </DialogShell>
  )
}
