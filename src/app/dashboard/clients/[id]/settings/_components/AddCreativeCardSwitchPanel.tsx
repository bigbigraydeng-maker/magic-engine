'use client'

import { useCallback, useEffect, useState } from 'react'

export function AddCreativeCardSwitchPanel({ clientId }: { clientId: string }) {
  const sw = useCreativeSwitch(clientId)
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-slate-800">往广告组加图的确认卡</p>
          <p className="mt-1 text-xs text-slate-500">默认关。打开后才能出加图卡。关掉则不出卡，也不会去建广告。</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={sw.enabled}
          aria-label="开关往广告组加图的确认卡"
          disabled={sw.phase !== 'ready'}
          onClick={() => { void sw.toggle() }}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${sw.enabled ? 'bg-cyan-600' : 'bg-slate-300'}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${sw.enabled ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-500">{sw.phase === 'loading' ? '加载中…' : sw.enabled ? '已开启' : '已关闭'}</p>
      {sw.note ? <p className="mt-1 text-xs text-red-600">{sw.note}</p> : null}
    </div>
  )
}

function useCreativeSwitch(clientId: string) {
  const [enabled, setEnabled] = useState(false)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [note, setNote] = useState<string | null>(null)
  const base = `/api/clients/${clientId}/ad-strategy-config/add-creative-card`

  const reload = useCallback(async () => {
    setPhase('loading')
    const res = await fetch(base, { cache: 'no-store' })
    const json = await res.json().catch(() => ({})) as { enabled?: boolean; error?: string }
    if (!res.ok) {
      setNote(json.error ?? '开关读不到。')
      setPhase('error')
      return
    }
    setEnabled(json.enabled === true)
    setNote(null)
    setPhase('ready')
  }, [base])

  useEffect(() => { void reload() }, [reload])

  async function toggle() {
    if (phase !== 'ready') return
    const next = !enabled
    setEnabled(next)
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    })
    const json = await res.json().catch(() => ({})) as { enabled?: boolean; error?: string }
    if (!res.ok) {
      setEnabled(!next)
      setNote(json.error ?? '开关没写成。')
      return
    }
    setEnabled(json.enabled === true)
    setNote(null)
  }

  return { enabled, phase, note, toggle }
}
