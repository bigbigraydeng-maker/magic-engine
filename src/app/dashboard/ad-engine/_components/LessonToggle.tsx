'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface ClientOption {
  id: string
  name: string
}

async function postAudience(
  lessonKey: string,
  mode: 'all' | 'off' | 'one',
  clientId?: string,
): Promise<void> {
  const res = await fetch('/api/admin/agent-learning/audience', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lessonKey, mode, clientId }),
  })
  const json = await res.json().catch(() => ({})) as { success?: boolean; error?: unknown }
  if (!res.ok || !json.success) {
    throw new Error(typeof json.error === 'string' ? json.error : '操作失败')
  }
}

function OneClientForm({
  clients,
  busy,
  onConfirm,
}: {
  clients: ClientOption[]
  busy: boolean
  onConfirm: (clientId: string) => void
}) {
  const [clientId, setClientId] = useState('')
  const options = [...clients].sort((a, b) => a.name.localeCompare(b.name, 'en'))

  return (
    <div className="mt-1 flex flex-col items-end gap-1">
      <label className="text-[11px] text-slate-500">
        客户
        <select
          aria-label="客户"
          value={clientId}
          disabled={busy}
          onChange={(e) => setClientId(e.target.value)}
          className="mt-1 block max-w-[14rem] rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800"
        >
          <option value="">选一个客户</option>
          {options.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name.trim() || '未命名客户'}
            </option>
          ))}
        </select>
      </label>
      <p className="max-w-[14rem] text-right text-[11px] text-slate-500">其它客户的助手读不到这条。</p>
      <button
        type="button"
        disabled={busy || clientId === ''}
        onClick={() => onConfirm(clientId)}
        className="rounded bg-teal-50 px-3 py-1 text-xs font-medium text-teal-800 ring-1 ring-teal-200 disabled:opacity-50"
      >
        只给这个客户开
      </button>
    </div>
  )
}

/**
 * 一条经验的开关。
 * 「恢复」= 所有符合范围的客户。「只给某个客户开」= 名单里只有这一个。
 */
export default function LessonToggle({
  lessonKey,
  isActive,
  clients,
}: {
  lessonKey: string
  isActive: boolean
  clients: ClientOption[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)

  async function send(mode: 'all' | 'off' | 'one', clientId?: string) {
    setBusy(true)
    setError(null)
    try {
      await postAudience(lessonKey, mode, clientId)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => send(isActive ? 'off' : 'all')}
        disabled={busy}
        className={`rounded px-3 py-1 text-xs font-medium transition disabled:opacity-50 ${
          isActive
            ? 'bg-red-50 text-red-700 hover:bg-red-100 ring-1 ring-red-200'
            : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 ring-1 ring-emerald-200'
        }`}
      >
        {busy ? '…' : isActive ? '停用' : '恢复'}
      </button>
      {!isActive && (
        <button
          type="button"
          onClick={() => setPicking((open) => !open)}
          disabled={busy}
          className="rounded px-3 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-300 disabled:opacity-50"
        >
          只给某个客户开
        </button>
      )}
      {!isActive && picking && <OneClientForm clients={clients} busy={busy} onConfirm={(id) => send('one', id)} />}
      {error && <span className="max-w-[14rem] text-right text-[11px] text-red-600">{error}</span>}
    </div>
  )
}
