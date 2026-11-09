'use client'

/**
 * Meta 广告线索送进哪个 Mailchimp 名单。
 *
 * ## 为什么 2026-09-06 才有这个界面
 *
 * 在此之前这个值只能改数据库。而「Mailchimp 出口坏了」那条今日待办给 FDE 的
 * 指示正是「打开设置页确认 audience 配置」—— 点进来什么都改不了，只能回头找
 * 开发。那是条断头的管道：话说了，但收到的人做不了。
 *
 * 清空 = 关掉这个客户的出口（零 provider 调用），这是明确语义，不是「没配好」。
 */

import { useCallback, useEffect, useState } from 'react'

export function MailchimpAudiencePanel({ clientId }: { clientId: string }) {
  const [value, setValue] = useState<string | null>(null)
  const [saved, setSaved] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/leads-config`)
      const json = (await res.json()) as { config?: { mailchimpAudienceId?: string }; error?: string }
      if (!res.ok) throw new Error(json.error ?? '加载失败')
      const cur = json.config?.mailchimpAudienceId ?? ''
      setValue(cur)
      setSaved(cur)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败')
    }
  }, [clientId])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    setSaving(true)
    setErr(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/leads-config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mailchimpAudienceId: value ?? '' }),
      })
      const json = (await res.json()) as { config?: { mailchimpAudienceId?: string }; error?: string }
      if (!res.ok) throw new Error(json.error ?? '保存失败')
      // 以服务端回的值为准 —— 它才知道最后存进去的是什么（trim 过的）。
      const stored = json.config?.mailchimpAudienceId ?? ''
      setValue(stored)
      setSaved(stored)
      setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (value === null) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        {err ? (
          // 读不到就**不给输入框**。空框会被读成「这个客户没配」，人一填一存
          // 就把一个我们根本没看见的旧值改掉了 ——「拿不到 ≠ 没有」，这条链路
          // 刚为这件事栽过一个月。
          <>
            <p className="text-sm text-red-600">⚠ 读不出现在配的是什么：{err}</p>
            <p className="mt-1 text-xs text-slate-500">
              先别填 —— 现在填等于蒙着眼睛改。点重试；一直读不出来就回我一句。
            </p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-3 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700"
            >
              重试
            </button>
          </>
        ) : (
          <p className="text-sm text-slate-400">加载中...</p>
        )}
      </div>
    )
  }

  const dirty = (value ?? '') !== saved

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm font-bold text-slate-800">Meta 广告线索送进哪个 Mailchimp 名单</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        填 Mailchimp 里那个名单的 <strong>Audience ID</strong>（在 Mailchimp 的
        Audience → Settings → Audience name and defaults 最下面，长得像
        <code className="mx-1 rounded bg-slate-100 px-1">dda97b7e61</code>）。
        <strong>留空 = 这个客户的线索不往 Mailchimp 送</strong>，不是没配好。
      </p>

      <div className="mt-3 flex gap-2">
        <input
          type="text"
          value={value ?? ''}
          disabled={saving}
          onChange={(e) => setValue(e.target.value)}
          placeholder="留空则不送"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-800 focus:border-cyan-500 focus:outline-none disabled:bg-slate-50"
        />
        <button
          type="button"
          disabled={saving || !dirty}
          onClick={() => void save()}
          className="shrink-0 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-bold text-white disabled:bg-slate-200 disabled:text-slate-400"
        >
          {saving ? '保存中' : '保存'}
        </button>
      </div>

      {err && <p className="mt-2 text-xs text-red-600">⚠ {err}</p>}
      {!err && savedAt && !dirty && (
        <p className="mt-2 text-xs text-emerald-600">✓ 已保存（{savedAt}）</p>
      )}
    </div>
  )
}
