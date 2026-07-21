'use client'

/**
 * AdStrategyPanel — FDE control for the Ad Strategy Engine (P21.K.5).
 *
 * The engine scores every campaign against its own history, so it needs no
 * per-client tuning to work. This panel is the control surface: turn the daily
 * ad-health monitoring on/off for a client, and choose who gets the digest.
 * Writes go through /api/clients/[id]/ad-strategy-config — never raw SQL.
 */

import { useState, useEffect, useCallback } from 'react'

interface Props {
  clientId: string
}

interface Config {
  enabled: boolean
  digest_recipients: string[]
}

type PanelState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; config: Config }

export function AdStrategyPanel({ clientId }: Props) {
  const [state, setState] = useState<PanelState>({ phase: 'loading' })
  const [recipientsDraft, setRecipientsDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res = await fetch(`/api/clients/${clientId}/ad-strategy-config`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { config } = (await res.json()) as { config: Config }
      setState({ phase: 'ready', config })
      setRecipientsDraft(config.digest_recipients.join('\n'))
    } catch (err) {
      setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  const save = async (patch: Partial<Config>) => {
    setSaving(true)
    setErrMsg(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/ad-strategy-config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setState({ phase: 'ready', config: json.config })
      setRecipientsDraft(json.config.digest_recipients.join('\n'))
      setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (state.phase === 'loading') {
    return <div className="rounded-xl border border-gray-200 p-5 text-sm text-gray-400">加载中…</div>
  }
  if (state.phase === 'error') {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
        加载失败:{state.message}
      </div>
    )
  }

  const { config } = state

  return (
    <div className="rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-medium text-gray-800">广告健康监测</h3>
          <p className="mt-1 text-sm text-gray-500">
            每天自动体检该客户的广告,把每条广告跟它自己最好的一周比,发现疲劳提前预警。
          </p>
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={() => save({ enabled: !config.enabled })}
          className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition ${
            config.enabled
              ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
              : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
          } disabled:opacity-50`}
        >
          {config.enabled ? '已开启' : '已关闭'}
        </button>
      </div>

      {config.enabled && (
        <div className="mt-4 border-t border-gray-100 pt-4">
          <label className="block text-sm font-medium text-gray-700">日报收件人</label>
          <p className="mt-0.5 text-xs text-gray-400">
            每行一个邮箱。留空则发到 ME 团队默认邮箱。有事才发、全绿只每周一封。
          </p>
          <textarea
            value={recipientsDraft}
            onChange={e => setRecipientsDraft(e.target.value)}
            rows={3}
            placeholder="name@example.com"
            className="mt-2 w-full rounded-lg border border-gray-200 p-2 text-sm font-mono focus:border-gray-400 focus:outline-none"
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              disabled={saving}
              onClick={() => save({ digest_recipients: recipientsDraft.split('\n').map(s => s.trim()).filter(Boolean) })}
              className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-white hover:bg-gray-700 disabled:opacity-50"
            >
              {saving ? '保存中…' : '保存收件人'}
            </button>
            {savedAt && <span className="text-xs text-emerald-600">已保存 {savedAt}</span>}
            {errMsg && <span className="text-xs text-red-600">{errMsg}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
