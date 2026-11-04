'use client'

/**
 * Settings form for publishing quota. Saves through /api/clients/[id]/publishing-quota,
 * which keeps sibling keys such as weekly_pack. The weekly switch stays an env flag:
 * stored weekly numbers do nothing until that flag is exactly "true".
 */
import { useCallback, useEffect, useState } from 'react'

import { QUOTA_COUNT_MAX, QUOTA_KEYS, type QuotaKey, type StoredQuota } from '@/lib/social/publishing-quota/save'

const LABELS: Record<QuotaKey, string> = {
  post_per_day: '图文，每天',
  story_per_day: 'Story，每天',
  post_per_week: '图文，每周',
  story_per_week: 'Story，每周',
  reel_per_week: 'Reel，每周',
}

type Form = Record<QuotaKey, string>

function blankForm(): Form {
  return { post_per_day: '', story_per_day: '', post_per_week: '', story_per_week: '', reel_per_week: '' }
}

function toForm(quota: StoredQuota): Form {
  const form = blankForm()
  for (const key of QUOTA_KEYS) form[key] = quota[key] === null ? '' : String(quota[key])
  return form
}

interface LoadedQuota {
  ok: true
  quota: StoredQuota
  hasOther: boolean
  columnReady: boolean
}

function QuotaFields({
  form, setForm, columnReady, hasOther, saving, message, onSave,
}: {
  form: Form
  setForm: (next: Form | ((prev: Form) => Form)) => void
  columnReady: boolean
  hasOther: boolean
  saving: boolean
  message: string | null
  onSave: () => void
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">
        留空表示这项没配置，不是 0。0 是真的不许发。按周的图文和 Story 先存在这里；全站开关默认关着，没打开时页面仍按每天的数字。
        {hasOther ? ' 旁边已有的排期设置会留下来。' : ''}
      </p>
      {!columnReady && <p className="mt-2 text-xs font-medium text-amber-800">名额这一列还没建好，现在不能保存。</p>}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {QUOTA_KEYS.map((key) => (
          <label key={key} className="block text-xs font-bold text-slate-500">
            {LABELS[key]}
            <input
              inputMode="numeric"
              value={form[key]}
              disabled={saving || !columnReady}
              onChange={(event) => setForm((prev) => ({ ...prev, [key]: event.target.value }))}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
          </label>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button type="button" disabled={saving || !columnReady} onClick={onSave} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
          {saving ? '保存中...' : '保存名额'}
        </button>
        {message && <p className="text-xs text-slate-600">{message}</p>}
      </div>
    </div>
  )
}

async function requestQuota(clientId: string, init?: RequestInit): Promise<LoadedQuota | { ok: false; error: string }> {
  const res = await fetch(`/api/clients/${clientId}/publishing-quota`, init)
  const json = (await res.json().catch(() => ({}))) as {
    error?: string
    quota?: StoredQuota
    has_other_config?: boolean
    column_ready?: boolean
  }
  if (!res.ok || !json.quota) return { ok: false, error: json.error ?? '没有成功' }
  return {
    ok: true,
    quota: json.quota,
    hasOther: json.has_other_config === true,
    columnReady: json.column_ready !== false,
  }
}

function toPatch(form: Form): { ok: true; patch: Record<QuotaKey, number | null> } | { ok: false; error: string } {
  const patch = {} as Record<QuotaKey, number | null>
  for (const key of QUOTA_KEYS) {
    const raw = form[key].trim()
    if (raw === '') {
      patch[key] = null
      continue
    }
    if (!/^\d+$/.test(raw)) return { ok: false, error: '名额必须是 0 到 99 的整数，留空表示不配置' }
    const value = Number(raw)
    if (value > QUOTA_COUNT_MAX) return { ok: false, error: '名额必须是 0 到 99 的整数，留空表示不配置' }
    patch[key] = value
  }
  return { ok: true, patch }
}

export function PublishingQuotaPanel({ clientId }: { clientId: string }) {
  const [form, setForm] = useState<Form>(blankForm())
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [columnReady, setColumnReady] = useState(true)
  const [hasOther, setHasOther] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setPhase('loading')
    setMessage(null)
    const result = await requestQuota(clientId).catch(() => ({ ok: false as const, error: '读取失败' }))
    if (!result.ok) {
      setMessage(result.error)
      setPhase('error')
      return
    }
    setForm(toForm(result.quota))
    setHasOther(result.hasOther)
    setColumnReady(result.columnReady)
    setPhase('ready')
  }, [clientId])

  useEffect(() => { void load() }, [load])

  async function save() {
    const parsed = toPatch(form)
    if (!parsed.ok) return setMessage(parsed.error)
    setSaving(true)
    setMessage(null)
    const result = await requestQuota(clientId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed.patch),
    }).catch(() => ({ ok: false as const, error: '没有保存成功' }))
    setSaving(false)
    if (!result.ok) return setMessage(result.error)
    setForm(toForm(result.quota))
    setMessage('已保存。按周的数字要等全站开关打开并重新部署后，页面才按周算。')
  }

  if (phase === 'loading') return <p className="text-sm text-slate-400">加载中...</p>
  if (phase === 'error') {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm font-bold text-red-700">加载失败</p>
        <p className="mt-1 text-xs text-red-600">{message}</p>
        <button type="button" onClick={() => void load()} className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-1 text-xs font-bold text-red-700">重试</button>
      </div>
    )
  }

  return (
    <QuotaFields
      form={form}
      setForm={setForm}
      columnReady={columnReady}
      hasOther={hasOther}
      saving={saving}
      message={message}
      onSave={() => void save()}
    />
  )
}
