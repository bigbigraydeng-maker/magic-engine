'use client'

/**
 * 「要记住的事」（⭐ 重要标记）编辑 —— 从 `all/_components/ContactDetail.tsx` 搬来
 * （2026-09-27 R1）。函数体一个字没改，**只把入参从整个 `ContactRow` 收窄**成它
 * 真正用到的那几个字段，理由写在下面 props 的注释里。
 *
 * 搬家理由同 `MarkWonPanel.tsx`：两页的「点开一个人」各缺一半，共享了才可能长同一张脸。
 * 今日待办有一条 `crm_important_due` 待办依赖这个功能，所以它不能只长在一页上。
 */

import { useState } from 'react'

/**
 * 「⭐置顶」附带的原因 + 到期日编辑。
 *
 * 星本身（pinned_at）在表格那一列直接点，这里只管"标了什么"和"到什么时候"——
 * 对应员工老表 R/S 列的红字。受控 state，按「保存」才落库，不是每敲一个字发一次。
 */
export function ImportantMarkerEditor({
  clientId,
  row,
  onSaved,
}: {
  clientId: string
  /**
   * 🔴 刻意只要这两个字段，不要整个 `ContactRow`。
   *
   * 原来写的是 `row: ContactRow`，而那个类型长在「全部客人」那一页的目录里 ——
   * 共享组件反向依赖某一页的类型，就没法给另一页用（抽屉那边的行是另一个形状）。
   * 收窄成结构类型之后两边都能喂，而且以后谁给自己的行加字段都不会波及这里。
   */
  row: { contactId: string; important?: { note: string | null; dueAt: string | null } | null }
  onSaved: (msg: string) => void
}) {
  const [note, setNote] = useState(row.important?.note ?? '')
  const [dueDate, setDueDate] = useState(row.important?.dueAt ? row.important.dueAt.slice(0, 10) : '')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      const body: { note: string | null; dueAt: string | null } = {
        note: note.trim() === '' ? null : note.trim(),
        // 空 = 清空；非空 date → 当天 12:00 本地时区当作截止时刻（员工只想标一天，不写具体时间）
        dueAt: dueDate === '' ? null : new Date(`${dueDate}T12:00:00`).toISOString(),
      }
      const res = await fetch(`/api/clients/${clientId}/crm/contacts/${row.contactId}/important`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error()
      onSaved('✓ 存好了')
    } catch {
      onSaved('没存上，再试一次')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-me-charcoal/10 bg-me-ivory p-3">
      <div className="text-xs font-bold text-me-charcoal/60">
        ⭐ 重要标记（选填）—— 员工老表 R/S 列的红字放这里
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="约好周三 3 点回电 / 只发邮件不打电话 / ..."
        maxLength={500}
        rows={2}
        className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm focus:border-me-charcoal focus:outline-none"
      />
      <div className="flex items-center gap-2 text-sm">
        <span className="text-xs text-me-charcoal/50">到期：</span>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="rounded-lg border border-black/10 bg-white px-2 py-1 text-sm"
        />
        {dueDate && (
          <button
            type="button"
            onClick={() => setDueDate('')}
            className="text-xs text-me-charcoal/40 hover:text-me-charcoal"
          >
            清除日期
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="ml-auto rounded-lg bg-me-charcoal px-3 py-1 text-xs font-black text-white disabled:opacity-40"
        >
          {busy ? '存中…' : '保存'}
        </button>
      </div>
    </div>
  )
}
