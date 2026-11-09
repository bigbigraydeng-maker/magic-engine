'use client'

import { useCallback, useEffect, useState } from 'react'
import type { RevertPreviewResponse, RevertRequest } from '@/lib/tour-catalog/publish-contract'
import {
  AckCheckbox,
  ChangeList,
  DialogShell,
  SellableCountConfirm,
  STALE_TEXT,
  publishErrorText,
  sellableConfirmed,
} from './publish-parts'
import { useChannelsConnected } from './catalog-context'

function KeptStatusTable(props: {
  rows: RevertPreviewResponse['keptStatuses']
}): JSX.Element {
  const { rows } = props
  const connected = useChannelsConnected()
  return (
    <div>
      <p className="text-sm font-black text-me-charcoal">
        {connected
          ? '下面这些班期不会跟着换回旧状态：满团、取消是真实情况，换回去会让客人订到已经没有的位置。'
          : '下面这些班期不会跟着换回旧状态：满团、取消是真实情况，换回去会把已经没有的位置重新标成可订。'}
      </p>
      <div className="mt-2 max-h-[40vh] overflow-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-me-charcoal/55">
              <th className="px-2 py-1 font-semibold">团名</th>
              <th className="px-2 py-1 font-semibold">出团日</th>
              <th className="px-2 py-1 font-semibold">换回后（保持现在的）</th>
              <th className="px-2 py-1 font-semibold">那一版当时的</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.tourName}-${row.departOn}-${index}`} className="border-t border-black/10">
                <td className="px-2 py-1 font-semibold text-me-charcoal">{row.tourName}</td>
                <td className="px-2 py-1 text-me-charcoal/70">{row.departOn}</td>
                <td className="px-2 py-1 text-me-charcoal/70">{row.currentStatus}</td>
                <td className="px-2 py-1 text-me-charcoal/70">{row.oldStatus}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function RevertBody(props: {
  preview: RevertPreviewResponse
  ackHigh: boolean
  setAckHigh: (v: boolean) => void
  countText: string
  setCountText: (v: string) => void
}): JSX.Element {
  const { preview, ackHigh, setAckHigh, countText, setCountText } = props
  const connected = useChannelsConnected()
  return (
    <>
      <h3 className="text-sm font-black text-me-charcoal">
        {connected ? '换回后，客人看到的内容会有这些变化' : '换回后，已上架的内容会有这些变化'}
      </h3>
      <div className="max-h-[40vh] space-y-3 overflow-auto">
        <ChangeList changes={preview.changes} />
      </div>
      {preview.keptStatuses.length > 0 ? (
        <KeptStatusTable rows={preview.keptStatuses} />
      ) : null}
      {preview.highRiskCount > 0 ? (
        <AckCheckbox checked={ackHigh} onChange={setAckHigh}>
          我已核对上面标红的 {preview.highRiskCount} 处价格和班期改动
        </AckCheckbox>
      ) : null}
      <SellableCountConfirm
        sellable={preview.sellable}
        value={countText}
        onChange={setCountText}
      />
    </>
  )
}

function buildRevertRequest(
  preview: RevertPreviewResponse,
  ackHigh: boolean,
  countText: string,
): RevertRequest {
  return {
    version: preview.targetVersion,
    publishedVersion: preview.publishedVersion,
    diffHash: preview.diffHash,
    acknowledgeHighRisk: ackHigh,
    confirmSellableCount: preview.sellable.needsCountConfirm ? Number(countText.trim()) : null,
  }
}

interface RevertPreviewInput {
  clientId: string
  version: number
  setAckHigh: (v: boolean) => void
  setCountText: (v: string) => void
}

function useRevertPreview(input: RevertPreviewInput): {
  preview: RevertPreviewResponse | null
  loadError: string | null
  load: () => Promise<void>
} {
  const { clientId, version, setAckHigh, setCountText } = input
  const [preview, setPreview] = useState<RevertPreviewResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const connected = useChannelsConnected()

  const load = useCallback(async () => {
    setAckHigh(false)
    setCountText('')
    setLoadError(null)
    try {
      const res = await fetch(
        `/api/clients/${clientId}/tour-catalog/publish/revert?version=${version}`,
      )
      if (res.ok) {
        const data = (await res.json()) as RevertPreviewResponse
        setPreview(data)
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setPreview(null)
        setLoadError(publishErrorText(data.error, connected))
      }
    } catch {
      setPreview(null)
      setLoadError(publishErrorText('publish_failed', connected))
    }
  }, [clientId, version, setAckHigh, setCountText, connected])

  return { preview, loadError, load }
}

interface RevertSubmitInput {
  clientId: string
  preview: RevertPreviewResponse | null
  ackHigh: boolean
  countText: string
  load: () => Promise<void>
  onReverted: () => void
}

function useRevertSubmit(input: RevertSubmitInput): {
  submitting: boolean
  message: string | null
  submit: () => Promise<void>
} {
  const { clientId, preview, ackHigh, countText, load, onReverted } = input
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const connected = useChannelsConnected()

  async function submit() {
    if (!preview) return
    setSubmitting(true)
    setMessage(null)
    const body = buildRevertRequest(preview, ackHigh, countText)
    try {
      const res = await fetch(`/api/clients/${clientId}/tour-catalog/publish/revert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        onReverted()
        return
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (res.status === 409 || data.error === 'stale') {
        setMessage(STALE_TEXT)
        await load()
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

function RevertIntro(props: { version: number }): JSX.Element {
  const { version } = props
  const connected = useChannelsConnected()
  return (
    <>
      <p className="text-sm font-black text-me-charcoal">
        这只会把{connected ? '客人看到的内容' : '已上架的内容'}换回第 {version} 版。
      </p>
      <p className="text-sm font-black text-me-charcoal">
        你的草稿不会变；下次上架前请先改掉草稿里的错，否则会再发出去。
      </p>
    </>
  )
}

function LoadingOrError(props: {
  preview: RevertPreviewResponse | null
  loadError: string | null
}): JSX.Element {
  const { preview, loadError } = props
  return (
    <>
      {preview === null && loadError === null ? (
        <p className="text-sm font-semibold text-me-charcoal/55">
          正在读取这一版和现在的差别…
        </p>
      ) : null}

      {loadError !== null ? (
        <p role="alert" className="text-sm font-black text-[#C2453A]">
          {loadError}
        </p>
      ) : null}
    </>
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
        className="rounded-lg bg-me-charcoal px-4 py-2 text-sm font-black text-white hover:bg-me-charcoal/85 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {submitting ? '正在换回…' : '确认换回这一版'}
      </button>
    </div>
  )
}

interface RevertContentProps {
  version: number
  preview: RevertPreviewResponse | null
  loadError: string | null
  ackHigh: boolean
  setAckHigh: (v: boolean) => void
  countText: string
  setCountText: (v: string) => void
  message: string | null
  submitting: boolean
  canSubmit: boolean
  onClose: () => void
  onSubmit: () => void
}

function RevertContent(props: RevertContentProps): JSX.Element {
  const {
    version,
    preview,
    loadError,
    ackHigh,
    setAckHigh,
    countText,
    setCountText,
    message,
    submitting,
    canSubmit,
    onClose,
    onSubmit,
  } = props
  return (
    <div className="mt-4 space-y-4">
      <RevertIntro version={version} />

      <LoadingOrError preview={preview} loadError={loadError} />

      {preview !== null ? (
        <RevertBody
          preview={preview}
          ackHigh={ackHigh}
          setAckHigh={setAckHigh}
          countText={countText}
          setCountText={setCountText}
        />
      ) : null}

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

export function RevertDialog(props: {
  clientId: string
  version: number
  onClose: () => void
  onReverted: () => void
}): JSX.Element {
  const { clientId, version, onClose, onReverted } = props
  const [ackHigh, setAckHigh] = useState(false)
  const [countText, setCountText] = useState('')

  const { preview, loadError, load } = useRevertPreview({
    clientId,
    version,
    setAckHigh,
    setCountText,
  })

  useEffect(() => {
    void load()
  }, [load])

  const { submitting, message, submit } = useRevertSubmit({
    clientId,
    preview,
    ackHigh,
    countText,
    load,
    onReverted,
  })

  const canSubmit =
    preview !== null &&
    !submitting &&
    (preview.highRiskCount === 0 || ackHigh) &&
    sellableConfirmed(preview.sellable, countText)

  async function handleSubmit() {
    if (!preview || !canSubmit) return
    await submit()
  }
  const connected = useChannelsConnected()

  return (
    <DialogShell
      title={`把${connected ? '对外内容' : '已上架的内容'}换回第 ${version} 版`}
      onClose={onClose}
    >
      <RevertContent
        version={version}
        preview={preview}
        loadError={loadError}
        ackHigh={ackHigh}
        setAckHigh={setAckHigh}
        countText={countText}
        setCountText={setCountText}
        message={message}
        submitting={submitting}
        canSubmit={canSubmit}
        onClose={onClose}
        onSubmit={handleSubmit}
      />
    </DialogShell>
  )
}
