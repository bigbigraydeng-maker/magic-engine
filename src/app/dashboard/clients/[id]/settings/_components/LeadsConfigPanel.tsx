'use client'

/**
 * 邮件反应同步开关。
 *
 * 开了之后，系统每天自动把「谁收到了、谁打开了、谁点了链接」搬进这个客户的
 * 客人档案 —— 点过链接的人会排到销售名单最前面。
 *
 * 默认关：一个邮件账户可能同时服务好几个客户，全开会把别人的邮件反应
 * 记到这个客户的客人身上。
 */

import { useCallback, useEffect, useState } from 'react'

export function LeadsConfigPanel({ clientId }: { clientId: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/leads-config`)
      const json = (await res.json()) as { config?: { mailchimpEnabled: boolean }; error?: string }
      if (!res.ok) throw new Error(json.error ?? '加载失败')
      setEnabled(json.config?.mailchimpEnabled ?? false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败')
    }
  }, [clientId])

  useEffect(() => { void load() }, [load])

  const toggle = async (next: boolean) => {
    setSaving(true)
    setErr(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/leads-config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mailchimpEnabled: next }),
      })
      const json = (await res.json()) as { config?: { mailchimpEnabled: boolean }; error?: string }
      if (!res.ok) throw new Error(json.error ?? '保存失败')
      setEnabled(json.config?.mailchimpEnabled ?? next)
      setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (enabled === null && !err) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-400">加载中...</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={enabled === true}
          disabled={saving}
          onChange={(e) => void toggle(e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 accent-cyan-600"
        />
        <span>
          <span className="block text-sm font-bold text-slate-800">
            把邮件反应同步进这个客户的客人档案
          </span>
          <span className="mt-1 block text-xs leading-relaxed text-slate-500">
            开了之后，系统每天自动记下<strong>谁收到了、谁打开了、谁点了链接</strong>，
            写进每个客人的往来记录。点过链接的人是最热的一批，会排到销售名单最前面。
          </span>
        </span>
      </label>

      {err && <p className="mt-2 text-xs text-red-600">⚠ {err}</p>}
      {!err && savedAt && (
        <p className="mt-2 text-xs text-emerald-600">✓ 已保存（{savedAt}）</p>
      )}

      <p className="mt-4 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-400">
        默认关闭。同一个邮件账户可能同时服务好几个客户 —— 全开会把别人的邮件反应
        记到这个客户的客人身上，所以要一个一个确认。
      </p>
    </div>
  )
}
