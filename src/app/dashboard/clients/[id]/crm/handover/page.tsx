'use client'

/**
 * 客人交接 —— 把一位同事名下的客人整批转给另一位（同事离职 / 换人时用）。
 * 先预览会动多少位，再确认才真改。只有内部管理员能改；其他人点确认会收到「没权限」。
 */
import { useEffect, useState } from 'react'

type Preview = { count: number; from: string; to: string | null }

async function transfer(clientId: string, from: string, to: string | null, dryRun: boolean) {
  const res = await fetch(`/api/clients/${clientId}/crm/assignees/transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, dryRun }),
  })
  const data = (await res.json().catch(() => ({}))) as { count?: number; error?: string }
  if (!res.ok) throw new Error(data.error ?? '操作失败')
  return data.count ?? 0
}

export default function CrmHandoverPage({ params }: { params: { id: string } }) {
  const clientId = params.id
  const [people, setPeople] = useState<string[]>([])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/clients/${clientId}/crm/assignees`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { assignees: { email: string }[] }) => setPeople(d.assignees.map((a) => a.email)))
      .catch(() => setMsg('读取同事名单失败，刷新再试。'))
  }, [clientId])

  const target = to === '__none__' ? null : to
  const ready = from.trim().length > 0 && to !== '' && (target === null || target !== from.trim().toLowerCase())

  async function run(dryRun: boolean) {
    setBusy(true)
    setMsg(null)
    try {
      const count = await transfer(clientId, from.trim().toLowerCase(), target, dryRun)
      if (dryRun) setPreview({ count, from: from.trim().toLowerCase(), to: target })
      else {
        setPreview(null)
        setMsg(`已转交 ${count} 位客人。`)
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl px-5 py-6 sm:px-8">
      <h1 className="mb-1 text-lg font-semibold text-me-charcoal">客人交接</h1>
      <p className="mb-4 text-sm text-me-charcoal/70">把一位同事名下的客人整批转给另一位。只改「跟进人」，不动客人的任何记录。</p>

      <label className="mb-3 block text-sm">
        从谁手里转出（邮箱，离职同事也可以填）
        <input className="mt-1 w-full rounded border border-me-charcoal/20 px-2 py-1.5" value={from} onChange={(e) => { setFrom(e.target.value); setPreview(null) }} placeholder="old@example.com" />
      </label>
      <label className="mb-4 block text-sm">
        转给谁
        <select className="mt-1 w-full rounded border border-me-charcoal/20 px-2 py-1.5" value={to} onChange={(e) => { setTo(e.target.value); setPreview(null) }}>
          <option value="">请选择</option>
          {people.map((p) => <option key={p} value={p}>{p}</option>)}
          <option value="__none__">没人跟进（清空）</option>
        </select>
      </label>

      <button type="button" disabled={!ready || busy} onClick={() => run(true)} className="rounded border border-me-charcoal px-3 py-1.5 text-sm disabled:opacity-40">先看会动多少位</button>

      {preview && (
        <div className="mt-4 rounded border border-me-charcoal/20 bg-white p-3 text-sm">
          <p>会把 <b>{preview.count}</b> 位客人从 {preview.from} 转给 {preview.to ?? '没人跟进'}。</p>
          {preview.count > 0 && (
            <button type="button" disabled={busy} onClick={() => run(false)} className="mt-2 rounded bg-me-charcoal px-3 py-1.5 text-white disabled:opacity-40">确认转交</button>
          )}
        </div>
      )}
      {msg && <p className="mt-3 text-sm">{msg}</p>}
    </div>
  )
}
