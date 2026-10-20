'use client'

/**
 * 抽屉顶上那条「有客人发来新消息」的提示条。
 *
 * ── 为什么要有这一块 ──────────────────────────────────────────────────────
 * 这一页打开之后不会自己刷新。顾问盯着一个静止的页面，客人那边刚说的话根本不会
 * 冒出来 —— 于是「这个客人没人跟进」的假警报又回来了，跟 WhatsApp 那条线接进来
 * 之前一模一样。这里只做一件事：隔一会儿问一次「自打我打开这一页，有没有新消息」，
 * 有就摆一条窄条，让人自己决定要不要刷新。
 *
 * ── 几条硬规矩 ────────────────────────────────────────────────────────────
 * · **读失败什么都不做** —— 不立红色报错。这条只是锦上添花，不能挡住记一笔和往来
 *   记录（同 WhatsAppReply / MessengerReply 的取舍）。
 * · **页面在后台就不问** —— 切到别的标签页时没人看，白问一遍只是浪费。
 * · **卸载后迟到的结果不许再 setState** —— 用 alive 标记挡掉。
 * · **标题上的数字要还回去** —— 卸载时把 document.title 恢复原样，不然别的页面
 *   会顶着一个不属于它的「(3)」。
 */

import { useEffect, useRef, useState } from 'react'

interface Pulse {
  count: number
  byChannel: Record<string, number>
  latestAt: string | null
}

/** 渠道 → 中文标签。认不出来的渠道归到「其它」，不吞掉。 */
const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  messenger: '私信',
  email: '邮件',
}

const labelOf = (channel: string) => CHANNEL_LABELS[channel] ?? '其它'

/** 把 byChannel 拼成「WhatsApp 2 · 私信 1」。 */
const formatParts = (byChannel: Record<string, number>) =>
  Object.entries(byChannel)
    .map(([channel, n]) => `${labelOf(channel)} ${n}`)
    .join(' · ')

export function NewMessagesBanner({
  clientId,
  intervalMs = 30_000,
}: {
  clientId: string
  intervalMs?: number
}) {
  const [pulse, setPulse] = useState<Pulse | null>(null)

  // 打开这一页的时刻 —— 之后只问「这之后」的新消息，不把历史全算进来。
  const baselineRef = useRef<string>(new Date().toISOString())
  // 原始标题，卸载时要还回去。
  const originalTitleRef = useRef<string>('')

  useEffect(() => {
    originalTitleRef.current = document.title
    let alive = true

    const tick = async () => {
      // 页面在后台就不问 —— 没人看。
      if (document.visibilityState !== 'visible') return
      try {
        const res = await fetch(
          `/api/clients/${clientId}/crm/inbound-pulse?since=${encodeURIComponent(baselineRef.current)}`,
        )
        if (!res.ok) return
        const body = (await res.json()) as Pulse
        if (!alive) return
        setPulse(body)
      } catch {
        // 读失败就保持上一次的状态，什么都不显示 —— 不立红色报错。
      }
    }

    const timer = setInterval(() => {
      void tick()
    }, intervalMs)

    return () => {
      alive = false
      clearInterval(timer)
      document.title = originalTitleRef.current
    }
  }, [clientId, intervalMs])

  // 标题上的数字跟着 count 走；count 归零就还回原标题。
  useEffect(() => {
    const count = pulse?.count ?? 0
    document.title = count > 0 ? `(${count}) ${originalTitleRef.current}` : originalTitleRef.current
  }, [pulse])

  if (!pulse || pulse.count <= 0) return null

  return (
    <div
      role="status"
      data-testid="new-messages-banner"
      className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-me-ochre/15 px-3 py-2 text-sm font-semibold text-me-charcoal"
    >
      <span>
        有 {pulse.count} 位客人发来新消息（{formatParts(pulse.byChannel)}）
      </span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-md bg-me-charcoal px-3 py-1 text-xs font-bold text-white"
      >
        刷新
      </button>
    </div>
  )
}
