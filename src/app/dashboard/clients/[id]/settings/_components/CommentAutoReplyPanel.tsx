'use client'

/**
 * CommentAutoReplyPanel — FDE-managed Facebook comment auto-reply settings.
 *
 * Single write entry for social_comment_config. Backs the full-auto comment
 * reply engine (cron: social-comment-autoreply). Mirrors SocialHandlesPanel's
 * loading/error/ready three-state + draft/save pattern.
 *
 * Enabling requires an fb_page_id (the API refuses otherwise) — without it the
 * cron would silently no-op.
 */

import { useState, useEffect, useCallback } from 'react'

interface Props {
  clientId: string
}

interface Config {
  enabled: boolean
  fb_page_id: string
  auto_reply_praise: boolean
  auto_reply_question: boolean
  auto_reply_complaint: boolean
  auto_hide_spam: boolean
  private_reply_enabled: boolean
  lookback_days: number
  max_replies_per_run: number
}

type PanelState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; config: Config }

interface ProbeResult {
  token_resolved: boolean
  page_token_resolved: boolean
  permissions: Record<string, boolean>
  live_read_ok: boolean
  sample_comment_count: number | null
  ready: boolean
  notes: string[]
}

const SCOPE_LABEL: Record<string, string> = {
  pages_read_engagement: '读取评论',
  pages_manage_engagement: '回帖 / 隐藏',
  pages_messaging: '私信引导',
}

const DEFAULT_DRAFT: Config = {
  enabled: false,
  fb_page_id: '',
  auto_reply_praise: true,
  auto_reply_question: true,
  auto_reply_complaint: true,
  auto_hide_spam: false,
  private_reply_enabled: true,
  lookback_days: 7,
  max_replies_per_run: 20,
}

