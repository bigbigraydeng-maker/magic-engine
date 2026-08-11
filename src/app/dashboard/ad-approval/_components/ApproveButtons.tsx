'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * 「开」和「不开」两个按钮。
 *
 * 点「开」= 这条广告从这一刻开始花真钱。所以按钮上写的是花多少，不是「确认」——
 * 一个只写「确认」的按钮，点的人不知道自己确认了什么。
 */
export default function ApproveButtons({
  actionId,
  costLine,
}: {
  actionId: string
  /** 例如「每天 $30、最多花 $210」。直接印在按钮上。 */
  costLine: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  async function send(decision: 'approve' | 'reject') {
    setBusy(decision)
    setError(null)
    try {
      const res = await fetch(`/api/ad-approval/${encodeURIComponent(actionId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusy(null)
      setConfirming(false)
    }
  }

  return (
    <div className="mt-4 border-t border-slate-200 pt-4">
      {!confirming ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setConfirming(true)}
            disabled={busy !== null}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            开始投放（{costLine}）
          </button>
          <button
            onClick={() => send('reject')}
            disabled={busy !== null}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-50"
          >
            {busy === 'reject' ? '处理中…' : '先不投'}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200">
          <span className="text-sm text-amber-900">
            点下去广告立刻开始花钱（{costLine}）。确定？
          </span>
          <button
            onClick={() => send('approve')}
            disabled={busy !== null}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy === 'approve' ? '开启中…' : '确定，开'}
          </button>
          <button
            onClick={() => setConfirming(false)}
            disabled={busy !== null}
            className="text-sm text-slate-600 underline"
          >
            取消
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  )
}
