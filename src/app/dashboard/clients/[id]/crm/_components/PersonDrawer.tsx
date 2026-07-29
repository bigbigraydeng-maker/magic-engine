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

export interface DrawerRow {
  contactId: string
  name: string
  phone: string | null
  email: string | null
  stage: string | null
  stageLabel: string | null
  reason?: string
  dueAt?: string | null
}

export function PersonDrawer({
  clientId,
  row,
  stages,
  onClose,
  onSaved,
}: {
  clientId: string
  row: DrawerRow
  stages: StageOption[]
  onClose: () => void
  onSaved: (msg: string, reload?: boolean) => void
}) {
  const [composing, setComposing] = useState(false)
  const [changingStage, setChangingStage] = useState(false)
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
                  {stages
                    .filter((s) => s.stageKey !== row.stage)
                    .map((s) => (
                      <button
                        key={s.stageKey}
                        onClick={() => void changeStage(s.stageKey, s.label)}
                        className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-me-charcoal shadow-sm"
                      >
                        {s.label}
                      </button>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* 记一笔 */}
          <div className="mt-3">
            {!composing ? (
              <button
                onClick={() => setComposing(true)}
                className="w-full rounded-lg bg-me-charcoal py-2.5 text-sm font-black text-white"
              >
                打完了，记一笔
              </button>
            ) : (
              <ComposeNote
                clientId={clientId}
                row={{ contactId: row.contactId, stage: row.stage }}
                stages={stages}
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
