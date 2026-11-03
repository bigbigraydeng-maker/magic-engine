'use client'

import { useState } from 'react'
import type { Ruling } from '@/lib/baozheng/accuracy'

const OPTIONS: ReadonlyArray<{ value: Ruling; label: string }> = [
  { value: 'ai_right', label: '原来的 AI 对' },
  { value: 'review_right', label: '复核的对' },
  { value: 'neither', label: '都不对' },
]

function labelOf(ruling: Ruling): string {
  const found = OPTIONS.find((o) => o.value === ruling)
  return found ? found.label : ruling
}

export function RulingButtons({
  clientId,
  judgmentId,
  current,
}: {
  clientId: string
  judgmentId: string
  current: Ruling | null
}): JSX.Element {
  const [chosen, setChosen] = useState<Ruling | null>(current)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string>('')

  async function pick(ruling: Ruling): Promise<void> {
    setStatus('saving')
    setError('')
    try {
      const res = await fetch(`/api/clients/${clientId}/baozheng/${judgmentId}/ruling`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ruling }),
      })
      if (res.ok) {
        setChosen(ruling)
        setStatus('saved')
        return
      }
      const body = (await res.json().catch(() => ({}))) as { error?: unknown }
      setError(typeof body.error === 'string' ? body.error : '保存失败')
      setStatus('error')
    } catch {
      setError('保存失败')
      setStatus('error')
    }
  }

  const saving = status === 'saving'

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((opt) => {
          const selected = chosen === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              disabled={saving}
              onClick={() => void pick(opt.value)}
              className={
                selected
                  ? 'rounded border border-me-charcoal bg-me-charcoal px-3 py-1.5 text-sm text-me-ivory disabled:opacity-60'
                  : 'rounded border border-me-charcoal/30 bg-me-ivory px-3 py-1.5 text-sm text-me-charcoal disabled:opacity-60'
              }
            >
              {opt.label}
            </button>
          )
        })}
      </div>
      <div className="mt-2 text-sm">
        {status === 'saved' ? <span className="text-me-charcoal">记下了。</span> : null}
        {status === 'idle' && chosen !== null ? (
          <span className="text-me-charcoal/70">之前选的是：{labelOf(chosen)}（可以改）</span>
        ) : null}
        {status === 'error' ? <span className="text-red-600">{error}</span> : null}
      </div>
    </div>
  )
}
