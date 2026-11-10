'use client'

import type { PhaseView, StepGroup } from '@/lib/marketing-plan/promo/overview'
import { MeChip } from '@/components/ui/me-primitives'

const GROUP_LABEL: Record<StepGroup, string> = {
  ads: '广告',
  social: '社媒',
  blog: '博客',
  newsletter: '邮件',
}

interface Props {
  phases: PhaseView[]
  /** 示例预览：不是真实计划，横幅提示并给出关闭按钮 */
  sample?: boolean
  onCloseSample?: () => void
}

/** 时间段安排：每个阶段一张横卡（Figma 2-2 / 3-2）。 */
export function PlanOverview({ phases, sample, onCloseSample }: Props) {
  return (
    <section className="space-y-3" aria-label="时间段安排">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-base font-semibold text-[#1A1A1A]">时间段安排</h2>
        <p className="text-xs text-black/45">只读展示；改阶段请到「填写安排」。</p>
      </div>
      {sample && (
        <div className="rounded-[16px] border border-[#C4912E]/35 bg-[#C4912E]/10 px-4 py-3 flex items-center gap-3">
          <p className="text-sm text-[#6a4a12] flex-1">
            <strong>这是示例，不是真实计划。</strong>不会保存，也不会触发任何动作。
          </p>
          {onCloseSample && (
            <button type="button" onClick={onCloseSample} className="text-xs font-medium text-[#6a4a12] underline shrink-0">关闭示例</button>
          )}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {phases.map((p, i) => {
          const tags = [...new Set(p.steps.map(s => GROUP_LABEL[s.group]))]
          return (
            <article key={p.id} className="rounded-[20px] border border-black/10 bg-white p-4 shadow-[0_1px_2px_rgba(26,26,26,.04)]">
              <p className="text-xs font-semibold uppercase tracking-wide text-black/40">
                {i === 0 ? '起头阶段' : i === phases.length - 1 ? '余下阶段' : `第 ${i + 1} 阶段`}
              </p>
              <h3 className="mt-1 font-display text-sm font-semibold text-[#1A1A1A]">{p.name}</h3>
              <p className="mt-1 text-xs text-black/50">{p.range}（共 {p.days} 天）</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {tags.map(t => <MeChip key={t}>{t}</MeChip>)}
              </div>
              {p.steps.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs text-black/60">
                  {p.steps.slice(0, 3).map(s => <li key={s.id}>• {s.title}</li>)}
                  {p.steps.length > 3 && <li className="text-black/40">还有 {p.steps.length - 3} 项…</li>}
                </ul>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}
