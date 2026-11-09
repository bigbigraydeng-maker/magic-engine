'use client'

/**
 * 客户类型（普通 / 个人 IP）：设一次，以后开方都照它开。放在现有客户资料里，不加新按钮页。
 * 读写 /api/clients/[id]/client-kind；没设过的按普通客户。
 */

import { useEffect, useState } from 'react'

type Kind = 'standard' | 'personal_ip'

const OPTIONS: Array<{ value: Kind; label: string }> = [
  { value: 'standard', label: '普通客户' },
  { value: 'personal_ip', label: '个人 IP' },
]

export function ClientKindField({ clientId }: { clientId: string }) {
  const [kind, setKind] = useState<Kind | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetch(`/api/clients/${clientId}/client-kind`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { client_kind?: Kind } | null) => {
        if (!cancelled) setKind(body?.client_kind ?? 'standard')
      })
      .catch(() => { if (!cancelled) setKind('standard') })
    return () => { cancelled = true }
  }, [clientId])

  const choose = async (next: Kind) => {
    if (saving || next === kind) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/client-kind`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_kind: next }),
      })
      if (!res.ok) throw new Error('没存上，请再点一次。')
      setKind(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : '没存上，请再点一次。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="mb-3 text-sm text-slate-600">
        个人 IP 客户开方时会多问「每周能拍几条」，并按立人设、放大加攒人、变成生意三步开。没设过的按普通客户。
      </p>
      <div className="flex gap-2" role="radiogroup" aria-label="客户类型">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={kind === option.value}
            disabled={kind === null || saving}
            onClick={() => void choose(option.value)}
            className={`flex-1 rounded-lg border py-2 text-sm font-bold transition-colors ${
              kind === option.value
                ? 'border-cyan-500 bg-cyan-50 text-cyan-700'
                : 'border-slate-300 text-slate-500 hover:border-slate-400'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  )
}
