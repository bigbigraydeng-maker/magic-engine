'use client'

/**
 * 推广计划 —— PM 每周的一页纸。
 * 从上到下：一句话头条 → 本周对账 → 下一阶段检查清单 → 两个按钮（按计划继续 / 批准计划）。
 * 设计稿：docs/specs/2026-10-14-promo-plan-board-design-v0.1.md §9
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import type { MarketingPlan } from '@/lib/marketing-plan/types'
import type { PromoBoard } from '@/lib/marketing-plan/promo/board'
import { approveButtonState, continueButtonVisible } from '@/lib/marketing-plan/promo/labels'
import { buildPromoSample, describePromoSpec } from '@/lib/marketing-plan/promo/overview'
import { readPromoSpec } from '@/lib/marketing-plan/promo/spec'
import { ApprovalRecord } from './_components/ApprovalRecord'
import { PlanOverview } from './_components/PlanOverview'
import { ScheduleTable } from './_components/ScheduleTable'
import { expandPromoSchedule } from '@/lib/marketing-plan/promo/schedule'
import { DEFAULT_PROMO_PLAYBOOK } from '@/lib/marketing-plan/promo/playbooks'
import { ReconcileTable } from './_components/ReconcileTable'
import { GateList } from './_components/GateList'
import type { PromoOptions } from '@/lib/marketing-plan/promo/options'
import { PromoSpecEditor } from './_components/PromoSpecEditor'
import { PromoSpecForm } from './_components/PromoSpecForm'

/** 计划内容变了（含从「高级」保存）就换 key，让表格和文本编辑器都重新读最新内容。 */
const planKey = (p: MarketingPlan) => `${p.id}:${JSON.stringify((p.plan_data as unknown as { promo?: unknown })?.promo ?? null)}`

const hasPromo = (p: MarketingPlan) => !!(p.plan_data as unknown as { promo?: unknown })?.promo

/** 默认看哪份：有推广结构的已批准计划 > 有推广结构的草稿 > 任意草稿。 */
function pickDefault(plans: MarketingPlan[]): MarketingPlan | null {
  const live = plans.filter(p => p.status !== 'archived')
  return live.find(p => p.status === 'approved' && hasPromo(p))
    ?? live.find(p => p.status === 'draft' && hasPromo(p))
    ?? live.find(p => p.status === 'draft')
    ?? null
}

