'use client'

import Link from 'next/link'
import type { MarketingPlan } from '@/lib/marketing-plan/types'
import type { PromoBoard } from '@/lib/marketing-plan/promo/board'
import type { DeliveryView } from '@/lib/marketing-plan/promo/stage-evidence'
import type { LiveAdsFact, LiveAdsMessage } from '@/lib/marketing-plan/promo/live-ads-message'
import { describeLiveAds, describeUnrecordedAdsets } from '@/lib/marketing-plan/promo/live-ads-message'
import { dailyTotalCapCents } from '@/lib/marketing-plan/promo/daily-total-cap'
import type { ApproveButtonState } from '@/lib/marketing-plan/promo/labels'
import { LIGHT_META } from '@/lib/marketing-plan/promo/labels'
import { MeButton, MeChip, MePill } from '@/components/ui/me-primitives'
import { DeliveryStageCard } from './DeliveryStageCard'

function headline(board: PromoBoard, plan: MarketingPlan, missing: LiveAdsMessage | null, live: LiveAdsMessage | null): string {
  if (plan.status === 'draft') {
    if (missing?.level === 'red') return '还没批准——有开着的广告组没有批准记录'
    if (live?.level === 'amber') return '还没批准——Meta 里的广告可能已经在花钱'
    return '还没批准——批准之前，ME 的自动动作都不会发生'
  }
  return board.reconcile?.headline ?? (board.has_promo ? '推广计划的内容有问题，先改好' : '这份计划还没有推广计划的阶段')
}

function cta(draft: boolean, board: PromoBoard, delivery: DeliveryView | null, showContinue: boolean): string {
  if (draft) return '批准前请先看检查项和下方「填写安排」。'
  if (showContinue) {
    const rec = board.reconcile
    const ok = rec && !rec.blind && !rec.rows.some(r => r.status === 'behind' || r.status === 'over')
    return ok ? '现在请你：确认这一周。对账看上去正常。' : '现在请你：先看本周对账，再决定是否确认这一周。'
  }
  return delivery?.switch_text ?? '按计划执行中。'
}

interface Props {
  board: PromoBoard
  plan: MarketingPlan
  delivery: DeliveryView | null
  liveAds: LiveAdsFact | null
  liveLink: string[] | null
  liveAdsVisible: boolean
  clientId: string
  busy: string | null
  marking: boolean
  approverOnly: boolean
  approve: ApproveButtonState | null
  showContinue: boolean
  onContinue: () => void
  onApprove: () => void
  onPropose: () => void
  onMark: (stage: 'steady' | 'test') => void
  onOpenEditor: () => void
}

export function PromoPlanStatusCard(p: Props) {
  const draft = p.plan.status === 'draft'
  const missing = describeUnrecordedAdsets(p.liveAds)
  const live = describeLiveAds(p.liveAds)
  const cents = dailyTotalCapCents(p.plan.plan_data)
  const cap = cents === null ? '—' : (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2)) + ' 元'
  const canAct = !p.approverOnly && p.plan.status === 'approved'
  const checks = [...(p.board.approval?.blockers ?? []), ...(p.board.approval?.unverified ?? [])]

  return (
    <section className="rounded-[24px] border border-black/10 bg-white p-5 shadow-sm" aria-label="推广计划状态">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
          <p className="text-[11px] font-semibold uppercase text-gray-500">{draft ? '当前计划' : '正在执行的计划'}</p>
          <p className="mt-1 text-sm font-bold text-gray-900">{p.plan.title}</p>
          <div className="mt-2">{draft ? <MeChip gold>草稿</MeChip> : <MePill tone="exec">执行中</MePill>}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
          <p className="text-[11px] font-semibold uppercase text-gray-500">投放阶段</p>
          <div className="mt-2">
            {draft || !p.delivery ? <p className="text-sm text-gray-500">批准后才有阶段标签</p>
              : p.delivery.stage === 'steady' ? <MePill tone="track">稳住</MePill>
              : p.delivery.stage === 'test' ? <MePill tone="sched">试投</MePill>
              : <MePill tone="exec">{p.delivery.stage_label}</MePill>}
          </div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
          <p className="text-[11px] font-semibold uppercase text-gray-500">每天上限</p>
          <p className="mt-1 text-2xl font-bold text-[#C4912E]">{cap}</p>
        </div>
      </div>

      <p className="mt-4 text-lg font-semibold text-gray-900">{headline(p.board, p.plan, missing, live)}</p>

      {p.liveAdsVisible && missing && (
        <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {missing.text} <Link className="underline" href={`/dashboard/clients/${p.clientId}/ads-health`}>去作战地图</Link>
        </p>
      )}
      {p.liveAdsVisible && live && <p className="mt-2 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-900">{live.text}</p>}
      {p.liveAdsVisible && p.liveLink?.map((line, i) => <p key={i} className="mt-1 text-sm text-gray-700">{line}</p>)}
      {!draft && p.delivery?.draft_note && <p className="mt-2 text-xs text-green-800 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{p.delivery.draft_note}</p>}

      {draft && checks.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs">
          {checks.map(r => (
            <li key={`${r.phase_id}:${r.key}`}>{LIGHT_META[r.light].dot} {r.label}：{r.reason}</li>
          ))}
        </ul>
      )}

      <div className="mt-4 rounded-xl bg-gray-50 border border-gray-200 px-4 py-3">
        <p className="text-sm font-medium text-gray-900">{cta(draft, p.board, p.delivery, p.showContinue)}</p>
        {p.approverOnly ? (
          <p className="mt-2 text-xs text-gray-500">批准、核实、保存需要 Magic Lab 内部账号。</p>
        ) : (
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            {draft && (
              <>
                <MeButton type="button" variant="ghost" size="sm" onClick={p.onOpenEditor}>先保存</MeButton>
                {p.approve?.visible && (
                  <MeButton type="button" size="sm" disabled={p.approve.disabled || p.busy === 'approve'} onClick={p.onApprove}>
                    {p.busy === 'approve' ? '批准中…' : p.approve.label}
                  </MeButton>
                )}
              </>
            )}
            {!draft && p.delivery && (
              <DeliveryStageCard view={p.delivery} busy={p.busy === 'propose'} marking={p.marking} canAct={canAct} onPropose={p.onPropose} onMark={p.onMark} actionsOnly />
            )}
            {!draft && p.showContinue && (
              <MeButton type="button" size="sm" disabled={p.busy === 'continue'} onClick={p.onContinue}>
                {p.busy === 'continue' ? '记录中…' : '确认这一周'}
              </MeButton>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
