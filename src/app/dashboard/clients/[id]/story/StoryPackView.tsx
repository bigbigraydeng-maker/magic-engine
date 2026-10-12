'use client'

/**
 * One weekly Story pack as the PM sees it: every story with its picture, words, time and status,
 * what authorising means right now, and the two buttons. All wording lives in `page-text.ts`.
 */
import { useState } from 'react'

import {
  describeActionError,
  describeItemStatus,
  describePackState,
  describeProblem,
  describeRange,
  formatSlot,
} from '@/lib/social/story-lite/page-text'
import type { LitePreview, LitePreviewItem } from '@/lib/social/story-lite/service'

interface Props {
  clientId: string
  preview: LitePreview
  live: boolean
  onChanged: () => void
}

function Thumb({ item }: { item: LitePreviewItem }) {
  const frame = 'h-40 w-[90px] shrink-0 overflow-hidden rounded-lg bg-me-charcoal/10'
  if (item.media_kind === 'video') {
    return (
      <div className={frame}>
        <video src={item.media_url} muted playsInline preload="metadata" className="h-full w-full object-cover" aria-label="视频缩略图" />
      </div>
    )
  }
  return (
    <div className={frame}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={item.media_url} alt={item.text_line} className="h-full w-full object-cover" loading="lazy" />
    </div>
  )
}

function ItemCard({ item }: { item: LitePreviewItem }) {
  return (
    <li className="flex gap-3 rounded-xl border border-black/10 bg-white p-3">
      <Thumb item={item} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-sm font-semibold leading-relaxed text-me-charcoal">{item.text_line}</p>
        <p className="text-xs text-me-charcoal/70">
          计划发布：{formatSlot(item.slot_at)}（新西兰时间） · 发到：Facebook 主页 Story
        </p>
        <p className="text-xs font-medium text-me-charcoal/80">状态：{describeItemStatus(item.status)}</p>
        {item.problems.length > 0 && (
          <ul className="space-y-0.5">
            {item.problems.map((code) => (
              <li key={code} className="text-xs font-medium text-[#B03A2E]">
                ⚠ {describeProblem(code)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  )
}

export function StoryPackView({ clientId, preview, live, onChanged }: Props) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [confirmingStop, setConfirmingStop] = useState(false)

  const base = `/api/clients/${clientId}/story-lite/${preview.pack_id}`
  const canAuthorize = preview.state === 'DRAFT' && preview.can_authorize
  const canStop = preview.state === 'AUTHORIZED' || preview.state === 'DRAFT'

  async function call(path: 'authorize' | 'revoke', body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(`${base}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
      if (!res.ok || !json || json.success !== true) {
        setMessage(describeActionError(typeof json?.error === 'string' ? json.error : ''))
        onChanged()
        return null
      }
      return json
    } catch {
      setMessage('网络出了问题，没成功，请刷新页面再试')
      return null
    } finally {
      setBusy(false)
    }
  }

  async function authorize() {
    const json = await call('authorize', {
      confirm: true,
      lifetime_days: preview.lifetime_days,
      content_hash: preview.content_hash,
    })
    if (json) {
      setMessage(live ? '已授权：到点会真的发出去。' : '已授权：现在是演练模式，到点只检查、不会发出。')
      onChanged()
    }
  }

  async function stop() {
    setConfirmingStop(false)
    const json = await call('revoke', { reason: 'PM 在 Story 页面点了停' })
    if (json) {
      const sent = Array.isArray(json.sent) ? json.sent.length : 0
      setMessage(sent > 0 ? `已停。已经发出去的 ${sent} 条不会撤回，剩下的不会再发。` : '已停。剩下的都不会再发。')
      onChanged()
    }
  }

  return (
    <section className="space-y-4" aria-label={preview.title}>
      <div>
        <h2 className="text-lg font-bold text-me-charcoal">{preview.title}</h2>
        <p className="text-sm text-me-charcoal/70">当前：{describePackState(preview.state)}</p>
      </div>

      <ul className="space-y-3">
        {preview.items.map((item) => (
          <ItemCard key={item.item_id} item={item} />
        ))}
      </ul>

      <div className="space-y-3 rounded-xl border border-black/10 bg-white p-4">
        {preview.state === 'DRAFT' && preview.can_authorize && (
          <p className="text-sm leading-relaxed text-me-charcoal">
            你将授权：{describeRange(preview.items.map((i) => i.slot_at))}。授权的有效期{preview.lifetime_days}天，到{' '}
            {formatSlot(preview.expires_at_if_authorized)} 为止。
          </p>
        )}
        {preview.state === 'DRAFT' && !preview.can_authorize && (
          <p className="text-sm font-medium text-[#B03A2E]">上面还有标红的问题，先解决才能授权。</p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busy || !canAuthorize}
            onClick={authorize}
            className="rounded-lg bg-me-ochre px-5 py-2.5 text-sm font-semibold text-me-charcoal transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:bg-me-charcoal/10 disabled:text-me-charcoal/70"
          >
            授权这一周
          </button>
          {confirmingStop ? (
            <span className="flex items-center gap-2 rounded-lg bg-[#B03A2E]/10 px-3 py-2">
              <span className="text-sm font-medium text-[#B03A2E]">确定要停吗？剩下还没发的都不会再发。</span>
              <button
                type="button"
                disabled={busy}
                onClick={stop}
                className="rounded-md bg-[#B03A2E] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                确定停
              </button>
              <button type="button" onClick={() => setConfirmingStop(false)} className="px-2 py-1.5 text-sm text-me-charcoal/70">
                先不停
              </button>
            </span>
          ) : (
            <button
              type="button"
              disabled={busy || !canStop}
              onClick={() => setConfirmingStop(true)}
              className="rounded-lg border border-[#B03A2E] px-5 py-2.5 text-sm font-semibold text-[#B03A2E] transition-colors hover:bg-[#B03A2E]/10 disabled:cursor-not-allowed disabled:border-me-charcoal/20 disabled:text-me-charcoal/70"
            >
              停
            </button>
          )}
        </div>
        {message && (
          <p role="status" className="text-sm font-medium text-me-charcoal">
            {message}
          </p>
        )}
      </div>
    </section>
  )
}
