'use client'

import type { PhaseGateView } from '@/lib/marketing-plan/promo/board'
import { MANUAL_GATE_KEYS } from '@/lib/marketing-plan/promo/gates'
import { LIGHT_META } from '@/lib/marketing-plan/promo/labels'

interface Props {
  view: PhaseGateView
  /** 点「我已核实」：只有人工项会出现这个按钮 */
  onVerify: (phaseId: string, checkKey: string) => void
  busyKey: string | null
}

export function GateList({ view, onVerify, busyKey }: Props) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="px-4 py-3 border-b border-gray-100">
        <h2 className="text-sm font-bold text-gray-900">下一阶段检查清单：{view.phase.name}</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          {view.phase.start_date} 至 {view.phase.end_date}。
          灯的意思：🟢 通过　🟡 有风险　🔴 没过　⚪ 还没核实（读不到或太旧，不能当作通过）
        </p>
      </div>
      {view.results.length === 0 ? (
        <p className="px-4 py-4 text-sm text-gray-500">这个阶段没有需要检查的项。</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {view.results.map(r => {
            const meta = LIGHT_META[r.light]
            const manual = (MANUAL_GATE_KEYS as readonly string[]).includes(r.key)
            const busy = busyKey === `${view.phase.id}:${r.key}`
            return (
              <li key={r.key} className="px-4 py-3 flex flex-col sm:flex-row sm:items-start gap-2">
                <span className={`shrink-0 self-start text-xs font-medium border rounded-full px-2 py-0.5 ${meta.cls}`}>
                  {meta.dot} {meta.label}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {r.label}{r.hard ? <span className="ml-2 text-[11px] font-normal text-gray-400">涉及花钱 / 对外，必须过</span> : null}
                  </p>
                  <p className="text-xs text-gray-600 mt-0.5">{r.reason}</p>
                  {r.light !== 'green' && r.how && <p className="text-xs text-gray-500 mt-0.5">怎么办：{r.how}</p>}
                </div>
                {manual && r.light !== 'green' && (
                  <button
                    onClick={() => onVerify(view.phase.id, r.key)}
                    disabled={busy}
                    className="shrink-0 text-xs border border-gray-300 hover:bg-gray-50 rounded-lg px-3 py-1.5 disabled:opacity-50"
                  >
                    {busy ? '记录中…' : '我已核实'}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
