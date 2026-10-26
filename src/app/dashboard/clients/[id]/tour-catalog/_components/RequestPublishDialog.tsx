'use client'

import { useId, useState } from 'react'
import type { PublishRequestView } from '@/lib/tour-catalog/catalog-contract'
import { BRAND_BUTTON_CLASS } from './catalog-brand'
import { formatDateTimeWithYear } from './catalog-format'
import { DialogShell } from './publish-parts'

export const REQUEST_PUBLISH_LABEL = '请 Magic Engine 上架'
export const REQUEST_PUBLISH_INTRO = '提交后，Magic Engine 团队会核对并上架。你还可以继续修改。'
export const REQUEST_PUBLISH_ERROR = '没有提交成功，请稍后再试'
export const REQUEST_NOTE_MAX = 500

const SECONDARY_BUTTON_CLASS =
  'rounded-lg border border-black/10 bg-white px-3 py-1 text-sm font-semibold text-me-charcoal hover:bg-me-ivory'

const TEXTAREA_CLASS =
  'mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal focus:outline-none focus:ring-2 focus:ring-me-ochre/40'

/** True when the parsed body carries a request object with a string createdAt. */
function isPublishRequestView(value: unknown): value is PublishRequestView {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { createdAt?: unknown }
  return typeof candidate.createdAt === 'string'
}

/** Reads { request } out of a response body, or null when it is not usable. */
function readRequest(body: unknown): PublishRequestView | null {
  if (typeof body !== 'object' || body === null) return null
  const candidate = (body as { request?: unknown }).request
  return isPublishRequestView(candidate) ? candidate : null
}

function NoteField(props: {
  note: string
  onChange: (value: string) => void
}): JSX.Element {
  const { note, onChange } = props
  const noteId = useId()
  return (
    <div className="mt-4">
      <label htmlFor={noteId} className="text-sm font-black text-me-charcoal">
        这次改了什么（选填）
      </label>
      <textarea
        id={noteId}
        rows={4}
        maxLength={REQUEST_NOTE_MAX}
        value={note}
        onChange={e => onChange(e.target.value)}
        className={TEXTAREA_CLASS}
      />
      <p className="mt-1 text-xs font-semibold text-me-charcoal/55">
        {note.length}/{REQUEST_NOTE_MAX}
      </p>
    </div>
  )
}

function DialogActions(props: {
  busy: boolean
  onCancel: () => void
  onSubmit: () => void
}): JSX.Element {
  const { busy, onCancel, onSubmit } = props
  return (
    <div className="mt-4 flex flex-wrap justify-end gap-2">
      <button type="button" onClick={onCancel} className={SECONDARY_BUTTON_CLASS}>
        取消
      </button>
      <button
        type="button"
        onClick={onSubmit}
        disabled={busy}
        className={`${BRAND_BUTTON_CLASS} rounded-lg px-4 py-2 text-sm font-black disabled:cursor-not-allowed disabled:opacity-40`}
      >
        {busy ? '正在提交…' : '提交'}
      </button>
    </div>
  )
}

export function RequestPublishDialog(props: {
  clientId: string
  onClose: () => void
  onSubmitted: (request: PublishRequestView) => void
}): JSX.Element {
  const { clientId, onClose, onSubmitted } = props
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  async function submit() {
    setBusy(true)
    setFailed(false)
    try {
      const res = await fetch(`/api/clients/${clientId}/tour-catalog/publish-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note.trim().slice(0, REQUEST_NOTE_MAX) }),
      })
      const body = res.ok ? await res.json().catch(() => ({})) : {}
      const request = res.ok ? readRequest(body) : null
      if (!request) {
        setFailed(true)
        return
      }
      onSubmitted(request)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogShell title={REQUEST_PUBLISH_LABEL} subtitle={REQUEST_PUBLISH_INTRO} onClose={onClose}>
      <NoteField note={note} onChange={setNote} />
      {failed ? (
        <p role="alert" className="mt-3 text-sm font-black text-[#C2453A]">
          {REQUEST_PUBLISH_ERROR}
        </p>
      ) : null}
      <DialogActions busy={busy} onCancel={onClose} onSubmit={submit} />
    </DialogShell>
  )
}

export function publishRequestNoticeText(
  request: PublishRequestView,
  canPublish: boolean,
  draftVersion: number | null,
): string {
  const time = formatDateTimeWithYear(request.createdAt)
  if (canPublish) {
    const note = request.note.trim()
    return note
      ? `${request.requestedBy} 在 ${time} 请你上架：${note}`
      : `${request.requestedBy} 在 ${time} 请你上架（没有留备注）`
  }
  const base = `已通知 Magic Engine 团队 · ${time}。还没上架`
  if (draftVersion !== null && request.draftVersion < draftVersion) {
    return `${base}；之后又有新的修改，可以再提交一次更新说明。`
  }
  return `${base}，对方核对后会上架。`
}

/** One line under the status bar about the open publish request. Renders nothing when there is none. */
export function PublishRequestNotice(props: {
  request: PublishRequestView | null
  /** True for people who publish themselves: they see who asked. */
  canPublish: boolean
  /** Current draft revision from the publish preview, or null when unknown. */
  draftVersion: number | null
}): JSX.Element | null {
  const { request, canPublish, draftVersion } = props
  if (!request) return null
  return (
    <p
      role="status"
      data-testid="publish-request-notice"
      className="mt-2 rounded-lg border border-black/10 bg-me-ivory px-4 py-2 text-sm font-semibold text-me-charcoal/80 break-words"
    >
      {publishRequestNoticeText(request, canPublish, draftVersion)}
    </p>
  )
}
