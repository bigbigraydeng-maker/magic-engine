'use client'

/**
 * AdStrategyPanel — FDE control for the Ad Strategy Engine (P21.K.5).
 *
 * The engine scores every campaign against its own history, so it needs no
 * per-client tuning. This panel is the control surface: turn the daily
 * ad-health monitoring on/off, and choose who gets the digest.
 *
 * 板桥 review: the on/off control must never be misread as "click to enable"
 * (a misclick here silences a client's alerts with no one noticing), so status
 * and action are visually separate — a labelled state row plus a real switch —
 * turning OFF asks for confirmation, and every toggle shows a confirmation
 * banner OUTSIDE the recipients block so it stays visible when disabled.
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Tolerant split — FDEs paste comma/semicolon/newline-separated lists. */
function parseRecipients(raw: string): string[] {
  return raw.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean)
}

export function AdStrategyPanel({ clientId }: Props) {
  const [state, setState] = useState<PanelState>({ phase: 'loading' })
  const [recipientsDraft, setRecipientsDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

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

  const save = async (patch: Partial<Config>, okText: string) => {
    setSaving(true)
    setBanner(null)
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
      setBanner({ kind: 'ok', text: okText })
    } catch {
      // Humanised — never surface the raw backend string, and reassure that
      // nothing was lost so the FDE knows the old setting still stands.
      setBanner({ kind: 'err', text: '保存没成功,原来的设置还在。请稍后重试。' })
    } finally {
      setSaving(false)
    }
  }

  const toggle = (next: boolean) => {
    if (!next) {
      const ok = window.confirm('暂停后,这个客户的广告不再每天自动体检、不再预警。确定要暂停吗?')
      if (!ok) return
    }
    save({ enabled: next }, next ? '已开启,从明天起每天体检。' : '已暂停,这个客户不再体检、不再预警。')
  }

  const saveRecipients = () => {
    const emails = parseRecipients(recipientsDraft)
    const bad = emails.find(e => !EMAIL_RE.test(e))
    if (bad) {
      setBanner({ kind: 'err', text: `「${bad}」不像邮箱。一行只写一个邮箱,多个就换行。` })
      return
    }
    save({ digest_recipients: emails }, emails.length > 0 ? `已保存 ${emails.length} 个收件人。` : '已清空收件人,改发到 ME 团队默认邮箱。')
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
  const savedCount = config.digest_recipients.length

  return (
    <div className="rounded-xl border border-gray-200 p-5">
      <div>
        <h3 className="font-medium text-gray-800">广告健康监测</h3>
        <p className="mt-1 text-sm text-gray-500">
          每天自动体检该客户的广告,把每条广告跟它自己最好的一周比,发现疲劳<span className="text-gray-700">自动发邮件预警</span>给下面填的人。
        </p>
      </div>

      {/* Status row (state) + switch (action) — deliberately separate. */}
      <div className="mt-4 flex items-center justify-between gap-4 rounded-lg bg-gray-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2.5 h-2.5 rounded-full ${config.enabled ? 'bg-emerald-500' : 'bg-gray-400'}`} />
          <span className="text-sm font-medium text-gray-700">
            {config.enabled ? '监测中 · 每天体检' : '已暂停 · 不体检'}
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={config.enabled}
          aria-label="开关广告健康监测"
          disabled={saving}
          onClick={() => toggle(!config.enabled)}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50 ${
            config.enabled ? 'bg-emerald-500' : 'bg-gray-300'
          }`}
        >
          <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${config.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </div>

      {/* Confirmation banner — outside the recipients block so it stays visible
          even after the client is disabled. */}
      {saving && <p className="mt-2 text-xs text-gray-400">保存中…</p>}
      {!saving && banner && (
        <p className={`mt-2 text-xs ${banner.kind === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>{banner.text}</p>
      )}

      {config.enabled ? (
        <div className="mt-4 border-t border-gray-100 pt-4">
          <label className="block text-sm font-medium text-gray-700">日报收件人</label>
          <p className="mt-0.5 text-xs text-gray-400">
            一行一个邮箱,多个就换行。留空则发到 ME 团队默认邮箱。有事才发、全绿只每周一封。
          </p>
          <textarea
            value={recipientsDraft}
            onChange={e => setRecipientsDraft(e.target.value)}
            rows={3}
            placeholder={'zhang@example.com\nli@example.com'}
            className="mt-2 w-full rounded-lg border border-gray-200 p-2 text-sm font-mono focus:border-gray-400 focus:outline-none"
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              disabled={saving}
              onClick={saveRecipients}
              className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-white hover:bg-gray-700 disabled:opacity-50"
            >
              保存收件人
            </button>
          </div>
          <a href={`/dashboard/clients/${clientId}/ads-health`} className="mt-3 inline-block text-xs text-amber-600 hover:underline">
            体检结果每天更新,去「广告健康」页查看 →
          </a>
        </div>
      ) : (
        <p className="mt-3 text-xs text-gray-400">
          已暂停。{savedCount > 0 ? `收件人已保存(${savedCount} 人),重新开启即恢复。` : '重新开启即恢复每天体检。'}
        </p>
      )}
    </div>
  )
}
