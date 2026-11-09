'use client'

import type { PhaseView, StepGroup } from '@/lib/marketing-plan/promo/overview'

const GROUP_META: Record<StepGroup, { icon: string; cls: string }> = {
  ads: { icon: '📣', cls: 'border-indigo-200 bg-indigo-50' },
  social: { icon: '📱', cls: 'border-pink-200 bg-pink-50' },
  blog: { icon: '📝', cls: 'border-emerald-200 bg-emerald-50' },
  newsletter: { icon: '✉️', cls: 'border-amber-200 bg-amber-50' },
}

interface Props {
  phases: PhaseView[]
  /** 示例预览：不是真实计划，横幅提示并给出关闭按钮 */
  sample?: boolean
  onCloseSample?: () => void
}

/** 推广计划总览：一个阶段一张卡，里面是广告 / 社媒 / 博客 / 邮件各干什么。只读。 */
export function PlanOverview({ phases, sample, onCloseSample }: Props) {
  return (
    <section className="space-y-3" aria-label="推广计划总览">
      {sample && (
        <div className="rounded-xl border border-yellow-300 bg-yellow-50 px-4 py-3 flex items-center gap-3">
          <p className="text-sm text-yellow-900 flex-1">
            <strong>这是示例，不是真实计划。</strong>名称、金额、账户都是占位，不会保存，也不会触发任何动作。
          </p>
          {onCloseSample && (
            <button onClick={onCloseSample} className="text-xs text-yellow-900 underline shrink-0">关闭示例</button>
          )}
        </div>
      )}
      <ol className="space-y-3">
        {phases.map((p, i) => (
          <li key={p.id} className="rounded-xl border border-gray-200 bg-white">
            <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-sm font-bold text-gray-900">第 {i + 1} 阶段 · {p.name}</h2>
              <p className="text-xs text-gray-500">{p.range}（共 {p.days} 天）</p>
            </div>
            {p.steps.length === 0 ? (
              <p className="px-4 py-3 text-xs text-gray-500">这个阶段还没安排任何动作。</p>
            ) : (
              <ul className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {p.steps.map(s => (
                  <li key={s.id} className={`rounded-lg border p-3 ${GROUP_META[s.group].cls}`}>
                    <p className="text-sm font-semibold text-gray-900">{GROUP_META[s.group].icon} {s.title}</p>
                    <ul className="mt-1 space-y-0.5">
                      {s.lines.map((l, k) => <li key={k} className="text-xs text-gray-700">{l}</li>)}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
