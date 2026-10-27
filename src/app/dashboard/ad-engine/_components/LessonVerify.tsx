'use client'

import { useRef, useState } from 'react'
import { classifyLesson, VERIFY_LAYER_LABEL } from '@/lib/agent-learning/lesson-verify/classify'
import { classifyBacktest } from '@/lib/agent-learning/lesson-verify/backtest'
import { buildExperimentCard } from '@/lib/agent-learning/lesson-verify/experiment-card'

export interface SiteOption {
  id: string
  name: string
}

interface VerifyResponse {
  /** 发起请求时选的站点；只在仍选着它时才展示结果。 */
  forSiteId?: string
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
  clients,
}: {
  lessonKey: string
  lesson: string
  rationale: string | null
  sites: SiteOption[]
  clients: SiteOption[]
}) {
  const kind = classifyLesson(lesson, rationale)
  const [siteId, setSiteId] = useState('self')
  const [busy, setBusy] = useState(false)
  const [data, setData] = useState<VerifyResponse | null>(null)
  const currentSite = useRef(siteId)

  function pickSite(next: string) {
    currentSite.current = next
    setSiteId(next)
    setData(null)
  }

  async function run() {
    const requested = siteId
    setBusy(true)
    try {
      const res = await fetch('/api/admin/agent-learning/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lessonKey, siteId }),
      })
      const json = (await res.json()) as VerifyResponse
      if (currentSite.current === requested) setData({ ...json, forSiteId: requested })
    } catch {
      if (currentSite.current === requested) setData({ error: '检查失败，请稍后再试', forSiteId: requested })
    } finally {
      setBusy(false)
    }
  }

  const shown = data && data.forSiteId === siteId ? data : null
  const isSite = kind === 'html_visible' || kind === 'structured_data'
  return (
    <div className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-600">
      <p>验证到：{VERIFY_LAYER_LABEL[kind]}</p>
      {isSite && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <select value={siteId} onChange={(e) => pickSite(e.target.value)} className="rounded border border-slate-200 px-2 py-1">
            <option value="self">我们自己的站</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button onClick={run} disabled={busy} className="rounded bg-slate-100 px-3 py-1 hover:bg-slate-200 disabled:opacity-50">
            {busy ? '检查中…' : '检查这个站'}
          </button>
          {shown?.result && (
            <span className={shown.result.pass ? 'text-emerald-700' : 'text-amber-700'}>{shown.result.summary}</span>
          )}
          {shown?.error && <span className="text-red-600">{shown.error}</span>}
        </div>
      )}
      {kind === 'ad_experiment' && (
        <>
          <BacktestView lessonKey={lessonKey} canBacktest={classifyBacktest(lesson, rationale) !== null} clients={clients} />
          <ExperimentView lesson={lesson} />
        </>
      )}
      {isSite && <p className="mt-1 text-[11px] text-slate-400">只说明该站现状符合与否，不代表照做就会变好。</p>}
    </div>
  )
}

function BacktestView({ lessonKey, canBacktest, clients = [] }: { lessonKey: string; canBacktest: boolean; clients?: SiteOption[] }) {
  const [clientId, setClientId] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ forClient: string; msg: string } | null>(null)
  const currentClient = useRef(clientId)

  if (!canBacktest) return <p className="mt-1">第 2 层 · 回测：无法回测（这条经验没有对应的可计算指标）</p>

  function pick(next: string) {
    currentClient.current = next
    setClientId(next)
    setResult(null)
  }

  async function run() {
    const requested = clientId
    setBusy(true)
    let msg = '回测失败，请稍后再试'
    try {
      const res = await fetch('/api/admin/agent-learning/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lessonKey, clientId: requested }),
      })
      const json = (await res.json()) as { summary?: string; error?: string }
      msg = json.summary ?? json.error ?? msg
    } catch {
      // keep default message
    }
    setBusy(false)
    if (currentClient.current === requested) setResult({ forClient: requested, msg })
  }

  const shown = result && result.forClient === clientId ? result.msg : null
  return (
    <div className="mt-1">
      <p>第 2 层 · 回测（只读该客户历史广告数据）</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <select value={clientId} onChange={(e) => pick(e.target.value)} className="rounded border border-slate-200 px-2 py-1">
          <option value="">选择客户</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button onClick={run} disabled={busy || !clientId} className="rounded bg-slate-100 px-3 py-1 hover:bg-slate-200 disabled:opacity-50">
          {busy ? '回测中…' : '回测一下'}
        </button>
        {shown && <span className="text-slate-700">{shown}</span>}
      </div>
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
