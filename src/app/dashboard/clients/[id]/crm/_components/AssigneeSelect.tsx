'use client'

/**
 * 「跟进人」下拉 —— 抽屉顶部一行，直接改 `contacts.assigned_to`。
 *
 * - 候选从 `/api/clients/[id]/crm/assignees` 拉（`client_portal_users` 中打了
 *   `receives_round_robin_leads=true` 的那几个人），组件自己载入 + 缓存。
 * - 当前登录用户的邮箱在候选里会标「（我）」—— 让员工一眼看出这条是不是自己的。
 * - 选完立即保存（跟 ProfileCard / PinCell 一样零确认按钮，PM 原则「按钮少」）。
 * - 保存失败回滚显示值并说一句，跟 `togglePin` 的乐观更新同款。
 *
 * 不自动显示员工的名字 —— 候选名单里只存邮箱（part 2 决定不加 name 列）。
 * 以后能从 `client_portal_users` 读 display_name 时再接上，不动这个组件外形。
 */

import { useEffect, useState } from 'react'

export interface Assignee {
  email: string
}

export function AssigneeSelect({
  clientId,
  contactId,
  current,
  viewerEmail,
  onSaved,
}: {
  clientId: string
  contactId: string
  current: string | null
  /** 当前登录用户的邮箱 —— 在候选里标「（我）」。null 时不标。 */
  viewerEmail: string | null
  onSaved: (msg: string, reload?: boolean) => void
}) {
  const [value, setValue] = useState<string | null>(current)
  const [options, setOptions] = useState<Assignee[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState(false)

  // 当前这个人换了（抽屉里点上一位/下一位），把本地显示值跟上。
  useEffect(() => {
    setValue(current)
  }, [current, contactId])

  // 候选名单在抽屉打开时拉一次 —— 不缓存在模块级，不同客户下不互相串。
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/crm/assignees`)
        if (!res.ok) {
          if (!cancelled) setLoadError(true)
          return
        }
        const json = (await res.json()) as { assignees?: Assignee[] }
        if (!cancelled) setOptions(json.assignees ?? [])
      } catch {
        if (!cancelled) setLoadError(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [clientId])

  const save = async (next: string | null) => {
    const prev = value
    setValue(next)
    setBusy(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/contacts/${contactId}/assignee`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignee: next }),
      })
      if (!res.ok) throw new Error()
      // reload:true —— 列表要把跟进人字段跟着更新 + 「我负责」/「未分配」筛选下重算。
      onSaved(next ? `✓ 跟进人改成 ${next}` : '✓ 已清空跟进人', true)
    } catch {
      setValue(prev)
      onSaved('没改上，再试一次', false)
    } finally {
      setBusy(false)
    }
  }

  const labelFor = (email: string) =>
    viewerEmail && email.toLowerCase() === viewerEmail.toLowerCase() ? `${email}（我）` : email

  // 候选名单里 current 可能不在（员工被从名单里移出 / 以前别的客户用过的邮箱），
  // 显示值保留原文、让人能看出来，但再切其它选项的话这条会从下拉里消失（服务端拒收）。
  const extraCurrent =
    value !== null && options !== null && !options.some((o) => o.email.toLowerCase() === value.toLowerCase())
      ? value
      : null

  return (
    <div
      className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-me-charcoal/10 bg-white px-3 py-2"
      data-testid="assignee-select"
    >
      <span className="text-[12px] font-black text-me-charcoal/60">跟进人</span>
      {loadError ? (
        <span className="text-[12px] text-me-charcoal/45">名单取不到，稍后再试</span>
      ) : options === null ? (
        <span className="text-[12px] text-me-charcoal/35">正在拿名单…</span>
      ) : options.length === 0 ? (
        <span className="text-[12px] text-me-charcoal/45">
          这个客户还没配跟进人（client_portal_users 里打开「round-robin」就能用）
        </span>
      ) : (
        <select
          value={value ?? ''}
          disabled={busy}
          onChange={(e) => {
            const next = e.target.value === '' ? null : e.target.value
            if (next === value) return
            void save(next)
          }}
          className="rounded-lg border border-me-charcoal/15 bg-white px-2 py-1 text-[13px] font-semibold text-me-charcoal focus:border-me-charcoal focus:outline-none disabled:opacity-40"
          aria-label="选择跟进人"
        >
          <option value="">— 未分配 —</option>
          {options.map((o) => (
            <option key={o.email} value={o.email}>
              {labelFor(o.email)}
            </option>
          ))}
          {extraCurrent !== null && (
            <option value={extraCurrent} disabled>
              {extraCurrent}（已不在名单里）
            </option>
          )}
        </select>
      )}
      {busy && <span className="text-[11px] text-me-charcoal/40">保存中…</span>}
    </div>
  )
}
