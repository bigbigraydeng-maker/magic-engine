'use client'

import { useState, type FormEvent } from 'react'
import { HeldCards } from '@/components/confirmation-card/HeldCards'

const FIELD = 'mt-1 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-me-charcoal'

export function AddCreativeEntry({ clientId }: { clientId: string }) {
  const [tick, setTick] = useState(0)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setNote(null)
    const result = await askForCard(clientId, new FormData(event.currentTarget))
    setBusy(false)
    setNote(result.note)
    if (result.issued) setTick((n) => n + 1)
  }

  return (
    <div className="mt-8">
      <CreativeForm busy={busy} note={note} onSubmit={(event) => { void onSubmit(event) }} />
      <HeldCards clientId={clientId} refreshKey={tick} />
    </div>
  )
}

async function askForCard(clientId: string, form: FormData): Promise<{ issued: boolean; note: string }> {
  const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/meta-ads/add-creative-card`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      adAccountId: String(form.get('adAccountId') ?? ''),
      adSetId: String(form.get('adSetId') ?? ''),
      imagePath: String(form.get('imagePath') ?? ''),
      primaryText: String(form.get('primaryText') ?? ''),
      headline: String(form.get('headline') ?? ''),
      ctaType: String(form.get('ctaType') ?? ''),
      adName: String(form.get('adName') ?? ''),
      status: String(form.get('status') ?? 'PAUSED'),
    }),
  })
  const body = await res.json().catch(() => null) as { error?: string; what?: string } | null
  if (!res.ok) return { issued: false, note: body?.error ?? '没有出卡。' }
  return { issued: true, note: body?.what ?? '确认卡已出，在下面点头之后才会去建。' }
}

function CreativeForm({
  busy,
  note,
  onSubmit,
}: {
  busy: boolean
  note: string | null
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-black/10 bg-white p-4">
      <h2 className="text-base font-bold text-me-charcoal">往在投的广告组加一张图</h2>
      <p className="mt-1 text-sm text-me-charcoal/70">先出确认卡。不点确认不会去建，也不会改这一组的预算。新广告默认先暂停。</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-me-charcoal">广告账户<input name="adAccountId" required className={FIELD} placeholder="act_ 开头" /></label>
        <label className="text-sm text-me-charcoal">广告组<input name="adSetId" required className={FIELD} /></label>
        <label className="text-sm text-me-charcoal sm:col-span-2">内容工厂里的图片路径<input name="imagePath" required className={FIELD} placeholder="renders/客户/工单/图.jpg" /></label>
        <label className="text-sm text-me-charcoal sm:col-span-2">正文<input name="primaryText" required className={FIELD} /></label>
        <label className="text-sm text-me-charcoal">标题<input name="headline" required className={FIELD} /></label>
        <label className="text-sm text-me-charcoal">广告名字<input name="adName" required className={FIELD} /></label>
        <label className="text-sm text-me-charcoal">按钮
          <select name="ctaType" defaultValue="LEARN_MORE" className={FIELD}>
            <option value="LEARN_MORE">了解更多</option>
            <option value="SIGN_UP">登记</option>
            <option value="BOOK_TRAVEL">预订</option>
            <option value="CONTACT_US">联系我们</option>
            <option value="GET_QUOTE">询价</option>
            <option value="APPLY_NOW">立即申请</option>
            <option value="SHOP_NOW">去购买</option>
            <option value="SUBSCRIBE">订阅</option>
          </select>
        </label>
        <label className="text-sm text-me-charcoal">新广告状态
          <select name="status" defaultValue="PAUSED" className={FIELD}>
            <option value="PAUSED">先暂停</option>
            <option value="ACTIVE">直接在投</option>
          </select>
        </label>
      </div>
      <button type="submit" disabled={busy} className="mt-4 rounded-full bg-me-charcoal px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {busy ? '正在出卡…' : '出确认卡'}
      </button>
      {note ? <p className="mt-3 text-sm text-me-charcoal">{note}</p> : null}
    </form>
  )
}
