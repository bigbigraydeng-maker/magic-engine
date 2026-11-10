'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import type { MarketingPlan } from '@/lib/marketing-plan/types'
import type { PromoBoard } from '@/lib/marketing-plan/promo/board'
import type { DeliveryView } from '@/lib/marketing-plan/promo/stage-evidence'
import type { LiveAdsFact, LiveAdsMessage } from '@/lib/marketing-plan/promo/live-ads-message'
import { describeLiveAds, describeUnrecordedAdsets } from '@/lib/marketing-plan/promo/live-ads-message'
import { dailyTotalCapCents } from '@/lib/marketing-plan/promo/daily-total-cap'
import type { ApproveButtonState } from '@/lib/marketing-plan/promo/labels'
import { MeButton, MeChip, MePill } from '@/components/ui/me-primitives'
import { DeliveryStageCard } from './DeliveryStageCard'
import type { ApprovalVerdict } from '@/lib/marketing-plan/promo/gates'
import { LIGHT_META } from '@/lib/marketing-plan/promo/labels'

function capDisplay(planData: unknown): { value: string; hint: string } {
  const cents = dailyTotalCapCents(planData)
  if (cents === null) {
    return { value: '—', hint: '还没在计划里写下每天的广告总上限。' }
  }
  const major = cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2)
  return { value: `${major} 元`, hint: '改这个数字要重新批准计划。' }
}

function planStatusChip(status: MarketingPlan['status']) {
  if (status === 'draft') return <MeChip gold>草稿</MeChip>
  if (status === 'approved') return <MePill tone="exec">执行中</MePill>
  if (status === 'completed') return <MePill tone="attn">已完成</MePill>
  return <MeChip>存档</MeChip>
}

function stagePill(stage: DeliveryView['stage'], draft: boolean) {
  if (draft) return <span className="text-sm text-black/55">批准后才有阶段标签</span>
  if (stage === 'steady') return <MePill tone="track">稳住</MePill>
  if (stage === 'test') return <MePill tone="sched">试投</MePill>
  if (stage === 'scale') return <MePill tone="exec">放量</MePill>
  return <MePill tone="attn">未设</MePill>
}

function headlineText(board: PromoBoard, plan: MarketingPlan, missing: LiveAdsMessage | null, live: LiveAdsMessage | null): string {
  const draft = plan.status === 'draft'
  if (draft) {
    if (missing?.level === 'red') return '还没批准——有开着的广告组没有批准记录'
    if (live?.level === 'amber') return '还没批准——Meta 里的广告可能已经在花钱'
    return '还没批准——批准之前，ME 的自动动作都不会发生'
  }
  return board.reconcile?.headline ?? (board.has_promo ? '推广计划的内容有问题，先改好' : '这份计划还没有推广计划的阶段')
}

