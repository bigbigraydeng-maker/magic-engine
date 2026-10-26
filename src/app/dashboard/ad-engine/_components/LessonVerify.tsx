'use client'

import { useState } from 'react'
import { classifyLesson, VERIFY_LAYER_LABEL } from '@/lib/agent-learning/lesson-verify/classify'
import { buildExperimentCard } from '@/lib/agent-learning/lesson-verify/experiment-card'

export interface SiteOption {
  id: string
  name: string
}

interface VerifyResponse {
  ok?: boolean
  error?: string
  url?: string
  result?: { pass: boolean; summary: string }
}

/** 一条经验验证到哪一层；类型按文字自动归类，不用人选检查项，只选站点。 */
export default function LessonVerify({
  lessonKey,
  lesson,
  rationale,
  sites,
}: {
  lessonKey: string
  lesson: string
  rationale: string | null
  sites: SiteOption[]
}) {
  const kind = classifyLesson(lesson, rationale)
  const [siteId, setSiteId] = useState('self')
  const [busy, setBusy] = useState(false)
  const [data, setData] = useState<VerifyResponse | null>(null)

  async function run() {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/agent-learning/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lessonKey, siteId }),
      })
      setData((await res.json()) as VerifyResponse)
    } catch {
      setData({ error: '检查失败，请稍后再试' })
    } finally {
      setBusy(false)
    }
  }

  const isSite = kind === 'html_visible' || kind === 'structured_data'
  return (
    <div className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-600">
      <p>验证到：{VERIFY_LAYER_LABEL[kind]}</p>
      {isSite && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className="rounded border border-slate-200 px-2 py-1">
            <option value="self">我们自己的站</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button onClick={run} disabled={busy} className="rounded bg-slate-100 px-3 py-1 hover:bg-slate-200 disabled:opacity-50">
            {busy ? '检查中…' : '检查这个站'}
          </button>
          {data?.result && (
            <span className={data.result.pass ? 'text-emerald-700' : 'text-amber-700'}>{data.result.summary}</span>
          )}
          {data?.error && <span className="text-red-600">{data.error}</span>}
        </div>
      )}
      {kind === 'ad_experiment' && <ExperimentView lesson={lesson} />}
      {isSite && <p className="mt-1 text-[11px] text-slate-400">只说明该站现状符合与否，不代表照做就会变好。</p>}
    </div>
  )
}

function ExperimentView({ lesson }: { lesson: string }) {
  // 只展示，没有执行按钮。
  const c = buildExperimentCard(lesson)
  return (
    <div className="mt-1 rounded bg-slate-50 p-2">
      <p className="font-medium">建议实验（只展示，不会自动执行）</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        <li>假设：{c.hypothesis}</li>
        <li>预算上限：{c.budgetCapNzd} 新西兰元；周期：{c.durationDays} 天</li>
        <li>成功：{c.successRule}</li>
        <li>失败：{c.failureRule}</li>
        <li>{c.approver}；系统自己不开广告、不花钱</li>
      </ul>
    </div>
  )
}
