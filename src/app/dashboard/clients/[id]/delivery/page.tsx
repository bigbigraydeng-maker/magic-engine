'use client'

/**
 * /dashboard/clients/[id]/delivery — FDE 90-day delivery cockpit.
 *
 * Renders the delivery template (src/lib/delivery/template.ts) as an ordered,
 * phase-grouped checklist so the FDE clicks straight through to the ME tool for
 * each step instead of hunting. Track toggle (search / nurture) drops the other
 * lead-engine step. Read-only guide for now; per-step completion tracking is a
 * follow-up slice (needs the storage decision — see PR notes).
 */

import { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  DELIVERY_PHASES, resolveToolHref, stepsForTrack, type DeliveryTrack,
} from '@/lib/delivery/template'

const TRACK_LABEL: Record<'search' | 'nurture', string> = {
  search:  '🔍 即时搜索轨（水电/屋顶/空调）',
  nurture: '🎬 种草蓄水轨（装修/建筑/园林/地板）',
}

export default function DeliveryCockpitPage() {
  const params = useParams<{ id: string }>()
  const clientId = params.id
  const [track, setTrack] = useState<'search' | 'nurture'>('nurture')

  const steps = stepsForTrack(track)
  const num = new Map(steps.map((s, i) => [s.key, i + 1]))

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">90 天交付驾驶舱</h1>
        <Link href={`/dashboard/clients/${clientId}`} className="text-sm text-slate-500 hover:text-slate-800">← 返回客户</Link>
      </div>
      <p className="text-sm text-slate-500">按顺序跑；每步点「打开工具」直达对应界面。交付项对应合同 Schedule B。</p>

      {/* Track toggle — picks the primary lead-engine track for this client */}
      <div className="mt-4 inline-flex rounded-lg border border-slate-200 p-1 text-sm">
        {(['search', 'nurture'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTrack(t)}
            className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
              track === t ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {TRACK_LABEL[t]}
          </button>
        ))}
      </div>

      <div className="mt-6 space-y-7">
        {DELIVERY_PHASES.map(phase => {
          const phaseSteps = steps.filter(s => s.phase === phase.key)
          if (phaseSteps.length === 0) return null
          return (
            <section key={phase.key}>
              <div className="mb-3 flex items-baseline gap-2">
                <h2 className="text-sm font-bold uppercase tracking-wide text-slate-800">{phase.label}</h2>
                <span className="text-xs text-slate-400">{phase.weeks}</span>
              </div>
              <ol className="space-y-3">
                {phaseSteps.map(step => {
                  const href = resolveToolHref(step, clientId)
                  return (
                    <li key={step.key} className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">
                          {num.get(step.key)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-semibold text-slate-900">{step.title}</h3>
                            {step.track !== 'all' && (
                              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                                {step.track === 'search' ? '搜索轨' : '种草轨'}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-sm leading-relaxed text-slate-600">{step.whatToDo}</p>
                          <p className="mt-1.5 text-xs text-slate-400">✅ 完成判定：{step.doneWhen}</p>
                        </div>
                        <div className="shrink-0">
                          {href ? (
                            <Link
                              href={href}
                              className="inline-flex items-center rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
                            >
                              打开工具 →
                            </Link>
                          ) : (
                            <span className="inline-flex items-center rounded-lg bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-400">
                              客户站/外部
                            </span>
                          )}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ol>
            </section>
          )
        })}
      </div>

      <p className="mt-8 rounded-lg bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-500">
        红线：评价只请求真实老客户（不代写/买评）· 不承诺排名/leads 数 · 客户对外页在客户域名 ·
        报告用封装名。工时目标 ≤15h/客户。
      </p>
    </main>
  )
}
