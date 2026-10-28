'use client'

/**
 * 抽屉回复区顶部的「通话后发邮件」提示条。设计稿：docs/specs/2026-10-28-crm-post-call-email-templates-design-v0.md §7
 *
 * - 功能没开通 / 设置无效 / 读失败：普通员工什么都看不到；全局管理员看到一行灰字 + 去设置的入口。
 * - 有「系统记录的接通电话」且这通电话之后还没发过邮件 → 醒目提示条「刚和他通过电话 · 发跟进邮件？」。
 * - 没有系统通话记录 → 两个小按钮：「刚和他通过电话 · 发跟进邮件」（销售亲手确认，回执里记为销售确认）/「用模板写邮件」。
 * - 在抽屉里拨出电话后，通话记录大约挂断两分钟才落库：之后 10 分钟内每 30 秒轻量重读一次，直到那通电话出现。
 * 选模板、预览、改、发都在 TemplateEmailPanel 里。
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { PostCallState } from '@/lib/crm/email-templates/post-call-state'
import type { CallBasis } from '@/lib/crm/email-templates/types'
import { TemplateEmailPanel } from './TemplateEmailPanel'

type BarState = PostCallState & { canEditSettings: boolean }

const POLL_MS = 30_000
const POLL_WINDOW_MS = 10 * 60_000
const ZONE = 'Pacific/Auckland'

const OFF_TEXT: Record<Exclude<PostCallState['featureState'], 'ready'>, string> = {
  disabled: '没开通',
  invalid: '设置有问题',
  unconfigured: '还没配置',
  unreadable: '读不到设置',
}

function dayKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/** "今天 10:42" / "昨天 10:42" / "10/25 10:42" in New Zealand time. */
export function formatCallTime(iso: string, now: Date = new Date()): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return '刚才'
  const clock = new Intl.DateTimeFormat('zh-CN', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(at)
  if (dayKey(at) === dayKey(now)) return `今天 ${clock}`
  if (dayKey(at) === dayKey(new Date(now.getTime() - 86_400_000))) return `昨天 ${clock}`
  const date = new Intl.DateTimeFormat('zh-CN', { timeZone: ZONE, month: 'numeric', day: 'numeric' }).format(at)
  return `${date} ${clock}`
}

export interface PostCallEmailBarProps {
  clientId: string
  contactId: string
  /** When he was dialled from this drawer (epoch ms), or null. */
  dialedAt: number | null
  onSent: () => void
  /** Re-read interval after a dial; a prop only so tests do not wait 30 seconds. */
  pollMs?: number
}

export function PostCallEmailBar({ clientId, contactId, dialedAt, onSent, pollMs = POLL_MS }: PostCallEmailBarProps): JSX.Element | null {
  const [state, setState] = useState<BarState | null>(null)
  const [panel, setPanel] = useState<{ callBasis: CallBasis } | null>(null)

  const load = useCallback(async (): Promise<BarState | null> => {
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/contacts/${contactId}/email/post-call`)
      if (!res.ok) {
        setState(null)
        return null
      }
      const json = (await res.json()) as BarState
      setState(json)
      return json
    } catch {
      setState(null)
      return null
    }
  }, [clientId, contactId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (dialedAt === null) return
    const stopAt = dialedAt + POLL_WINDOW_MS
    let cancelled = false
    const timer = setInterval(() => {
      void (async () => {
        if (cancelled) return
        if (Date.now() > stopAt) {
          clearInterval(timer)
          return
        }
        const next = await load()
        if (next?.callEvidenceAt && Date.parse(next.callEvidenceAt) >= dialedAt) clearInterval(timer)
      })()
    }, pollMs)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [dialedAt, load, pollMs])

  if (state === null) return null

  if (state.featureState !== 'ready') {
    if (!state.canEditSettings) return null
    return (
      <p className="text-xs text-me-charcoal/45" data-testid="post-call-off">
        ✉️ 邮件模板功能{OFF_TEXT[state.featureState]}（只有你能看到这一行）·{' '}
        <Link href={`/dashboard/clients/${clientId}/crm/templates#settings`} className="underline">
          去设置
        </Link>
      </p>
    )
  }
  if (state.templates.length === 0) return null

  if (panel !== null) {
    return (
      <TemplateEmailPanel
        clientId={clientId}
        contactId={contactId}
        templates={state.templates}
        initialCallBasis={panel.callBasis}
        onClose={() => setPanel(null)}
        onSent={() => {
          onSent()
          void load()
        }}
      />
    )
  }

  if (state.callEvidenceAt !== null && !state.emailedSinceCall) {
    return (
      <div
        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-me-ochre/40 bg-me-ochre/10 px-3 py-2"
        data-testid="post-call-prompt"
      >
        <p className="text-sm font-bold text-me-charcoal">📞 刚和他通过电话（{formatCallTime(state.callEvidenceAt)}）· 发跟进邮件？</p>
        <button type="button" onClick={() => setPanel({ callBasis: 'none' })} className="rounded-lg bg-me-charcoal px-3 py-1.5 text-xs font-bold text-white">
          选模板
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="post-call-buttons">
      <button
        type="button"
        onClick={() => setPanel({ callBasis: 'staff_attested' })}
        className="rounded-lg border border-me-stone bg-white px-3 py-1.5 text-xs font-bold text-me-charcoal/80"
      >
        刚和他通过电话 · 发跟进邮件
      </button>
      <button
        type="button"
        onClick={() => setPanel({ callBasis: 'none' })}
        className="rounded-lg border border-me-stone bg-white px-3 py-1.5 text-xs font-bold text-me-charcoal/80"
      >
        用模板写邮件
      </button>
    </div>
  )
}
