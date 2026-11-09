'use client'

import type { DeliveryView } from '@/lib/marketing-plan/promo/stage-evidence'

interface Props {
  view: DeliveryView
  busy: boolean
  canAct: boolean
  onPropose?: () => void
}

export function DeliveryStageCard({ view, busy, canAct, onPropose }: Props) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 space-y-3" aria-label="投放阶段">
      <div>
        <h2 className="text-sm font-bold text-gray-900">现在是：{view.stage_label}</h2>
        <p className="mt-1 text-sm text-gray-700">{view.goal}</p>
      </div>
      <p className="text-sm text-gray-700">{view.ratio_text}</p>
      <p className="text-sm text-gray-800">{view.switch_text}</p>
      {view.draft_note && <p className="text-sm text-gray-700">{view.draft_note}</p>}
      {canAct && view.can_propose && onPropose && (
        <button
          type="button"
          onClick={onPropose}
          disabled={busy}
          className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg px-4 py-2 disabled:opacity-50"
        >
          {busy ? '正在生成草稿…' : '生成放量草稿'}
        </button>
      )}
      <div>
        <h3 className="text-sm font-semibold text-gray-900">建议的受众顺序</h3>
        <p className="mt-1 text-xs text-gray-600">{view.ladder_note}</p>
        <ol className="mt-2 space-y-2">
          {view.rungs.map((rung, index) => (
            <li key={rung.title} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
              <p className="text-sm font-medium text-gray-900">
                {index + 1}. {rung.title}{rung.suggested ? '（建议先做这一档）' : ''}
              </p>
              <p className="text-xs text-gray-700 mt-0.5">{rung.detail}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
