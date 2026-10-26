'use client'

/**
 * One weekly Story pack as the PM sees it: every story with its picture, words, time and status,
 * what authorising means right now, and the two buttons. All wording lives in `page-text.ts`.
 */
import { useState } from 'react'

import {
  describeActionError,
  describeItemStatusInPack,
  describePackState,
  describeProblem,
  describeStopResult,
  thumbnailUrl,
  describeRange,
  formatSlot,
} from '@/lib/social/story-lite/page-text'
import type { LitePreview, LitePreviewItem } from '@/lib/social/story-lite/service'

interface Props {
  clientId: string
  preview: LitePreview
  live: boolean
  /** False while only the fast first look is on screen: pictures not yet re-checked, so authorising stays off. */
  verified: boolean
  /** Number of OTHER weeks that are still authorised (the stop button only stops this one). */
  otherAuthorized: number
  onChanged: () => Promise<void>
  /** Shown by the page, outside this view, so it survives a failed refresh. */
  onNotice: (text: string | null) => void
}

function Thumb({ item }: { item: LitePreviewItem }) {
  const [small, setSmall] = useState(true)
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
      <img
        src={small ? thumbnailUrl(item.media_url) : item.media_url}
        alt={item.text_line}
        className="h-full w-full object-cover"
        loading="lazy"
        decoding="async"
        onError={() => setSmall(false)}
      />
    </div>
  )
}

function ItemCard({ item, showProblems, packState }: { item: LitePreviewItem; showProblems: boolean; packState: LitePreview['state'] }) {
  return (
    <li className="flex gap-3 rounded-xl border border-black/10 bg-white p-3">
      <Thumb item={item} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-sm font-semibold leading-relaxed text-me-charcoal">{item.text_line}</p>
        <p className="text-xs text-me-charcoal/70">
          计划发布：{formatSlot(item.slot_at)}（新西兰时间） · 发到：Facebook 主页 Story
        </p>
        <p className="text-xs font-medium text-me-charcoal/80">状态：{describeItemStatusInPack(item.status, packState)}</p>
        {showProblems && item.problems.length > 0 && (
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

export function StoryPackView({ clientId, preview, live, verified, otherAuthorized, onChanged, onNotice }: Props) {
  const [busy, setBusy] = useState(false)
  const setMessage = onNotice
  const [confirmingStop, setConfirmingStop] = useState(false)

  const base = `/api/clients/${clientId}/story-lite/${preview.pack_id}`
  const canAuthorize = verified && preview.state === 'DRAFT' && preview.can_authorize
  const canStop = preview.state === 'AUTHORIZED' || preview.state === 'DRAFT'

  async function call(path: 'authorize' | 'revoke', body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
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
        return null
      }
      return json
    } catch {
      // the request may have reached the server even though the answer was lost
      setMessage('网络出了问题，不确定有没有成功。页面已刷新，请看上面显示的最新状态。')
      return null
    }
  }

  async function authorize() {
    setBusy(true)
    const json = await call('authorize', {
      confirm: true,
      lifetime_days: preview.lifetime_days,
      content_hash: preview.content_hash,
    })
    if (json) {
      const expires = typeof json.expires_at === 'string' ? json.expires_at : preview.expires_at_if_authorized
      setMessage(
        live
          ? `已授权「${preview.title}」这一周：到点会真的发出去。`
          : `已授权「${preview.title}」这一周：现在是演练模式，到点只检查、不会发出。注意：到 ${formatSlot(expires)} 之前，一旦开启真发，没发的内容会自动发出。`,
      )
    }
    // the notice is already set (and lives in the page), then stay busy until the fresh state is on screen
    await onChanged()
    setBusy(false)
  }

  async function stop() {
    setConfirmingStop(false)
    setBusy(true)
    const json = await call('revoke', { reason: 'PM 在 Story 页面点了停' })
    if (json) {
      const sent = Array.isArray(json.sent) ? json.sent.length : 0
      const inFlight = Array.isArray(json.in_flight) ? json.in_flight.length : 0
      setMessage(describeStopResult(preview.title, sent, inFlight, json.summary_available !== false))
    }
    await onChanged()
    setBusy(false)
  }

  const itemCodes = new Set(preview.items.flatMap((item) => item.problems))
  const packLevelProblems = preview.blocking.filter((code) => !itemCodes.has(code))

  return (
    <section className="space-y-4" aria-label={preview.title}>
      <div>
        <h2 className="text-lg font-bold text-me-charcoal">{preview.title}</h2>
        <p className="text-sm text-me-charcoal/70">当前：{describePackState(preview.state)}</p>
      </div>

      <ul className="space-y-3">
        {preview.items.map((item) => (
          <ItemCard key={item.item_id} item={item} showProblems={preview.state === 'DRAFT'} packState={preview.state} />
        ))}
      </ul>

      <div className="space-y-3 rounded-xl border border-black/10 bg-white p-4">
        {preview.state === 'DRAFT' && !verified && (
          <p role="status" className="text-sm font-medium text-me-charcoal">
            正在核对图片是不是都还在、有没有被改过…核对完才能点「授权这一周」。
          </p>
        )}
        {preview.state === 'DRAFT' && verified && preview.can_authorize && (
          <p className="text-sm leading-relaxed text-me-charcoal">
            你将授权：{describeRange(preview.items.map((i) => i.slot_at))}。授权的有效期{preview.lifetime_days}天，到{' '}
            {formatSlot(preview.expires_at_if_authorized)} 为止。
          </p>
        )}
        {preview.state === 'DRAFT' && verified && !preview.can_authorize && (
          <div className="space-y-1">
            <p className="text-sm font-medium text-[#B03A2E]">现在不能授权，先解决问题：</p>
            <ul className="space-y-0.5">
              {packLevelProblems.map((code) => (
                <li key={code} className="text-sm font-medium text-[#B03A2E]">
                  ⚠ {describeProblem(code)}
                </li>
              ))}
              {packLevelProblems.length === 0 && <li className="text-sm text-me-charcoal">上面每条标红的问题都要先解决。</li>}
            </ul>
          </div>
        )}
        {otherAuthorized > 0 && (
          <p role="status" className="text-sm font-medium text-[#B03A2E]">
            注意：另外还有 {otherAuthorized} 周也处于已授权状态，这里的「停」只停当前这一周。
          </p>
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
              <span className="text-sm font-medium text-[#B03A2E]">确定只停「{preview.title}」这一周吗？停掉后这一周不能再授权，要重新出周包；其他周不受影响。</span>
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
      </div>
    </section>
  )
}
