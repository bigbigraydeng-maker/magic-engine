'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { DerivedState, ItemStatus } from '@/lib/launch-signoff/types'

export interface SwitchRow {
  readonly name: string
  readonly autopilotEnabled: boolean
  readonly dryRun: boolean
}

export interface PanelChecklistItem {
  readonly key: string
  readonly title: string
  readonly goal: string
  readonly passCriteria: string
  readonly owner: string
  readonly machineVerifiable: boolean
}

export interface PanelChecklist {
  readonly featureKey: string
  readonly title: string
  readonly scopeNote: string
  readonly riskLevel: 'A'
  readonly items: readonly PanelChecklistItem[]
}

export interface SignoffPanelProps {
  readonly checklist: PanelChecklist
  readonly state: DerivedState | null
  readonly loadError: boolean
  readonly canSign: boolean
  readonly switchRows: readonly SwitchRow[]
  readonly switchLoadError: boolean
}

const STATUS_LABEL: Record<ItemStatus, string> = {
  untested: '没测',
  pending_review: '待复核',
  passed: '通过',
  failed: '失败',
  locked: '已锁定',
}

function statusChipClass(status: ItemStatus): string {
  if (status === 'failed' || status === 'locked') {
    return 'bg-red-50 text-red-700 border-red-200'
  }
  if (status === 'passed') {
    return 'bg-slate-100 text-slate-700 border-slate-300'
  }
  if (status === 'pending_review') {
    return 'bg-blue-50 text-blue-700 border-blue-200'
  }
  return 'bg-slate-50 text-slate-500 border-slate-200'
}

function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 8) : '—'
}