export function PromoPlanClient() {
  const clientId = useParams().id as string
  const [plans, setPlans] = useState<MarketingPlan[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [board, setBoard] = useState<PromoBoard | null>(null)
  const [options, setOptions] = useState<PromoOptions | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [showSample, setShowSample] = useState(false)
  const [approverOnly, setApproverOnly] = useState(false)

  const base = `/api/clients/${clientId}/marketing-plan`

  const loadPlans = useCallback(async () => {
    const res = await fetch(base)
    const json = await res.json() as { success: boolean; plans?: MarketingPlan[]; error?: string }
    if (!json.success) throw new Error(json.error ?? '读取计划失败')
    setPlans(json.plans ?? [])
    return json.plans ?? []
  }, [base])

  const loadBoard = useCallback(async (planId: string) => {
    const res = await fetch(`${base}/${planId}/promo`)
    const json = await res.json() as { success: boolean; board?: PromoBoard; options?: PromoOptions; error?: string }
    if (!json.success || !json.board) throw new Error(json.error ?? '读取推广计划失败')
    setBoard(json.board)
    setOptions(json.options ?? null)
  }, [base])

  const refresh = useCallback(async (keepId?: string | null) => {
    setLoading(true); setError(null)
    try {
      const list = await loadPlans()
      const id = keepId ?? pickDefault(list)?.id ?? null
      setSelectedId(id)
      if (id) await loadBoard(id); else setBoard(null)
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
    // 服务端判定当前账号不是 Magic Lab 内部账号时，隐藏需要内部权限的操作
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

  const approve = board ? approveButtonState(board) : null
  // 「今天」按悉尼日期（澳新客户的日历日），不用 UTC，免得早上少算一天
  const todayIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date())
  // 展示用的推广结构：示例开着看示例，否则看这份计划自己的
  const shownSpec = useMemo(
    () => (showSample ? buildPromoSample(todayIso) : selected ? readPromoSpec(selected.plan_data) : null),
    [showSample, selected, todayIso],
  )
  const shownPhases = useMemo(() => (shownSpec ? describePromoSpec(shownSpec) : null), [shownSpec])
  // 目前只有默认排期摆法（行业剧本还没有证据，见 playbooks.ts）
  const schedule = useMemo(() => (shownSpec ? expandPromoSchedule(shownSpec, DEFAULT_PROMO_PLAYBOOK) : null), [shownSpec])
  const approvedLike = selected?.status === 'approved' || selected?.status === 'completed'
  const scheduleMode = showSample ? 'sample' : approvedLike ? 'approved' : 'preview'

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/dashboard/clients/${clientId}`} className="text-gray-400 hover:text-gray-600 text-sm">← 客户主页</Link>
          <span className="text-gray-300">/</span>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">推广计划</h1>
          <Link href={`/dashboard/clients/${clientId}/marketing-plan`} className="ml-auto text-xs text-indigo-600 hover:underline">
            去 Marketing Plan 看任务 →
          </Link>
        </div>

        {plans.length > 1 && (
          <select
            value={selectedId ?? ''}
            onChange={e => { setSelectedId(e.target.value); void refresh(e.target.value) }}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white w-full sm:w-auto"
            aria-label="选择计划"
          >
            {plans.filter(p => p.status !== 'archived').map(p => (
              <option key={p.id} value={p.id}>{p.title}（{p.status === 'draft' ? '草稿' : p.status === 'approved' ? '执行中' : '已完成'}）</option>
            ))}
          </select>
        )}

        {loading && <p className="text-sm text-gray-400 animate-pulse py-6">加载中…</p>}
        {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">读取失败：{error}。这不代表“没有计划”，请稍后重试。</p>}
        {message && <p className="text-sm bg-white border border-gray-200 rounded-lg p-3">{message}</p>}

        {!loading && !error && !selected && (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center">
            <p className="text-sm text-gray-700">这个客户还没有可用的计划。</p>
            <p className="text-xs text-gray-500 mt-1">先到 Marketing Plan 页面生成一份草稿，再回来补上推广计划的阶段。</p>
          </div>
        )}

        {board && selected && (
          <>
            <Headline board={board} plan={selected} />
            {board.approval?.deferred_blockers && board.approval.deferred_blockers.length > 0 && (
              <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-3">
                <p className="text-sm font-semibold text-yellow-800">这些阶段还没过关，开始前必须补齐</p>
                <ul className="mt-2 text-xs text-yellow-800 space-y-1">
                  {board.approval.deferred_blockers.map((b, i) => (
                    <li key={i}>• {b.phase_name}：{b.label}——{b.reason}</li>
                  ))}
                </ul>
              </div>
            )}
            {shownPhases
              ? <PlanOverview phases={shownPhases} sample={showSample} onCloseSample={showSample ? () => setShowSample(false) : undefined} />
              : (
                  <div className="rounded-xl border border-dashed border-gray-300 bg-white p-4 flex flex-wrap items-center gap-3">
                    <p className="text-sm text-gray-700 flex-1">这份计划还没有分阶段的推广安排。先在下面「想自己改？展开」里搭出阶段，广告那一项可以让系统起草预算、受众和素材。</p>
                  </div>
                )}
            {schedule && <ScheduleTable schedule={schedule} mode={scheduleMode} today={todayIso} />}
            <ApprovalRecord plan={selected} />
            {board.reconcile && selected.status === 'approved' && <ReconcileTable rec={board.reconcile} />}
            {board.next_phase && <GateList view={board.next_phase} onVerify={onVerify} busyKey={busy} />}
            {board.has_promo && !board.spec_valid && <SpecProblems board={board} />}

            {approverOnly && (
              <p className="text-xs text-gray-500">批准、核实、保存需要 Magic Lab 内部账号。</p>
            )}
            <div className="flex flex-col sm:flex-row gap-3">
              {!approverOnly && continueButtonVisible(board) && (
                <details className="rounded-lg border border-gray-200 bg-white px-4 py-2">
                  <summary className="text-xs text-gray-500 cursor-pointer">每周手动确认（想自己确认这一周时展开）</summary>
                  <button onClick={onContinue} disabled={busy === 'continue'}
                    className="mt-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg px-5 py-2.5 disabled:opacity-50">
                    按计划继续
                  </button>
                </details>
              )}
              {!approverOnly && approve?.visible && (
                <div className="flex-1">
                  <button onClick={onApprove} disabled={approve.disabled || busy === 'approve'}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg px-5 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed">
                    {busy === 'approve' ? '批准中…' : approve.label}
                  </button>
                  <p className="text-xs text-gray-600 mt-2">{approve.hint}</p>
                  {approve.blockers.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs text-gray-700">
                      {approve.blockers.map((b, i) => <li key={i}>• <strong>{b.label}</strong>：{b.reason}{b.how ? ` ——${b.how}` : ''}</li>)}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {selected.status === 'draft' && !approverOnly && (
              <>
                <details open={!board.has_promo} className="rounded-xl border border-gray-200 bg-white">
                  <summary className="px-4 py-3 text-sm font-medium text-gray-700 cursor-pointer">想自己改？展开（填表、加阶段、看示例）</summary>
                  <div className="p-3 space-y-3">
                    {!showSample && !shownPhases && (
                      <button onClick={() => setShowSample(true)} className="text-sm border border-gray-300 rounded-lg px-4 py-2 hover:bg-gray-50">看示例计划</button>
                    )}
                    <PromoSpecForm key={planKey(selected)} clientId={clientId} plan={selected} options={options} onSaved={() => void refresh(selected.id)} />
                  </div>
                </details>
                <details className="rounded-xl border border-gray-200 bg-white">
                  <summary className="px-4 py-3 text-xs text-gray-500 cursor-pointer">高级：直接改结构文本（只给技术同事用）</summary>
                  <PromoSpecEditor key={planKey(selected)} clientId={clientId} plan={selected} onSaved={() => void refresh(selected.id)} />
                </details>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Headline({ board, plan }: { board: PromoBoard; plan: MarketingPlan }) {
  const draft = plan.status === 'draft'
  const text = draft
    ? '还没批准——批准之前什么都不会发生'
    : board.reconcile?.headline ?? (board.has_promo ? '推广计划的内容有问题，先改好' : '这份计划还没有推广计划的阶段')
  const blind = !draft && !!board.reconcile?.blind
  return (
    <div className={`rounded-xl border px-5 py-4 ${blind ? 'bg-gray-100 border-gray-300' : 'bg-white border-gray-200'}`}>
      <p className="text-xs text-gray-500 mb-1">{plan.title}</p>
      <p className="text-lg font-bold text-gray-900">{text}</p>
      {blind && <p className="text-xs text-gray-600 mt-1">“看不清”不是“正常”：先把上面写的缺项补上，再看对账。</p>}
      {board.today && !board.timezone_known && (
        <p className="text-xs text-yellow-800 mt-1">广告账户的时区还没确定，日期暂按世界标准时间算，花费对账会显示“看不清”。</p>
      )}
    </div>
  )
}

function SpecProblems({ board }: { board: PromoBoard }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4">
      <p className="text-sm font-semibold text-red-800">推广计划的内容有问题，暂时不能批准：</p>
      <ul className="mt-2 text-xs text-red-700 space-y-1">
        {board.issues.map((i, k) => <li key={k}>• {i.path ? `${i.path}：` : ''}{i.message}</li>)}
      </ul>
    </div>
  )
}