function ctaLine(args: {
  draft: boolean
  board: PromoBoard
  delivery: DeliveryView | null
  showContinue: boolean
}): string {
  const { draft, board, delivery, showContinue } = args
  if (draft) return '批准前请先看下面检查项，和「填写安排」里的内容。'
  if (showContinue) {
    const rec = board.reconcile
    const ok = rec && !rec.blind && !rec.rows.some(r => r.status === 'behind' || r.status === 'over')
    if (ok) return '现在请你：确认这一周。对账看上去正常。'
    return '现在请你：先看本周对账，再决定是否确认这一周。'
  }
  if (delivery?.switch_text) return delivery.switch_text
  return '按计划执行中；有放量或改阶段请用下方按钮。'
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

export function PromoPlanStatusCard({
  board, plan, delivery, liveAds, liveLink, liveAdsVisible, clientId,
  busy, marking, approverOnly, approve, showContinue,
  onContinue, onApprove, onPropose, onMark, onOpenEditor,
}: Props) {
  const draft = plan.status === 'draft'
  const missing = describeUnrecordedAdsets(liveAds)
  const live = describeLiveAds(liveAds)
  const headline = headlineText(board, plan, missing, live)
  const cap = capDisplay(plan.plan_data)
  const blind = !draft && !!board.reconcile?.blind
  const canAct = !approverOnly && plan.status === 'approved'

  return (
    <section
      className="rounded-[24px] border border-black/10 bg-white p-5 shadow-[0_1px_2px_rgba(26,26,26,.04),0_8px_28px_rgba(26,26,26,.06)]"
      aria-label="推广计划状态"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCol title={draft ? '当前看的计划' : '正在执行的计划'}>
          <p className="font-display text-base font-semibold text-[#1A1A1A]">{plan.title}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {planStatusChip(plan.status)}
            <span className="text-xs text-black/45">{draft ? '尚未批准' : '已批准，不是草稿'}</span>
          </div>
        </StatCol>
        <StatCol title="投放阶段">
          {delivery ? stagePill(delivery.stage, draft) : <span className="text-sm text-black/45">—</span>}
          {delivery && !draft && <p className="mt-2 text-xs text-black/55">{delivery.goal}</p>}
        </StatCol>
        <StatCol title="每天上限">
          <p className="font-display text-2xl font-bold text-[#C4912E]">{cap.value}</p>
          <p className="mt-1 text-xs text-black/50">{cap.hint}</p>
        </StatCol>
      </div>

      <h2 className={`mt-4 font-display text-lg font-semibold ${blind ? 'text-black/55' : 'text-[#1A1A1A]'}`}>
        {headline}
      </h2>

      {liveAdsVisible && <LiveAdsNotice fact={liveAds} missing={missing} message={live} clientId={clientId} />}
      {liveAdsVisible && liveLink && liveLink.length > 0 && (
        <ul className="mt-2 space-y-1 rounded-[12px] border border-black/[.06] bg-[#FBF8F3] px-3 py-2 text-sm text-black/70">
          {liveLink.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
        </ul>
      )}
      {blind && <p className="mt-2 text-xs text-black/50">「看不清」不是「正常」：先把上面写的缺项补上，再看对账。</p>}
      {board.today && !board.timezone_known && (
        <p className="mt-2 rounded-[12px] border border-[#C4912E]/30 bg-[#C4912E]/10 px-3 py-2 text-xs text-[#8A5E12]">
          广告账户的时区还没确定，日期暂按世界标准时间算，花费对账会显示「看不清」。
        </p>
      )}

      {draft && <div className="mt-4"><DraftChecklist approval={board.approval} /></div>}

      {!draft && delivery && (
        <div className="mt-4 space-y-2 text-sm text-black/65">
          <p>{delivery.ratio_text}</p>
          {delivery.draft_note && (
            <p className="rounded-[12px] border border-[#5C8A4A]/25 bg-[#5C8A4A]/10 px-3 py-2 text-xs text-[#3d5c32]">
              {delivery.draft_note}
            </p>
          )}
        </div>
      )}

      <div className="mt-5 rounded-[16px] border border-black/[.06] bg-[#FBF8F3] px-4 py-3">
        <p className="text-sm font-medium text-[#1A1A1A]">{ctaLine({ draft, board, delivery, showContinue })}</p>
        <PlatformActions
          draft={draft}
          busy={busy}
          marking={marking}
          approverOnly={approverOnly}
          approve={approve}
          showContinue={showContinue}
          delivery={delivery}
          canAct={canAct}
          onContinue={onContinue}
          onApprove={onApprove}
          onPropose={onPropose}
          onMark={onMark}
          onOpenEditor={onOpenEditor}
        />
      </div>

      {!draft && delivery && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-medium text-black/45">投放阶段详情与受众顺序</summary>
          <div className="mt-3">
            <DeliveryStageCard
              view={delivery}
              busy={busy === 'propose'}
              marking={marking}
              canAct={canAct}
              onPropose={onPropose}
              onMark={onMark}
              embedded
            />
          </div>
        </details>
      )}
    </section>
  )
}

function StatCol({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-[16px] border border-black/[.06] bg-[#FBF8F3]/80 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-black/40">{title}</p>
      <div className="mt-2">{children}</div>
    </div>
  )
}

function PlatformActions({
  draft, busy, marking, approverOnly, approve, showContinue, delivery, canAct,
  onContinue, onApprove, onPropose, onMark, onOpenEditor,
}: {
  draft: boolean
  busy: string | null
  marking: boolean
  approverOnly: boolean
  approve: ApproveButtonState | null
  showContinue: boolean
  delivery: DeliveryView | null
  canAct: boolean
  onContinue: () => void
  onApprove: () => void
  onPropose: () => void
  onMark: (stage: 'steady' | 'test') => void
  onOpenEditor: () => void
}) {
  if (approverOnly) {
    return <p className="mt-2 text-xs text-black/45">批准、核实、保存需要 Magic Lab 内部账号。</p>
  }
  return (
    <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
      {draft && (
        <>
          <MeButton type="button" variant="ghost" size="sm" onClick={onOpenEditor}>
            先保存
          </MeButton>
          {approve?.visible && (
            <div className="flex flex-col items-stretch gap-1 sm:items-end">
              <MeButton type="button" size="sm" disabled={approve.disabled || busy === 'approve'} onClick={onApprove}>
                {busy === 'approve' ? '批准中…' : approve.label}
              </MeButton>
              {approve.blockers.length > 0 && (
                <ul className="max-w-sm text-left text-xs text-black/55">
                  {approve.blockers.map((b, i) => <li key={i}>• {b.label}：{b.reason}</li>)}
                </ul>
              )}
            </div>
          )}
        </>
      )}
      {!draft && delivery && (
        <DeliveryStageCard
          view={delivery}
          busy={busy === 'propose'}
          marking={marking}
          canAct={canAct}
          onPropose={onPropose}
          onMark={onMark}
          actionsOnly
        />
      )}
      {!draft && showContinue && (
        <MeButton type="button" size="sm" disabled={busy === 'continue'} onClick={onContinue}>
          {busy === 'continue' ? '记录中…' : '确认这一周'}
        </MeButton>
      )}
    </div>
  )
}

function DraftChecklist({ approval }: { approval: ApprovalVerdict | null }) {
  if (!approval || approval.results.length === 0) return null
  return (
    <InsetPanel>
      <p className="text-xs font-semibold uppercase tracking-wide text-black/45">批准前要检查的项</p>
      <ul className="mt-2 space-y-2">
        {approval.results.map(r => {
          const meta = LIGHT_META[r.light]
          return (
            <li key={`${r.phase_id ?? ''}:${r.key}`} className="flex gap-2 text-sm">
              <span className={`shrink-0 text-xs font-medium border rounded-full px-2 py-0.5 ${meta.cls}`}>
                {meta.dot} {meta.label}
              </span>
              <div className="min-w-0">
                <p className="font-medium text-[#1A1A1A]">{r.label}</p>
                {r.light !== 'green' && <p className="text-xs text-black/55">{r.reason}</p>}
              </div>
            </li>
          )
        })}
      </ul>
    </InsetPanel>
  )
}

function InsetPanel({ children }: { children: ReactNode }) {
  return <div className="rounded-[16px] border border-black/[.06] bg-[#FBF8F3] px-4 py-3">{children}</div>
}

function LiveAdsNotice({ fact, missing, message, clientId }: {
  fact: LiveAdsFact | null
  missing: LiveAdsMessage | null
  message: LiveAdsMessage | null
  clientId: string
}) {
  const tone = (level: LiveAdsMessage['level']) => level === 'red'
    ? 'border-[#C2453A]/30 bg-[#C2453A]/8 text-[#8b2e26]'
    : level === 'amber'
      ? 'border-[#C4912E]/35 bg-[#C4912E]/10 text-[#6a4a12]'
      : 'border-black/10 bg-[#FBF8F3] text-black/65'
  return (
    <>
      {missing && (
        <p className={`mt-2 rounded-[12px] border px-3 py-2 text-sm ${tone(missing.level)}`}>
          {missing.text}{' '}
          <Link className="font-medium underline" href={`/dashboard/clients/${clientId}/ads-health`}>去作战地图看「已开投」</Link>
        </p>
      )}
      {message && <p className={`mt-2 rounded-[12px] border px-3 py-2 text-sm ${tone(message.level)}`}>{message.text}</p>}
      {!missing && !message && (!fact || !fact.ok) && (
        <p className="mt-2 text-xs text-black/50">读不到广告花费，没法确认 Meta 里有没有在跑的广告。</p>
      )}
    </>
  )
}