export default function SignoffPanel(props: SignoffPanelProps) {
  const { checklist, state, loadError, canSign, switchRows, switchLoadError } = props
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const featureKey = checklist.featureKey

  async function postJson(path: string, body: Record<string, unknown>): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        let message = '操作失败，请稍后再试'
        try {
          const data: unknown = await res.json()
          if (data && typeof data === 'object' && 'error' in data) {
            const e = (data as { error?: unknown }).error
            if (typeof e === 'string' && e.length > 0) message = e
          }
        } catch {
          // 响应不是 JSON，用默认文案
        }
        setError(message)
        return false
      }
      router.refresh()
      return true
    } catch {
      setError('网络错误，请稍后再试')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function onConfirmSign() {
    if (!state) return
    const ok = await postJson(`/api/launch-signoff/${featureKey}/sign`, {
      watermark: state.watermark,
      checklistHash: state.checklistHash,
    })
    if (ok) setConfirming(false)
  }

  async function onRevoke() {
    const note = window.prompt('撤销签字的原因（至少 5 个字）')
    if (note === null) return
    if (note.trim().length < 5) {
      setError('撤销原因必须写明（至少 5 个字）')
      return
    }
    await postJson(`/api/launch-signoff/${featureKey}/revoke`, { note: note.trim() })
  }

  const commit8 = state?.currentCommit ? state.currentCommit.slice(0, 8) : '取不到'

  return (
    <div className="p-6 space-y-5">
      {/* 页头 */}
      <div className="rounded-xl border border-me-charcoal/15 bg-white p-4 space-y-2">
        <div className="flex items-center gap-3">
          <h1 className="text-me-charcoal text-xl font-semibold">
            上线签字 · {checklist.title}
          </h1>
          <span className="rounded-full border border-me-charcoal/20 bg-slate-100 px-2 py-0.5 text-xs text-me-charcoal">
            风险级 {checklist.riskLevel}
          </span>
        </div>
        <p className="text-sm text-slate-600">线上提交号：{commit8}</p>
        <p className="text-sm text-slate-600">
          清单指纹：{state ? state.checklistHash.slice(0, 8) : '—'}
        </p>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          {checklist.scopeNote} 这里的签字只记录“测试结论”，<strong>不是上线许可</strong>，也不接任何开关。
        </div>
      </div>

      {/* 演练开关现状 */}
      <div className="rounded-xl border border-me-charcoal/15 bg-white p-4 space-y-2">
        <h2 className="text-me-charcoal font-semibold">演练开关现状（不受签字约束）</h2>
        {switchLoadError ? (
          <p className="text-sm text-red-700">读取失败</p>
        ) : switchRows.length === 0 ? (
          <p className="text-sm text-slate-600">目前没有客户打开自动投放</p>
        ) : (
          <ul className="space-y-1 text-sm text-slate-700">
            {switchRows.map((row) => (
              <li key={row.name}>
                {row.name}: 自动投放{row.autopilotEnabled ? '已开' : '未开'}，演练模式
                {row.dryRun ? '开着（只演练）' : '已关'}
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-slate-600">签字不会翻任何开关；翻开关仍是单独一步。</p>
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 space-y-1">
          <p className="font-semibold">怎么真正刹车（统筹 18 号 10-19 实查，请勿写成“关演练开关即停”）</p>
          <ul className="list-disc pl-5 space-y-0.5">
            <li>演练开关只管 D3 一条路径，<strong>关/开它都不会停掉内核执行</strong>。</li>
            <li>NAL、CTS 的 ads.* 动作策略目前都是 auto_approve：经内核提交信封后<strong>直接执行</strong>。</li>
            <li>人在止损页点的是另一套人工止损信封，<strong>不受 72 小时冷却约束</strong>；冷却只约束 AI 信封。</li>
            <li>真正停内核执行 = 把客户的 autonomy_mode 改回 observe。</li>
          </ul>
        </div>
      </div>

      {/* 读取失败：只显示这一块 */}
      {(loadError || state === null) && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          读取失败：没有显示测试状态，也不能签字。请刷新或稍后再试。
        </div>
      )}

      {!loadError && state !== null && (
        <>
          {state.halted && (
            <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800">
              已触发停止条件：清单已锁定 — {state.haltNote ?? '（无说明）'}
            </div>
          )}

          {/* 清单表格 */}
          <div className="rounded-xl border border-me-charcoal/15 bg-white p-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-2 pr-3 font-medium">编号</th>
                  <th className="py-2 pr-3 font-medium">目标</th>
                  <th className="py-2 pr-3 font-medium">通过判据</th>
                  <th className="py-2 pr-3 font-medium">状态</th>
                  <th className="py-2 pr-3 font-medium">复核</th>
                  <th className="py-2 pr-3 font-medium">被测提交</th>
                </tr>
              </thead>
              <tbody>
                {checklist.items.map((item) => {
                  const view = state.items.find((v) => v.key === item.key)
                  const status: ItemStatus = view?.status ?? 'untested'
                  const reviewText =
                    view && view.reviewActor
                      ? `${view.reviewActor}${view.reviewNote ? `：${view.reviewNote}` : ''}`
                      : '—'
                  return (
                    <tr key={item.key} className="border-b border-slate-100 align-top">
                      <td className="py-2 pr-3 text-me-charcoal font-medium whitespace-nowrap">
                        {item.key}
                      </td>
                      <td className="py-2 pr-3 text-slate-700">
                        <div>{item.title}</div>
                        <div className="text-xs text-slate-500">{item.goal}</div>
                      </td>
                      <td className="py-2 pr-3 text-slate-600">{item.passCriteria}</td>
                      <td className="py-2 pr-3">
                        <span
                          className={`inline-block rounded-full border px-2 py-0.5 text-xs ${statusChipClass(status)}`}
                        >
                          {STATUS_LABEL[status]}
                        </span>
                        {view?.manual && (
                          <span className="ml-1 inline-block rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
                            人工确认（无机器核对）
                          </span>
                        )}
                        {view?.manual && (
                          <div className="mt-1 max-w-xs whitespace-pre-wrap text-xs text-slate-600">
                            {view.manualDescription ?? '（没有说明）'}
                            {view.manualRecord ? `\n记录：${view.manualRecord}` : ''}
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-slate-600">{reviewText}</td>
                      <td className="py-2 pr-3 text-slate-600 whitespace-nowrap">
                        {shortSha(view?.commitSha)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* 阻塞原因 */}
          {!state.signable && state.blockers.length > 0 && (
            <div className="rounded-xl border border-me-charcoal/15 bg-white p-4 space-y-1">
              <p className="text-me-charcoal font-semibold">现在不能签字，因为：</p>
              <ul className="list-disc pl-5 text-sm text-slate-700 space-y-0.5">
                {state.blockers.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </div>
          )}

          {/* 已有签字 */}
          {state.signature && (
            <div className="rounded-xl border border-me-charcoal/15 bg-white p-4 space-y-2">
              <p className="text-sm text-slate-700">
                已签字：{state.signature.signedBy} · {state.signature.signedAt}（提交{' '}
                {shortSha(state.signature.commitSha)}）
              </p>
              {!state.signature.valid && (
                <p className="text-sm text-red-700">
                  该签字已失效：{state.signature.invalidReason ?? '原因未知'}
                </p>
              )}
              {canSign && (
                <button
                  type="button"
                  onClick={onRevoke}
                  disabled={busy}
                  className="rounded-lg border border-me-charcoal/20 bg-white px-3 py-1.5 text-sm text-me-charcoal hover:bg-slate-50 disabled:opacity-50"
                >
                  撤销签字
                </button>
              )}
            </div>
          )}

          {/* 签字按钮 */}
          <div className="rounded-xl border border-me-charcoal/15 bg-white p-4 space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={!state.signable || !canSign || busy}
                className="rounded-lg bg-me-charcoal px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                签字：机器验证通过
              </button>
              {(!state.signable || !canSign) && (
                <span className="text-sm text-slate-600">
                  {!canSign
                    ? '只有白名单里的签字人能点'
                    : state.blockers.join('；')}
                </span>
              )}
            </div>

            {confirming && (
              <div className="rounded-lg border border-slate-300 bg-slate-50 p-3 space-y-2">
                <p className="text-sm text-slate-700">
                  确认签字？记下：你的邮箱、现在的时间、线上提交号 {commit8}。其中 {state.items.filter((i) => i.manual).length} 项是人工确认（无机器核对），你已经读过上面的原文。这不是上线许可
                  。签字不会翻任何开关。
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={onConfirmSign}
                    disabled={busy}
                    className="rounded-lg bg-me-charcoal px-3 py-1.5 text-sm text-white disabled:opacity-50"
                  >
                    确认签字
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    disabled={busy}
                    className="rounded-lg border border-me-charcoal/20 bg-white px-3 py-1.5 text-sm text-me-charcoal disabled:opacity-50"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                {error}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
