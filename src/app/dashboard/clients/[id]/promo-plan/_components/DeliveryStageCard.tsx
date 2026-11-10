'use client'

import { useState } from 'react'
import type { DeliveryView } from '@/lib/marketing-plan/promo/stage-evidence'
import { MeButton } from '@/components/ui/me-primitives'
import { ScaleDraftConfirmDialog } from './ScaleDraftConfirmDialog'

interface Props {
  view: DeliveryView
  busy: boolean
  marking?: boolean
  canAct: boolean
  onPropose?: () => void
  onMark?: (stage: 'steady' | 'test') => void
  /** 只渲染按钮条（嵌在状态卡里） */
  actionsOnly?: boolean
  /** 嵌入详情区：不重复按钮，只展示受众梯 */
  embedded?: boolean
}

const CONFIRM = '只改阶段，不改预算和上限'

function StageButtons({ view, busy, marking, canAct, onPropose, onMark, onRequestPropose }: Props & { onRequestPropose: () => void }) {
  const locked = busy || marking
  const showMark = canAct && Boolean(onMark)
  const showPropose = canAct && view.can_propose && Boolean(onPropose)
  if (!showMark && !showPropose) return null
  const backToTest = view.stage === 'steady'
  return (
    <div className="flex flex-wrap gap-2">
      {showMark && onMark && (
        <MeButton
          type="button"
          variant="ghost"
          size="sm"
          disabled={locked}
          onClick={() => {
            if (!window.confirm(CONFIRM)) return
            onMark(backToTest ? 'test' : 'steady')
          }}
        >
          {marking ? '正在记下…' : backToTest ? '改回试投' : '标为稳住'}
        </MeButton>
      )}
      {showPropose && onPropose && (
        <MeButton
          type="button"
          variant="ghost"
          size="sm"
          className="border-[#C2453A]/35 text-[#C2453A]"
          disabled={locked}
          onClick={onRequestPropose}
        >
          {busy ? '正在生成草稿…' : '生成放量草稿'}
        </MeButton>
      )}
    </div>
  )
}

export function DeliveryStageCard(props: Props) {
  const { view, busy, marking = false, canAct, onPropose, onMark, actionsOnly, embedded } = props
  const [scaleOpen, setScaleOpen] = useState(false)

  const confirmPropose = () => {
    setScaleOpen(false)
    onPropose?.()
  }

  if (actionsOnly) {
    return (
      <>
        <StageButtons {...props} onRequestPropose={() => setScaleOpen(true)} />
        <ScaleDraftConfirmDialog
          open={scaleOpen}
          busy={busy}
          onCancel={() => setScaleOpen(false)}
          onConfirm={confirmPropose}
        />
      </>
    )
  }

  if (!embedded) return null

  return (
    <div className="space-y-3" aria-label="投放阶段详情">
      <p className="text-sm text-black/65">{view.switch_text}</p>
      <div>
        <h3 className="text-sm font-semibold text-[#1A1A1A]">建议的受众顺序</h3>
        <p className="mt-1 text-xs text-black/50">{view.ladder_note}</p>
        <ol className="mt-2 space-y-2">
          {view.rungs.map((rung, index) => (
            <li key={rung.title} className="rounded-[12px] border border-black/[.06] bg-white px-3 py-2">
              <p className="text-sm font-medium text-[#1A1A1A]">
                {index + 1}. {rung.title}{rung.suggested ? '（建议先做这一档）' : ''}
              </p>
              <p className="mt-0.5 text-xs text-black/55">{rung.detail}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
