'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface AutoResponse {
  success?: boolean
  error?: string
  judged?: number
  failed?: number
  remaining?: number
  budgetUsedUp?: boolean
}

/** 让 AI 把所有还没有结论的候选经验各试一遍。只记录结论，不启用任何经验。 */
export default function AutoJudgeAll({ pending }: { pending: number }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/agent-learning/trial/auto', { method: 'POST' })
      const j = (await res.json()) as AutoResponse
      if (!j.success) {
        setMsg(j.error ?? '没跑成，请稍后再试')
      } else if (j.budgetUsedUp) {
        setMsg(`今天的额度用完了，已出结论 ${j.judged ?? 0} 条`)
      } else {
        const rest = j.remaining ? `，还剩 ${j.remaining} 条可再点一次` : ''
        setMsg(`已出结论 ${j.judged ?? 0} 条${j.failed ? `，失败 ${j.failed} 条` : ''}${rest}`)
      }
      router.refresh()
    } catch {
      setMsg('没跑成，请稍后再试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
      <button
        onClick={run}
        disabled={busy || pending === 0}
        className="rounded bg-slate-900 px-4 py-1.5 text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {busy ? 'AI 试验中，请稍等…' : '让 AI 全部试一遍'}
      </button>
      <span className="text-xs text-slate-500">
        {pending === 0 ? '没有待试的经验' : `${pending} 条还没有结论。只给建议，不会自动启用。`}
      </span>
      {msg && <span className="text-xs text-slate-700">{msg}</span>}
    </div>
  )
}
