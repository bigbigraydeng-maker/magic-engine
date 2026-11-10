'use client'

/**
 * 推广计划 —— PM 每周的一页纸。
 * 设计稿：Figma LqrVdEMndi3Zr5rQfUeKwW（2-2 / 3-2 / 4-2）
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import type { MarketingPlan } from '@/lib/marketing-plan/types'
import type { PromoBoard } from '@/lib/marketing-plan/promo/board'
import { approveButtonState, continueButtonVisible } from '@/lib/marketing-plan/promo/labels'
import { buildPromoSample, describePromoSpec } from '@/lib/marketing-plan/promo/overview'
import { readPromoSpec } from '@/lib/marketing-plan/promo/spec'
import { creativeRefsOfPhase } from '@/lib/marketing-plan/promo/phase-creatives'
import { pickPlanForPrescription } from '@/lib/marketing-plan/promo/plan-pick'
import { ApprovalRecord } from './_components/ApprovalRecord'
import { PlanOverview } from './_components/PlanOverview'
import type { DeliveryView } from '@/lib/marketing-plan/promo/stage-evidence'
import { ScheduleTable } from './_components/ScheduleTable'
import { expandPromoSchedule } from '@/lib/marketing-plan/promo/schedule'
import { todayInNz } from '@/lib/marketing-plan/promo/schedule-view'
import { DEFAULT_PROMO_PLAYBOOK } from '@/lib/marketing-plan/promo/playbooks'
import { ReconcileTable } from './_components/ReconcileTable'
import { GateList } from './_components/GateList'
import type { GoalPrescriptionView } from '@/lib/marketing-plan/promo/goal-prescription'
import type { PromoOptions } from '@/lib/marketing-plan/promo/options'
import { PrescriptionCard } from './_components/PrescriptionCard'
import { adsRunningFrom } from '@/lib/marketing-plan/promo/live-ads-message'
import type { LiveAdsFact } from '@/lib/marketing-plan/promo/live-ads-message'
import { BlankDraftPlanButton } from './_components/BlankDraftPlanButton'
import { PromoSpecEditor } from './_components/PromoSpecEditor'
import { PromoSpecForm } from './_components/PromoSpecForm'
import { PromoPlanStatusCard } from './_components/PromoPlanStatusCard'
import { PromoCollapsible } from './_components/PromoCollapsible'

const planKey = (p: MarketingPlan) => `${p.id}:${JSON.stringify((p.plan_data as unknown as { promo?: unknown })?.promo ?? null)}`

export function PromoPlanClient() {
  const clientId = useParams().id as string
  const [plans, setPlans] = useState<MarketingPlan[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [board, setBoard] = useState<PromoBoard | null>(null)
  const [options, setOptions] = useState<PromoOptions | null>(null)
  const [liveAds, setLiveAds] = useState<LiveAdsFact | null>(null)
  const [liveLink, setLiveLink] = useState<string[] | null>(null)
  const [liveAdsVisible, setLiveAdsVisible] = useState(false)
  const [prescription, setPrescription] = useState<GoalPrescriptionView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [showSample, setShowSample] = useState(false)
  const [approverOnly, setApproverOnly] = useState(false)
  const [delivery, setDelivery] = useState<DeliveryView | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const editorRef = useRef<HTMLDetailsElement>(null)

  const base = `/api/clients/${clientId}/marketing-plan`

  const loadPlans = useCallback(async () => {
    const res = await fetch(base)
    const json = await res.json() as {
      success: boolean
      plans?: MarketingPlan[]
      prescription?: GoalPrescriptionView | null
      error?: string
    }
    if (!json.success) throw new Error(json.error ?? '读取计划失败')
    const plans = json.plans ?? []
    setPlans(plans)
    return { plans, prescription: json.prescription ?? null }
  }, [base])

  const loadBoard = useCallback(async (planId: string) => {
    const res = await fetch(`${base}/${planId}/promo`)
    const json = await res.json() as {
      success: boolean
      board?: PromoBoard
      options?: PromoOptions
      live_ads?: LiveAdsFact | null
      live_link?: { lines: string[] } | null
      live_ads_visible?: boolean
      prescription?: GoalPrescriptionView | null
      delivery?: DeliveryView | null
      error?: string
    }
    if (!json.success || !json.board) throw new Error(json.error ?? '读取推广计划失败')
    setBoard(json.board)
    setDelivery(json.delivery ?? null)
    setOptions(json.options ?? null)
    setLiveAds(json.live_ads ?? null)
    setLiveLink(json.live_link?.lines ?? null)
    setLiveAdsVisible(json.live_ads_visible === true)
    setPrescription(json.prescription ?? null)
  }, [base])

  const refresh = useCallback(async (keepId?: string | null) => {
    setLoading(true); setError(null)
    try {
      const loaded = await loadPlans()
      const id = keepId ?? pickPlanForPrescription(loaded.plans, loaded.prescription?.goal_id ?? null)?.id ?? null
      setSelectedId(id)
      if (id) await loadBoard(id)
      else { setBoard(null); setDelivery(null); setPrescription(loaded.prescription) }
    } catch (e) {
      setError((e as Error).message)
    } finally { setLoading(false) }
  }, [loadPlans, loadBoard])

  useEffect(() => { void refresh(null) }, [refresh])

  const selected = useMemo(() => plans.find(p => p.id === selectedId) ?? null, [plans, selectedId])
  const post = async (path: string, body?: unknown) => {
    const res = await fetch(`${base}/${selectedId}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
    })
    const json = await res.json() as { success: boolean; error?: string; reason?: string; blockers?: { label: string; reason: string }[] }
    if (json.reason === 'approver_only') setApproverOnly(true)
    return json
  }

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setMessage(null)
    try { await fn(); await refresh(selectedId) } catch (e) { setMessage(`✗ ${(e as Error).message}`) } finally { setBusy(null) }
  }

  const onVerify = (phaseId: string, checkKey: string) =>
    run(`${phaseId}:${checkKey}`, async () => {
      const j = await post('/promo/verify', { phase_id: phaseId, check_key: checkKey })
      if (!j.success) throw new Error(j.error ?? '记录失败')
    })

  const onContinue = () => run('continue', async () => {
    const j = await post('/promo/acknowledge')
    if (!j.success) throw new Error(j.error ?? '记录失败')
    setMessage('✓ 已记录：这一周你看过、没意见。计划和预算都没有改动。')
  })

  const onMark = (stage: 'steady' | 'test') => {
    void (async () => {
      setBusy('mark'); setMessage(null)
      try {
        const res = await fetch(`${base}/${selectedId}/promo/delivery`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage }),
        })
        const json = await res.json() as { success: boolean; error?: string; reason?: string }
        if (json.reason === 'approver_only') setApproverOnly(true)
        if (!json.success) throw new Error(json.error ?? '没有改成')
        setMessage(stage === 'steady' ? '✓ 已标为稳住。预算和每天总上限没有改。' : '✓ 已改回试投。预算和每天总上限没有改。')
        await refresh(selectedId)
      } catch (e) {
        setMessage(`✗ ${(e as Error).message}`)
      } finally {
        setBusy(null)
      }
    })()
  }

  const onPropose = () => {
    void (async () => {
      setBusy('propose'); setMessage(null)
      try {
        const res = await fetch(`${base}/${selectedId}/promo/stage-proposal`, { method: 'POST' })
        const json = await res.json() as { success: boolean; error?: string; plan_id?: string; reason?: string }
        if (json.reason === 'approver_only') setApproverOnly(true)
        if (!json.success || !json.plan_id) throw new Error(json.error ?? '没有生成草稿')
        setMessage('✓ 已生成一份放量草稿。正在跑的计划没有改，也没有自动批准。')
        await refresh(json.plan_id)
      } catch (e) {
        setMessage(`✗ ${(e as Error).message}`)
      } finally {
        setBusy(null)
      }
    })()
  }

  const onApprove = () => {
    if (!confirm('确认批准这份计划？批准后只会派出内部待办，广告不会自动投放。')) return
    return run('approve', async () => {
      const j = await post('/approve')
      if (!j.success) {
        const detail = (j.blockers ?? []).map(b => `${b.label}：${b.reason}`).join('；')
        throw new Error(`${j.error ?? '批准失败'}${detail ? `（${detail}）` : ''}`)
      }
      setMessage('✓ 计划已批准。')
    })
  }

  const openEditor = () => {
    setEditorOpen(true)
    queueMicrotask(() => {
      editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      if (editorRef.current && !editorRef.current.open) editorRef.current.open = true
    })
  }

  const approve = board ? approveButtonState(board) : null
  const todayIso = todayInNz()
  const shownSpec = useMemo(
    () => (showSample ? buildPromoSample(todayIso) : selected ? readPromoSpec(selected.plan_data) : null),
    [showSample, selected, todayIso],
  )
  const accountLabels = useMemo(() => {
    const map: Record<string, string | null> = {}
    for (const account of options?.accounts ?? []) map[account.id] = account.label ?? null
    return map
  }, [options])
  const shownPhases = useMemo(
    () => (shownSpec ? describePromoSpec(shownSpec, showSample ? {} : accountLabels) : null),
    [shownSpec, showSample, accountLabels],
  )
  const schedule = useMemo(() => (shownSpec ? expandPromoSchedule(shownSpec, DEFAULT_PROMO_PLAYBOOK) : null), [shownSpec])
  const approvedLike = selected?.status === 'approved' || selected?.status === 'completed'
  const viewPhases = useMemo(() => (shownSpec?.phases ?? []).map(p => ({ id: p.id, name: p.name, start_date: p.start_date })), [shownSpec])
  const scheduleMode = showSample ? 'sample' : approvedLike ? 'approved' : 'preview'
  const showContinue = board ? continueButtonVisible(board) : false
  const isDraft = selected?.status === 'draft'

  return (
    <div className="min-h-screen bg-[#FBF8F3] px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-4xl space-y-5">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.14em] text-black/40">客户工作台</p>
            <h1 className="font-display text-2xl font-bold text-[#1A1A1A]">推广计划</h1>
            <p className="mt-1 text-sm text-black/55">
              {isDraft
                ? '当前是草稿：批准前不会开投，也不会自动派活。'
                : selected
                  ? `执行中：${selected.title}`
                  : '先有计划，批准了才动手；每周一页看清花了多少、做得怎么样。'}
            </p>
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <BlankDraftPlanButton clientId={clientId} onCreated={id => { void refresh(id) }} />
            <Link href={`/dashboard/clients/${clientId}/marketing-plan`} className="text-xs text-[#C4912E] hover:underline">
              去 Marketing Plan 看任务 →
            </Link>
          </div>
        </header>

        {plans.length > 1 && (
          <select
            value={selectedId ?? ''}
            onChange={e => { setSelectedId(e.target.value); void refresh(e.target.value) }}
            className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm sm:w-auto"
            aria-label="选择计划"
          >
            {plans.filter(p => p.status !== 'archived').map(p => (
              <option key={p.id} value={p.id}>{p.title}（{p.status === 'draft' ? '草稿' : p.status === 'approved' ? '执行中' : '已完成'}）</option>
            ))}
          </select>
        )}

        {loading && <p className="py-6 text-sm text-black/40 animate-pulse">加载中…</p>}
        {error && (
          <p className="rounded-[16px] border border-[#C2453A]/25 bg-[#C2453A]/8 p-3 text-sm text-[#8b2e26]">
            读取失败：{error}。请稍后重试。
          </p>
        )}
        {message && (
          <p className="rounded-[16px] border border-black/10 bg-white p-3 text-sm text-black/75">{message}</p>
        )}

        {!loading && !error && !selected && (
          <div className="rounded-[20px] border border-dashed border-black/15 bg-white p-8 text-center">
            <p className="text-sm text-black/70">这个客户还没有可用的计划。</p>
            <p className="mt-1 text-xs text-black/45">用「新建空白草稿计划」挂到目标后，在「填写安排」里搭阶段。</p>
          </div>
        )}

        {board && selected && (
          <>
            <PromoPlanStatusCard
              board={board}
              plan={selected}
              delivery={delivery && !showSample ? delivery : null}
              liveAds={liveAdsVisible ? liveAds : null}
              liveLink={liveAdsVisible ? liveLink : null}
              liveAdsVisible={liveAdsVisible}
              clientId={clientId}
              busy={busy}
              marking={busy === 'mark'}
              approverOnly={approverOnly}
              approve={approve}
              showContinue={showContinue}
              onContinue={onContinue}
              onApprove={onApprove}
              onPropose={onPropose}
              onMark={onMark}
              onOpenEditor={openEditor}
            />

            {board.approval?.deferred_blockers && board.approval.deferred_blockers.length > 0 && (
              <div className="rounded-[16px] border border-[#C4912E]/35 bg-[#C4912E]/10 px-4 py-3">
                <p className="text-sm font-semibold text-[#6a4a12]">这些阶段还没过关，开始前必须补齐</p>
                <ul className="mt-2 space-y-1 text-xs text-[#6a4a12]">
                  {board.approval.deferred_blockers.map((b, i) => (
                    <li key={i}>• {b.phase_name}：{b.label}——{b.reason}</li>
                  ))}
                </ul>
              </div>
            )}

            {shownPhases
              ? <PlanOverview phases={shownPhases} sample={showSample} onCloseSample={showSample ? () => setShowSample(false) : undefined} />
              : (
                <div className="rounded-[20px] border border-dashed border-black/15 bg-white p-4">
                  <p className="text-sm text-black/65">这份计划还没有分阶段的推广安排。在下方「填写安排」里搭出阶段。</p>
                </div>
              )}

            {schedule && (
              <PromoCollapsible
                title="排期表 · 每天做什么"
                subtitle={scheduleMode === 'preview' ? '批准前预览，不会派活。' : '按日展开；对账看本周区块。'}
                defaultOpen={false}
              >
                <ScheduleTable
                  schedule={schedule}
                  mode={scheduleMode}
                  today={todayIso}
                  phases={viewPhases}
                  adsRunning={adsRunningFrom(liveAdsVisible ? liveAds : null)}
                />
              </PromoCollapsible>
            )}

            {board.reconcile && selected.status === 'approved' && (
              <PromoCollapsible title="本周对账" subtitle="最近 7 个完整自然日" defaultOpen>
                <ReconcileTable rec={board.reconcile} />
              </PromoCollapsible>
            )}

            <PromoCollapsible title="批准记录" subtitle="谁批的、批时检查项" defaultOpen={false}>
              <ApprovalRecord plan={selected} />
            </PromoCollapsible>

            {board.next_phase && (
              <PromoCollapsible
                title="下一时间段开始前要检查的事"
                subtitle={board.next_phase.phase.name}
                defaultOpen
              >
                <GateList
                  view={board.next_phase}
                  onVerify={onVerify}
                  busyKey={busy}
                  creatives={{
                    clientId,
                    refs: creativeRefsOfPhase(selected ? readPromoSpec(selected.plan_data) : null, board.next_phase.phase.id),
                    canAct: !approverOnly,
                    onChanged: () => { void refresh(selectedId) },
                  }}
                />
              </PromoCollapsible>
            )}

            {prescription && (
              <PromoCollapsible title="处方" subtitle="花钱与回顾写在处方页，此处只读" defaultOpen={false}>
                <PrescriptionCard clientId={clientId} prescription={prescription} />
              </PromoCollapsible>
            )}

            {board.has_promo && !board.spec_valid && <SpecProblems board={board} />}

            {approve?.visible && approve.hint && isDraft && (
              <p className="text-xs text-black/50">{approve.hint}</p>
            )}

            {isDraft && !approverOnly && (
              <>
                <details ref={editorRef} open={editorOpen || !board.has_promo} className="rounded-[20px] border border-black/10 bg-white">
                  <summary className="cursor-pointer px-5 py-4 text-sm font-medium text-black/70">填写安排（阶段、预算、内容）</summary>
                  <div className="space-y-3 border-t border-black/[.06] p-4">
                    {!showSample && !shownPhases && (
                      <button type="button" onClick={() => setShowSample(true)} className="rounded-xl border border-black/10 px-4 py-2 text-sm hover:bg-[#FBF8F3]">
                        看示例计划
                      </button>
                    )}
                    <PromoSpecForm key={planKey(selected)} clientId={clientId} plan={selected} options={options} onSaved={() => void refresh(selected.id)} />
                  </div>
                </details>
                <PromoCollapsible title="高级改法" subtitle="直接改结构文本，只给技术同事用" defaultOpen={false}>
                  <PromoSpecEditor key={planKey(selected)} clientId={clientId} plan={selected} onSaved={() => void refresh(selected.id)} />
                </PromoCollapsible>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function SpecProblems({ board }: { board: PromoBoard }) {
  return (
    <div className="rounded-[16px] border border-[#C2453A]/25 bg-[#C2453A]/8 p-4">
      <p className="text-sm font-semibold text-[#8b2e26]">推广计划的内容有问题，暂时不能批准：</p>
      <ul className="mt-2 space-y-1 text-xs text-[#8b2e26]">
        {board.issues.map((i, k) => <li key={k}>• {i.path ? `${i.path}：` : ''}{i.message}</li>)}
      </ul>
    </div>
  )
}
