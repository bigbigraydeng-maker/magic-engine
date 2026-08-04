'use client'

/**
 * 点开一个人：他是谁、怎么联系、往来记录、记一笔、改到哪一步。
 *
 * 看板的列很窄（一列只放得下名字和一句话），所以详情走抽屉 —— 宽屏从右侧
 * 滑出，手机上铺满整屏。prospecting 的看板也是这个交互。
 */

import { useState } from 'react'
import { ComposeNote, type StageOption } from './ComposeNote'
import { ContactTimeline } from './ContactTimeline'
import { MessengerReply } from './MessengerReply'
import { drawerActions, nextStageChoices, type Channel } from '@/lib/crm/drawer-actions'
import type { Segment } from '@/lib/crm/segments'

export interface DrawerRow {
  contactId: string
  name: string
  phone: string | null
  email: string | null
  stage: string | null
  stageLabel: string | null
  reason?: string
  dueAt?: string | null
  /** 他现在在哪一批 —— 决定给哪几个按钮。 */
  segment?: Segment
  /** 他实际能被联系到的渠道 —— 决定按钮的措辞（没电话的人不给「没打通」）。 */
  suggestedChannel?: Channel
}

export function PersonDrawer({
  clientId,
  row,
  stages,
  viewerEmail,
  onClose,
  onSaved,
}: {
  clientId: string
  row: DrawerRow
  stages: StageOption[]
  /** 从这里发出去的私信挂在谁名下 —— 发送框要当面说清楚。 */
  viewerEmail: string | null
  onClose: () => void
  onSaved: (msg: string, reload?: boolean) => void
}) {
  const [composing, setComposing] = useState(false)
  const [changingStage, setChangingStage] = useState(false)
  /** 阶段的「其他」展开没有 —— 默认只给下一步 + 一个出口。 */
  const [allStages, setAllStages] = useState(false)
  /** 一键动作正在写 —— 防双击记成两笔。 */
  const [quickBusy, setQuickBusy] = useState(false)
  /** 记完一笔换个 key，让时间线重新拉一次 —— 刚记的那条要立刻出现在上面。 */
  const [timelineKey, setTimelineKey] = useState(0)

  const changeStage = async (toStage: string, label: string) => {
    if (!window.confirm(`现在：${row.stageLabel ?? '还没标到哪一步'} → 改成「${label}」？`)) return
    setChangingStage(false)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/contacts/${row.contactId}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toStage }),
      })
      if (!res.ok) throw new Error()
      setTimelineKey((k) => k + 1)
      onSaved('✓ 改好了')
    } catch {
      onSaved('没改上，再试一次')
    }
  }


  /**
   * 一键动作 —— 「没打通」「发出去了，等他回」。
   *
   * 这是这一页最高频的结果，让它零成本：一次点击，不用打字、不用二次确认。
   * 那句话由 lib/crm/drawer-actions 给定（不在这里现编），因为它会被解析成
   * outcome，决定这个人明天落到哪一批。
   */
  const quickLog = async (note: string) => {
    if (quickBusy) return
    setQuickBusy(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/touchpoints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId: row.contactId,
          direction: 'outbound',
          note,
          // 每次点击一个新键 —— 同一个人今天可以打两次都没接。
          clientRef: globalThis.crypto.randomUUID(),
        }),
      })
      if (!res.ok) throw new Error()
      setTimelineKey((k) => k + 1)
      onSaved(`✓ 记下了：${note}`, false)
    } catch {
      onSaved('没记上，再点一下试试', false)
    } finally {
      setQuickBusy(false)
    }
  }

  // 这一刻该给哪几个按钮 / 哪几个阶段 —— 判断全在 lib 里，页面不自己拍。
  const actions = drawerActions(row.segment ?? 'stale_conversation', row.suggestedChannel ?? 'phone')
  const stageChoices = nextStageChoices(stages, row.stage)

  return (
    <>
      {/* 点旁边空白关掉 */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-40 bg-me-charcoal/25"
        aria-hidden
      />

      <aside className="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-me-ivory shadow-2xl sm:max-w-md">
        <header className="flex items-start justify-between gap-3 border-b border-me-charcoal/10 bg-white px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-black text-me-charcoal">{row.name}</h2>
            {row.reason && <p className="mt-0.5 text-xs text-me-charcoal/55">{row.reason}</p>}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg px-2 py-1 text-sm font-bold text-me-charcoal/40 hover:bg-me-charcoal/5"
          >
            关闭
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {/* 联系方式 —— 手机上点一下就拨 */}
          <div className="flex flex-wrap gap-2">
            {row.phone && (
              <a
                href={`tel:${row.phone}`}
                className="rounded-lg border border-me-stone bg-white px-3 py-2 text-sm font-semibold text-me-charcoal"
              >
                📞 {row.phone}
              </a>
            )}
            {row.email && (
              <a
                href={`mailto:${row.email}`}
                className="break-all rounded-lg border border-me-stone bg-white px-3 py-2 text-sm font-semibold text-me-charcoal"
              >
                ✉️ {row.email}
              </a>
            )}
            {!row.phone && !row.email && (
              <span className="text-xs text-me-charcoal/45">没留电话和邮箱，只能在私信里回他</span>
            )}
          </div>

          {/* 现在到哪一步了（点一下可改，改前二次确认） */}
          {stages.length > 0 && (
            <div className="mt-3">
              <button
                onClick={() => setChangingStage((v) => !v)}
                className="rounded-full border border-me-charcoal/15 bg-white px-3 py-1.5 text-xs font-bold text-me-charcoal/70"
              >
                现在：{row.stageLabel ?? '还没标到哪一步'}
              </button>
              {changingStage && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {/* 只给下一步 + 一个「谈崩了」的出口。
                      铺 9 个阶段的问题不是占地方，是每多一个选项就多一次犹豫 ——
                      而「新线索」直接跳「已付全款」的情况根本不存在。 */}
                  {(allStages
                    ? [...stageChoices.suggested, ...stageChoices.rest]
                    : stageChoices.suggested
                  ).map((s) => (
                    <button
                      key={s.stageKey}
                      onClick={() => void changeStage(s.stageKey, s.label)}
                      className="rounded-full bg-white px-3 py-1.5 text-[13px] font-bold text-me-charcoal shadow-sm"
                    >
                      {s.label}
                    </button>
                  ))}
                  {!allStages && stageChoices.rest.length > 0 && (
                    <button
                      onClick={() => setAllStages(true)}
                      className="rounded-full border border-dashed border-me-charcoal/25 px-3 py-1.5 text-[13px] font-bold text-me-charcoal/50"
                    >
                      其他 {stageChoices.rest.length} 个…
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 现在该做什么 —— 最多两个按钮，措辞按他能被联系到的渠道走。
              一个从没被联系过的人只有两种结果：打通了，或者没打通。
              其余控件在这一刻都是噪音，而噪音的代价是销售不用这一页。 */}
          <div className="mt-3">
            {!composing ? (
              <div className="flex gap-2">
                {actions.map((a) =>
                  a.kind === 'log' ? (
                    <button
                      key={a.kind}
                      onClick={() => setComposing(true)}
                      className="flex-1 rounded-lg bg-me-charcoal py-2.5 text-[15px] font-black text-white"
                    >
                      {a.label}
                    </button>
                  ) : (
                    <button
                      key={a.kind}
                      disabled={quickBusy}
                      onClick={() => void quickLog(a.cannedNote ?? '')}
                      className="shrink-0 rounded-lg border border-me-charcoal/25 bg-white px-4 py-2.5 text-[15px] font-bold text-me-charcoal/75 disabled:opacity-40"
                    >
                      {a.label}
                    </button>
                  ),
                )}
              </div>
            ) : (
              <ComposeNote
                clientId={clientId}
                row={{ contactId: row.contactId, stage: row.stage }}
                // 下拉里也只给下一步 —— 10 项的下拉是 PM 点名的噪音之一
                stages={stageChoices.suggested}
                onCancel={() => setComposing(false)}
                onDone={(msg) => {
                  setComposing(false)
                  setTimelineKey((k) => k + 1)
                  // 不重拉整块看板 —— 抽屉还开着，脚下的列表跳动会让人失去位置。
                  onSaved(msg, false)
                }}
              />
            )}
          </div>

          {/* 在这一页直接回私信 —— 没有私信线的人这里什么都不渲染。
              110 位 CTS 客人只有 Facebook 身份，卡上写着「只能在 Messenger
              回他」，之前却要跳去另一个页面才回得了。 */}
          <MessengerReply
            clientId={clientId}
            contactId={row.contactId}
            customerName={row.name}
            viewerEmail={viewerEmail}
            onSent={() => {
              setTimelineKey((k) => k + 1)
              onSaved('✓ 私信已发出', false)
            }}
          />

          {/* 往来记录：表单 / 电话 / 私信（以后是邮件、外呼），一条线倒序 */}
          <div className="mt-5">
            <p className="mb-2 text-[11px] font-black uppercase tracking-[0.14em] text-me-ochre">
              往来记录
            </p>
            <ContactTimeline key={timelineKey} clientId={clientId} contactId={row.contactId} />
          </div>
        </div>
      </aside>
    </>
  )
}
