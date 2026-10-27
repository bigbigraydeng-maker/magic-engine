'use client'

import { useEffect, useState } from 'react'

interface Suggestion {
  title: string
  reason: string
}

interface Spend {
  usedUsd: number
  comparisons: number
  capUsd: number
}

interface TrialResponse {
  success?: boolean
  error?: string
  sampleTitle?: string
  note?: string
  without?: Suggestion[]
  with?: Suggestion[]
  spend?: Spend | null
}

type Decision = 'adopt' | 'reject' | null

/**
 * 开/关对照试验。只在首批专家候选上出现。
 * 「采用」只记录这次的决定（页面当次显示），不启用任何经验；「不要」= 保持不启用。
 * 真正启用仍由 Ray 用上面的开关手动点。
 */
export default function LessonTrial({ lessonKey }: { lessonKey: string }) {
  const [busy, setBusy] = useState(false)
  const [data, setData] = useState<TrialResponse | null>(null)
  const [spend, setSpend] = useState<Spend | null>(null)
  const [decision, setDecision] = useState<Decision>(null)

  useEffect(() => {
    fetch('/api/admin/agent-learning/trial')
      .then((r) => r.json())
      .then((j: TrialResponse) => setSpend(j.spend ?? null))
      .catch(() => setSpend(null))
  }, [])

  async function run() {
    setBusy(true)
    setDecision(null)
    try {
      const res = await fetch('/api/admin/agent-learning/trial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lessonKey }),
      })
      const json = (await res.json()) as TrialResponse
      setData(json)
      if (json.spend) setSpend(json.spend)
    } catch {
      setData({ error: '对照失败，请稍后再试' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-600">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={run} disabled={busy} className="rounded bg-slate-100 px-3 py-1 hover:bg-slate-200 disabled:opacity-50">
          {busy ? '对照中…' : '试一下'}
        </button>
        {spend && (
          <span className="text-slate-400">
            今天已花 ${spend.usedUsd.toFixed(2)} / ${spend.capUsd.toFixed(2)}，已对照 {spend.comparisons} 次
          </span>
        )}
        {data?.error && <span className="text-red-600">{data.error}</span>}
      </div>
      {data?.without && data.with && (
        <div className="mt-2">
          <p className="text-[11px] text-slate-500">{data.sampleTitle}：{data.note}</p>
          <div className="mt-1 grid gap-3 sm:grid-cols-2">
            <Column title="没有这条经验" items={data.without} />
            <Column title="有这条经验" items={data.with} />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button onClick={() => setDecision('adopt')} className="rounded bg-emerald-50 px-3 py-1 text-emerald-700 hover:bg-emerald-100">
              采用
            </button>
            <button onClick={() => setDecision('reject')} className="rounded bg-slate-100 px-3 py-1 hover:bg-slate-200">
              不要
            </button>
            {decision === 'adopt' && (
              <span className="text-emerald-700">已记下"采用"（仅本页显示）。经验还没有启用，要启用请用上面的开关。</span>
            )}
            {decision === 'reject' && <span className="text-slate-500">已记下"不要"，经验保持不启用。</span>}
          </div>
        </div>
      )}
    </div>
  )
}

function Column({ title, items }: { title: string; items: Suggestion[] }) {
  return (
    <div className="rounded bg-slate-50 p-2">
      <p className="font-medium text-slate-800">{title}</p>
      <ol className="mt-1 list-decimal space-y-1 pl-4">
        {items.map((s, i) => (
          <li key={i}>
            <span className="font-medium">{s.title}</span>
            <span className="block text-slate-500">{s.reason}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
