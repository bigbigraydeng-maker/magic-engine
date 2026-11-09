'use client'

/**
 * 邮件反应同步开关 + Mailchimp audience id。
 *
 * 开了之后，系统每天自动把「谁收到了、谁打开了、谁点了链接」搬进这个客户的
 * 客人档案 —— 点过链接的人会排到销售名单最前面。
 *
 * 默认关：一个邮件账户可能同时服务好几个客户，全开会把别人的邮件反应
 * 记到这个客户的客人身上。
 *
 * audience id 输入框 2026-09-03 补上：`mailchimp-paid-tagging` 那条 cron
 * （每天把「钱到账了」的客人自动打 `paid_customer` 标签）靠它才知道去
 * Mailchimp 哪个名单里找人，之前这个字段只能改数据库，新客户接进来只能
 * 静默跳过打标签。
 */

import { useCallback, useEffect, useState } from 'react'

interface Config {
  mailchimpEnabled: boolean
  mailchimpAudienceId: string
}

export function LeadsConfigPanel({ clientId }: { clientId: string }) {
  const [config, setConfig] = useState<Config | null>(null)
  const [audienceIdDraft, setAudienceIdDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/leads-config`)
      const json = (await res.json()) as { config?: Config; error?: string }
      if (!res.ok) throw new Error(json.error ?? '加载失败')
      const next = { mailchimpEnabled: json.config?.mailchimpEnabled ?? false, mailchimpAudienceId: json.config?.mailchimpAudienceId ?? '' }
      setConfig(next)
      setAudienceIdDraft(next.mailchimpAudienceId)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败')
    }
  }, [clientId])

  useEffect(() => { void load() }, [load])

  const save = async (patch: { mailchimpEnabled?: boolean; mailchimpAudienceId?: string }) => {
    setSaving(true)
    setErr(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/leads-config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const json = (await res.json()) as { config?: Config; error?: string }
      if (!res.ok) throw new Error(json.error ?? '保存失败')
      if (json.config) {
        setConfig(json.config)
        setAudienceIdDraft(json.config.mailchimpAudienceId)
      }
      setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (config === null && !err) {
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
          checked={config?.mailchimpEnabled === true}
          disabled={saving}
          onChange={(e) => void save({ mailchimpEnabled: e.target.checked })}
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

      <div className="mt-4 border-t border-slate-100 pt-3">
        <label className="block text-sm font-bold text-slate-800" htmlFor={`mailchimp-audience-${clientId}`}>
          Mailchimp audience id
        </label>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          在 Mailchimp 后台 Audience → Settings → Audience name and defaults 里能找到。
          没填的话，付款自动打标签那条每日任务会跳过这个客户。
        </p>
        <div className="mt-2 flex items-center gap-2">
          <input
            id={`mailchimp-audience-${clientId}`}
            type="text"
            value={audienceIdDraft}
            disabled={saving}
            onChange={(e) => setAudienceIdDraft(e.target.value)}
            placeholder="例如 a1b2c3d4e5"
            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-800 focus:border-cyan-500 focus:outline-none"
          />
          <button
            type="button"
            disabled={saving || audienceIdDraft.trim() === (config?.mailchimpAudienceId ?? '')}
            onClick={() => void save({ mailchimpAudienceId: audienceIdDraft.trim() })}
            className="shrink-0 rounded-lg bg-cyan-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            保存
          </button>
        </div>
      </div>

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
