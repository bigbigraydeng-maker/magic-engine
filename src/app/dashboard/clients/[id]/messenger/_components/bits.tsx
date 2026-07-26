'use client'

/**
 * Small shared pieces of the Messenger card. Kept apart from the card itself so
 * the card reads as a layout and these read as decisions about wording.
 *
 * Everything here is written for a salesperson on a phone: no jargon, no
 * "24-hour messaging window", no percentages — just what they can do and how
 * long they have to do it.
 */

import React from 'react'
import type { IntentLevel, ReplyWindow, WindowKind } from '../types'

// ─── Time ─────────────────────────────────────────────────────────────────────

/** "2 天 3 小时" / "5 小时" / "20 分钟" — never "0 小时". */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return '0 分钟'
  const hours = Math.floor(ms / 3_600_000)
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    const rest = hours % 24
    return rest > 0 ? `${days} 天 ${rest} 小时` : `${days} 天`
  }
  if (hours >= 1) return `${hours} 小时`
  return `${Math.max(1, Math.round(ms / 60_000))} 分钟`
}

/** "7月26日 14:30" in the reader's own timezone (staff are all in NZ). */
export function formatMoment(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`
}

// ─── Intent ───────────────────────────────────────────────────────────────────

const INTENT_META: Record<IntentLevel, { label: string; className: string }> = {
  high:    { label: '高意向',   className: 'bg-me-ochre text-white' },
  medium:  { label: '一般',     className: 'bg-me-stone text-me-charcoal' },
  low:     { label: '较低',     className: 'border border-me-stone text-me-charcoal/45' },
  unknown: { label: '不确定',   className: 'border border-me-stone text-me-charcoal/45' },
}

export function IntentBadge({ level }: { level: IntentLevel }) {
  const meta = INTENT_META[level] ?? INTENT_META.unknown
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-black ${meta.className}`}>
      {meta.label}
    </span>
  )
}

// ─── Reply window ─────────────────────────────────────────────────────────────

/**
 * Meta only lets a Page reply for a while after the customer writes. Staff do
 * not need to know that rule, only the deadline it creates — and, when it has
 * passed, what to do instead.
 */
export function WindowNotice({ window }: { window: ReplyWindow }) {
  const text: Record<WindowKind, string> = {
    standard:    `还有 ${formatRemaining(window.msRemaining)} 可以直接回复`,
    human_agent: `已超过 24 小时，还能在 ${formatRemaining(window.msRemaining)} 内回一次`,
    closed:      'Facebook 已经不让回这条了 —— 请改用电话或邮件联系',
  }
  const tone: Record<WindowKind, string> = {
    standard:    'bg-[#5C8A4A]/10 text-[#5C8A4A]',
    human_agent: 'bg-me-ochre/12 text-me-ochre',
    closed:      'bg-[#C2453A]/10 text-[#C2453A]',
  }
  return (
    <p className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${tone[window.kind]}`}>
      {text[window.kind]}
    </p>
  )
}

// ─── Text blocks ──────────────────────────────────────────────────────────────

/** A titled bullet list. Renders nothing when the AI found nothing — an empty
 *  "顾虑" heading reads as "no objections", which is a different claim. */
export function BulletBlock({
  title,
  items,
  tone = 'plain',
}: {
  title: string
  items: string[]
  tone?: 'plain' | 'warn' | 'alert'
}) {
  if (!items.length) return null

  const box = {
    plain: '',
    warn:  'rounded-lg bg-me-ochre/10 px-3 py-2.5',
    alert: 'rounded-lg bg-[#C2453A]/8 px-3 py-2.5',
  }[tone]
  const heading = {
    plain: 'text-me-charcoal/45',
    warn:  'text-me-ochre',
    alert: 'text-[#C2453A]',
  }[tone]

  return (
    <div className={box}>
      <p className={`text-[11px] font-black uppercase tracking-[0.1em] ${heading}`}>{title}</p>
      <ul className="mt-1.5 space-y-1">
        {items.map((item, i) => (
          <li key={i} className="flex gap-1.5 text-sm leading-relaxed text-me-charcoal/80">
            <span aria-hidden className="text-me-charcoal/25">·</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
