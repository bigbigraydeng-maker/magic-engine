'use client'

import { useState } from 'react'

interface Suggestion {
  title: string
  reason: string
}

interface Status {
  spentUsd: number
  capUsd: number
  trials: number
}

interface TrialResponse {
  success?: boolean
  error?: string
  status?: Status
  result?: { without: Suggestion[]; withLesson: Suggestion[] }
}

/** 开/关对照：只在当次页面里记录"采用/不要"，不启用、不落库。 */
export default function LessonTrial({ lessonKey }: { lessonKey: string }) {
  const [busy, setBusy] = useState(false)
  const [data, setData] = useState<TrialResponse | null>(null)
  const [decision, setDecision] = useState<'adopt' | 'reject' | null>(null)

  async function run() {
    setBusy(true)
    setDecision(null)
    try {
      const res = await fetch('/api/admin/agent-learning/trial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lessonKey }),
      })
      setData((await res.json()) as TrialResponse)
    } catch {
      setData({ error: '对照失败，请稍后再试' })
    } finally {
      setBusy(false)
    }
  }

  const st = data?.status
  return (
    <div className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-600">
      <button onClick={run} disabled={busy} className="rounded bg-slate-100 px-3 py-1 hover:bg-slate-200 disabled:opacity-50">
        {busy ? '对照中…' : '试一下（带/不带这条经验各出一次建议）'}
      </button>
      {data?.error && <span className="ml-2 text-red-600">{data.error}</span>}
      {data?.result && (
        <div className="mt-2">
          <p className="text-[11px] text-slate-400">示例数据，虚构；这是初筛，不是效果证明；模型有随机性，可再试一次。</p>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            <Column title="没有这条经验" items={data.result.without} />
            <Column title="有这条经验" items={data.result.withLesson} />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button onClick={() => setDecision('adopt')} className="rounded bg-emerald-50 px-3 py-1 text-emerald-700 hover:bg-emerald-100">采用</button>
            <button onClick={() => setDecision('reject')} className="rounded bg-slate-100 px-3 py-1 hover:bg-slate-200">不要</button>
            {decision === 'adopt' && <span className="text-emerald-700">已记录你的选择：采用。这次只记录，经验仍是未启用。</span>}
            {decision === 'reject' && <span>已记录你的选择：不要。经验保持未启用。</span>}
          </div>
        </div>
      )}
      {st && (
        <p className="mt-1 text-[11px] text-slate-400">
          今天已花 ${st.spentUsd.toFixed(2)} / ${st.capUsd.toFixed(2)}，已对照 {st.trials} 次
        </p>
      )}
    </div>
  )
}

function Column({ title, items }: { title: string; items: Suggestion[] }) {
  return (
    <div className="rounded bg-slate-50 p-2">
      <p className="font-medium">{title}</p>
      <ol className="mt-1 list-decimal space-y-1 pl-4">
        {items.map((s, i) => (
          <li key={i}>
            <span className="text-slate-800">{s.title}</span>
            <span className="block text-slate-500">{s.reason}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