function Toggle({ label, hint, checked, onChange, disabled }: {
  label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 py-2">
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-700">{label}</span>
        {hint && <span className="block text-xs text-slate-400">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={[
          'relative mt-0.5 h-6 w-11 flex-shrink-0 rounded-full transition',
          checked ? 'bg-cyan-600' : 'bg-slate-300',
          disabled ? 'cursor-not-allowed opacity-50' : '',
        ].join(' ')}
      >
        <span className={[
          'absolute top-0.5 h-5 w-5 rounded-full bg-white transition',
          checked ? 'left-[22px]' : 'left-0.5',
        ].join(' ')} />
      </button>
    </label>
  )
}

export function CommentAutoReplyPanel({ clientId }: Props) {
  const [state, setState] = useState<PanelState>({ phase: 'loading' })
  const [draft, setDraft] = useState<Config>(DEFAULT_DRAFT)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [probing, setProbing] = useState(false)
  const [probe, setProbe] = useState<ProbeResult | null>(null)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res = await fetch(`/api/clients/${clientId}/comment-autoreply-config`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { config } = (await res.json()) as { config: Config }
      setState({ phase: 'ready', config })
      setDraft({ ...DEFAULT_DRAFT, ...config })
    } catch (err) {
      setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [clientId])

  useEffect(() => { void load() }, [load])

  const handleSave = async () => {
    setSaving(true)
    setErrMsg(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/comment-autoreply-config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        throw new Error(error)
      }
      const { config } = (await res.json()) as { config: Config }
      setState({ phase: 'ready', config })
      setDraft({ ...DEFAULT_DRAFT, ...config })
      setSavedAt(new Date().toLocaleTimeString('zh-CN'))
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (state.phase === 'loading') {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-cyan-600" />
        正在加载评论自动回复配置…
      </div>
    )
  }

  if (state.phase === 'error') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <p className="font-bold">加载失败</p>
        <p>{state.message}</p>
        <button onClick={load} className="mt-2 font-medium underline">重试</button>
      </div>
    )
  }

  const isDirty = JSON.stringify(draft) !== JSON.stringify({ ...DEFAULT_DRAFT, ...state.config })
  const set = <K extends keyof Config>(k: K, v: Config[K]) => setDraft(d => ({ ...d, [k]: v }))

  const runProbe = async () => {
    setProbing(true)
    setProbe(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/comment-autoreply-probe`)
      setProbe((await res.json()) as ProbeResult)
    } catch (err) {
      setProbe({
        token_resolved: false, page_token_resolved: false, permissions: {}, live_read_ok: false,
        sample_comment_count: null, ready: false,
        notes: [err instanceof Error ? err.message : '验证请求失败'],
      })
    } finally {
      setProbing(false)
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      {/* Master switch */}
      <div className="mb-4 flex items-start justify-between gap-4 rounded-lg bg-slate-50 p-3">
        <span className="min-w-0">
          <span className="block text-sm font-black text-slate-800">全自动评论回复</span>
          <span className="block text-xs text-slate-500">
            开启后每 30 分钟自动拉取该客户 FB 主页评论并回复。AI 只对「夸赞」自由发挥，问题一律走安全话术不作答。
          </span>
        </span>
        <button
          type="button" role="switch" aria-checked={draft.enabled}
          onClick={() => set('enabled', !draft.enabled)} disabled={saving}
          className={['relative mt-0.5 h-6 w-11 flex-shrink-0 rounded-full transition',
            draft.enabled ? 'bg-emerald-600' : 'bg-slate-300', saving ? 'opacity-50' : ''].join(' ')}
        >
          <span className={['absolute top-0.5 h-5 w-5 rounded-full bg-white transition',
            draft.enabled ? 'left-[22px]' : 'left-0.5'].join(' ')} />
        </button>
      </div>

      {/* FB Page ID */}
      <div className="mb-2">
        <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">
          Facebook 主页 ID（Page ID）
        </label>
        <input
          type="text"
          value={draft.fb_page_id}
          onChange={e => set('fb_page_id', e.target.value)}
          placeholder="例：123456789012345（数字 Page ID，不是主页 URL）"
          className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
          disabled={saving}
        />
        <p className="mt-1 text-xs text-slate-400">开启自动回复必须填。Page token 由后台按客户解析（无需在此填 token）。</p>
        <div className="mt-2">
          <button
            type="button" onClick={runProbe} disabled={probing}
            className="rounded-lg border border-cyan-300 bg-cyan-50 px-3 py-1.5 text-xs font-bold text-cyan-800 transition hover:bg-cyan-100 disabled:opacity-50"
          >
            {probing ? '验证中…' : '检查 Meta 权限'}
          </button>
        </div>
      </div>

      {/* Probe result */}
      {probe && (
        <div className={[
          'mb-2 rounded-lg border p-3 text-xs',
          probe.ready ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50',
        ].join(' ')}>
          <div className="mb-1.5 flex items-center gap-2 font-bold">
            <span>{probe.ready ? '✅ 就绪' : '⚠ 尚未就绪'}</span>
            <span className="font-normal text-slate-500">
              token {probe.token_resolved ? '✓' : '✗'} · Page token {probe.page_token_resolved ? '✓' : '✗'}
              {probe.live_read_ok && ` · 读到 ${probe.sample_comment_count ?? 0} 条评论`}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(SCOPE_LABEL).map(([scope, label]) => {
              const granted = probe.permissions[scope]
              return (
                <span key={scope} className={[
                  'rounded-full px-2 py-0.5 font-semibold',
                  granted === true ? 'bg-emerald-100 text-emerald-700'
                    : granted === false ? 'bg-red-100 text-red-700'
                    : 'bg-slate-100 text-slate-500',
                ].join(' ')}>
                  {label}：{granted === true ? '有' : granted === false ? '缺' : '未知'}
                </span>
              )
            })}
          </div>
          {probe.notes.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-slate-600">
              {probe.notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* Category toggles */}
      <div className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
        <Toggle label="回复夸赞评论" hint="AI 起草暖回复（过 claim 过滤器后才发）" checked={draft.auto_reply_praise} onChange={v => set('auto_reply_praise', v)} disabled={saving} />
        <Toggle label="回应提问评论" hint="固定安全话术「已私信你」+ 转人工，绝不 AI 作答" checked={draft.auto_reply_question} onChange={v => set('auto_reply_question', v)} disabled={saving} />
        <Toggle label="回应负面评论" hint="共情话术 + 私信转真人处理" checked={draft.auto_reply_complaint} onChange={v => set('auto_reply_complaint', v)} disabled={saving} />
        <Toggle label="自动隐藏垃圾评论" hint="默认关（保守）" checked={draft.auto_hide_spam} onChange={v => set('auto_hide_spam', v)} disabled={saving} />
        <Toggle label="允许私信引导" hint="对有购买意向的评论发私信引导（Meta 7 天窗内）" checked={draft.private_reply_enabled} onChange={v => set('private_reply_enabled', v)} disabled={saving} />
      </div>

      {/* Numeric limits */}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">回溯天数</label>
          <input type="number" min={1} max={30} value={draft.lookback_days}
            onChange={e => set('lookback_days', Number(e.target.value))} disabled={saving}
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500" />
          <p className="mt-1 text-xs text-slate-400">1–30 天。私信有 7 天窗，建议 ≤7</p>
        </div>
        <div>
          <label className="block text-xs font-bold uppercase tracking-wide text-slate-500">每次最多回复</label>
          <input type="number" min={1} max={100} value={draft.max_replies_per_run}
            onChange={e => set('max_replies_per_run', Number(e.target.value))} disabled={saving}
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500" />
          <p className="mt-1 text-xs text-slate-400">1–100 条 / 次运行</p>
        </div>
      </div>

      {/* Save row */}
      <div className="mt-5 flex items-center justify-between gap-3">
        <div className="text-xs text-slate-500">
          {savedAt && !isDirty && <span className="text-emerald-700">✓ 已保存 · {savedAt}</span>}
          {errMsg && <span className="text-red-700">⚠ {errMsg}</span>}
        </div>
        <button onClick={handleSave} disabled={!isDirty || saving}
          className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-bold text-white transition hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-50">
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  )
}
