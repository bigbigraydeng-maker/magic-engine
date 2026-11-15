'use client'

import { useState, type FormEvent } from 'react'
import { HeldCards } from '@/components/confirmation-card/HeldCards'
import { ACTIVATE_AD_SENTENCE, ACTIVATE_AD_WHAT } from '@/lib/ads-strategy/paused-draft-copy'

const FIELD = 'mt-1 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-me-charcoal'

export interface PausedAdOption {
  readonly adId: string
  readonly adName: string
  readonly adsetName: string
  readonly previewUrl: string | null
}

export function ActivateAdEntry({
  clientId,
  choices,
}: {
  clientId: string
  choices: readonly PausedAdOption[]
}) {
  const [tick, setTick] = useState(0)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewName, setPreviewName] = useState('广告图片')
  const view = { setBusy, setNote, setTick, setPreviewUrl, setPreviewName }

  return (
    <div className="mt-8">
      <ActivateForm
        choices={choices}
        busy={busy}
        note={note}
        previewUrl={previewUrl}
        previewName={previewName}
        onPick={(adId) => showChoice(choices, adId, setPreviewUrl, setPreviewName)}
        onSubmit={(event) => { void submitActivate(event, clientId, choices, view) }}
      />
      <HeldCards clientId={clientId} refreshKey={tick} />
    </div>
  )
}

interface ActivateView {
  setBusy: (value: boolean) => void
  setNote: (value: string | null) => void
  setTick: (update: (value: number) => number) => void
  setPreviewUrl: (value: string | null) => void
  setPreviewName: (value: string) => void
}

async function submitActivate(
  event: FormEvent<HTMLFormElement>,
  clientId: string,
  choices: readonly PausedAdOption[],
  view: ActivateView,
): Promise<void> {
  event.preventDefault()
  view.setBusy(true)
  view.setNote(null)
  const form = new FormData(event.currentTarget)
  const picked = String(form.get('picked') ?? '')
  const typed = String(form.get('adId') ?? '').trim()
  const adId = picked || typed
  const choice = choices.find((item) => item.adId === adId)
  const result = await askForCard(clientId, adId)
  view.setBusy(false)
  view.setNote(result.note)
  if (!result.issued) return
  view.setPreviewUrl(result.previewUrl ?? choice?.previewUrl ?? null)
  view.setPreviewName(choice?.adName ?? '广告图片')
  view.setTick((value) => value + 1)
}

function showChoice(
  choices: readonly PausedAdOption[],
  adId: string,
  setPreviewUrl: (value: string | null) => void,
  setPreviewName: (value: string) => void,
): void {
  const choice = choices.find((item) => item.adId === adId)
  setPreviewUrl(choice?.previewUrl ?? null)
  setPreviewName(choice?.adName ?? '广告图片')
}

async function askForCard(
  clientId: string,
  adId: string,
): Promise<{ issued: boolean; note: string; previewUrl: string | null }> {
  const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/meta-ads/activate-ad-card`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ adId }),
  })
  const body = await res.json().catch(() => null) as { error?: string; what?: string; previewUrl?: unknown } | null
  if (!res.ok) return { issued: false, note: body?.error ?? '没有出卡。', previewUrl: null }
  const previewUrl = typeof body?.previewUrl === 'string' && body.previewUrl.startsWith('https://') ? body.previewUrl : null
  return { issued: true, note: body?.what ?? '确认卡已出。不点确认不会改广告。', previewUrl }
}

function ActivateForm({
  choices,
  busy,
  note,
  previewUrl,
  previewName,
  onPick,
  onSubmit,
}: {
  choices: readonly PausedAdOption[]
  busy: boolean
  note: string | null
  previewUrl: string | null
  previewName: string
  onPick: (adId: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-black/10 bg-white p-4">
      <h2 className="text-base font-bold text-me-charcoal">{ACTIVATE_AD_WHAT}</h2>
      <p className="mt-1 text-sm text-me-charcoal/70">{ACTIVATE_AD_SENTENCE}</p>
      <p className="mt-1 text-sm text-me-charcoal/70">先出确认卡。不点确认不会改。出卡后请在 30 分钟内点，时间按新西兰时间算。</p>
      <div className="mt-4 grid gap-3">
        <label className="text-sm text-me-charcoal">从最近的快照里选一条暂停的广告
          <select name="picked" defaultValue="" className={FIELD} onChange={(event) => onPick(event.target.value)}>
            <option value="">{choices.length === 0 ? '快照里没有暂停的广告，请在下面填编号' : '不从列表选，自己填编号'}</option>
            {choices.map((item) => (
              <option key={item.adId} value={item.adId}>{item.adName} · {item.adsetName}</option>
            ))}
          </select>
        </label>
        <label className="text-sm text-me-charcoal">或者粘贴广告编号
          <input name="adId" className={FIELD} inputMode="numeric" autoComplete="off" />
        </label>
      </div>
      {previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- snapshot preview URL is not on our image host
        <img src={previewUrl} alt={previewName} className="mt-4 h-24 w-24 rounded-lg border border-black/10 object-cover" />
      ) : null}
      <button type="submit" disabled={busy} className="mt-4 rounded-full bg-me-charcoal px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {busy ? '正在出卡…' : '出确认卡'}
      </button>
      {note ? <p className="mt-3 text-sm text-me-charcoal">{note}</p> : null}
    </form>
  )
}
