'use client'

import { useState } from 'react'
import type { DeliveryView } from '@/lib/marketing-plan/promo/stage-evidence'
import { MeButton } from '@/components/ui/me-primitives'

interface Props {
  view: DeliveryView
  busy: boolean
  marking?: boolean
  canAct: boolean
  onPropose?: () => void
  onMark?: (stage: 'steady' | 'test') => void
  actionsOnly?: boolean
}

const CONFIRM = '只改阶段，不改预算和上限'

function ScaleDraftConfirmDialog({ open, busy, onCancel, onConfirm }: {
  open: boolean; busy: boolean; onCancel: () => void; onConfirm: () => void
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal aria-labelledby="scale-draft-title">
      <div className="w-full max-w-md rounded-[24px] border border-black/10 bg-white p-6 shadow-lg">
        <h2 id="scale-draft-title" className="text-center text-base font-semibold text-gray-900">要另外做一份「放量」草稿吗？</h2>
        <ul className="mt-4 space-y-2 text-sm text-gray-700">
          <li>• 正在跑的这一版不会被改动，也不会自动批准。</li>
          <li>• 系统只会另建一份草稿；你看完再决定要不要批准。</li>
          <li>• 生成后页面会切到新草稿；记得切回正在执行的那一份。</li>
        </ul>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <MeButton type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>先不生成</MeButton>
          <MeButton type="button" variant="ghost" size="sm" className="border-red-300 text-red-700" onClick={onConfirm} disabled={busy}>
            {busy ? '正在生成草稿…' : '生成草稿'}
          </MeButton>
        </div>
      </div>
    </div>
  )
}

export function DeliveryStageCard({ view, busy, marking = false, canAct, onPropose, onMark, actionsOnly }: Props) {
  const [scaleOpen, setScaleOpen] = useState(false)
  if (!actionsOnly) return null

  const locked = busy || marking
  const showMark = canAct && Boolean(onMark)
  const showPropose = canAct && view.can_propose && Boolean(onPropose)
  if (!showMark && !showPropose) return null
  const backToTest = view.stage === 'steady'

  const confirmPropose = () => { setScaleOpen(false); onPropose?.() }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {showMark && onMark && (
          <MeButton type="button" variant="ghost" size="sm" disabled={locked} onClick={() => {
            if (!window.confirm(CONFIRM)) return
            onMark(backToTest ? 'test' : 'steady')
          }}>
            {marking ? '正在记下…' : backToTest ? '改回试投' : '标为稳住'}
          </MeButton>
        )}
        {showPropose && onPropose && (
          <MeButton type="button" variant="ghost" size="sm" className="border-red-300 text-red-700" disabled={locked} onClick={() => setScaleOpen(true)}>
            {busy ? '正在生成草稿…' : '生成放量草稿'}
          </MeButton>
        )}
      </div>
      <ScaleDraftConfirmDialog open={scaleOpen} busy={busy} onCancel={() => setScaleOpen(false)} onConfirm={confirmPropose} />
    </>
  )
}
