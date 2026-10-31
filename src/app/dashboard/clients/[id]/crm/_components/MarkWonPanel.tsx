'use client'

/**
 * 「确认已成交」录金额 —— 从 `all/_components/ContactDetail.tsx` 原样搬来（2026-09-27 R1），
 * 函数体一个字没改。
 *
 * ## 为什么搬到共享目录
 *
 * 当时「今天要联系」和「全部客人」两页各有一个「点开一个人」的面板，而它们**各缺一半**：
 * 抽屉（`PersonDrawer`）能回私信回邮件，但没有这个、也没有「要记住的事」；
 * 详情（`ContactDetail`，2026-09-28 CRM 重整 B2 已删——「全部客人」换用本文件同款的
 * `PersonDrawer` 之后，两个面板变成一个，不再有两份各缺一半的问题）有那两个，却不能回消息。
 * `DncBanner.tsx` 的头注就是这个分裂的事故记录：「FDE 照着人工任务点进去，
 * 页面上根本没有任务里说的那个按钮」。搬到共享目录，两边才可能长同一张脸。
 *
 * 🔴 判断「这个客户走不走这条通道」的那个客户 id **没有跟着搬** ——
 * 它留在调用方，而且按设计稿要在后续轮改成读配置、不认客户 id。
 * 共享组件里一旦出现客户 id，下一个客户就要改共享组件（平台化红线 2）。
 */

import { useState } from 'react'

/**
 * Optional amount panel. The drawer does not mount this. A deal is recorded
 * when staff mark the configured milestone paid. Repeating the same stage
 * does not mint a new event id; the sale row id is that id.
 *
 * The currency box shows NZD until the person changes it. That is only a
 * visible default in this form. The server does not assume a currency.
 */
export function MarkWonPanel({
  clientId,
  contactId,
  stageKey,
  onDone,
  onCancel,
}: {
  clientId: string
  contactId: string
  stageKey: string
  /** 第二个参数 = 要不要顺手重拉列表；失败时传 false。 */
  onDone: (msg: string, reload?: boolean) => void
  onCancel: () => void
}) {
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('NZD')
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const amountMajor = amount.trim() === '' ? null : Number(amount)
    if (amountMajor != null && (!amountMajor || amountMajor <= 0)) {
      onDone('请填一个大于 0 的金额', false)
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/admin/conversions/nal-mark-won', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          contactId,
          stageKey,
          ...(amountMajor != null ? { amountMajor, currency } : {}),
          occurredAt: new Date(occurredAt).toISOString(),
        }),
      })
      const body = (await res.json()) as { message?: string; error?: string }
      if (!res.ok) {
        onDone(`没记上：${body.error ?? '出错了'}`, false)
        return
      }
      onDone(body.message ?? '记好了', true)
    } catch {
      onDone('没记上，再试一次', false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-me-ochre/25 bg-me-gold/10 p-3" onClick={(e) => e.stopPropagation()}>
      <div className="text-xs font-bold text-me-charcoal">这笔生意多少钱？（到账后再回传给广告平台）</div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            aria-label="币种"
            className="w-14 rounded-lg border border-me-stone bg-white px-2 py-1.5 text-sm text-me-charcoal focus:border-me-ochre focus:outline-none"
          />
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="金额"
            className="w-28 rounded-lg border border-me-stone bg-white px-2 py-1.5 text-sm text-me-charcoal focus:border-me-ochre focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-me-charcoal/50">到账日期</span>
          <input
            type="date"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
            className="rounded-lg border border-me-stone bg-white px-2 py-1.5 text-sm text-me-charcoal focus:border-me-ochre focus:outline-none"
          />
        </div>
        <button
          disabled={busy}
          onClick={() => void submit()}
          className="rounded-lg bg-me-charcoal px-3 py-1.5 text-xs font-black text-white disabled:opacity-50"
        >
          {busy ? '记录中…' : '确认已成交'}
        </button>
        <button onClick={onCancel} className="rounded-lg border border-me-stone px-3 py-1.5 text-xs font-semibold text-me-charcoal">
          取消
        </button>
      </div>
    </div>
  )
}
