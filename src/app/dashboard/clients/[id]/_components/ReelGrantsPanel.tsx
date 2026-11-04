'use client'

// 「已授权、还没公开」：周卡上批过、等到日公开的 Reel。可单条撤回；内容或日子变了的可重新预览后授权。
// 设计稿 docs/specs/2026-11-04-reel-scheduled-go-public-design-v0.2.md §8.3。只读授权状态，不在这里公开任何东西。

import { useCallback, useEffect, useState } from 'react'
import { ReelGoPublicPreviewPanel, type ReelGoPublicPreview } from '@/app/dashboard/factory/_components/PromoteReelButton'
import { readPreview } from './WeekPackApproval'

interface GrantView {
  work_order_id: string
  grant: { status: string; publish_on: string; authorized_by: string; reason?: string }
}

const STATUS_ZH: Record<string, string> = {
  armed: '已授权，等到日公开',
  claimed: '正在发',
  stale: '批后内容或日子变了，没发',
  missed: '错过了发布日，没发',
  failed: '发失败，仍是草稿',
  unknown: '结果不明，请到 Facebook 核对',
}
const REAUTH = new Set(['stale', 'missed', 'failed', 'unknown'])

function readGrants(json: unknown): GrantView[] | null {
  if (!json || typeof json !== 'object') return null
  const grants = (json as { grants?: unknown }).grants
  return Array.isArray(grants) ? (grants as GrantView[]) : null
}

export function ReelGrantsPanel({ clientId }: { clientId: string }) {
  const [grants, setGrants] = useState<GrantView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ id: string; data: ReelGoPublicPreview } | null>(null)
  const base = `/api/clients/${clientId}/week-pack/reel-grants`

  const load = useCallback(async () => {
    const res = await fetch(base).catch(() => null)
    const json: unknown = res ? await res.json().catch(() => null) : null
    const list = res?.ok ? readGrants(json) : null
    if (list === null) { setError('授权列表没读出来，不要当成没有。'); return }
    setError(null); setGrants(list)
  }, [base])

  useEffect(() => { void load() }, [load])

  async function post(body: Record<string, unknown>): Promise<void> {
    const res = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    const json = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null
    if (!res?.ok) setError(json?.error ?? '没做成，请刷新再试。')
    setPreview(null)
    await load()
  }

  async function startPreview(id: string): Promise<void> {
    const res = await fetch(`/api/factory/work-orders/${id}/promote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: false }) }).catch(() => null)
    const json: unknown = res ? await res.json().catch(() => null) : null
    const data = res?.ok ? readPreview(json) : null
    if (!data) { setError('预览没做成：可能内容和团目录对不上，请先改片。'); return }
    setPreview({ id, data })
  }

  if (error && grants === null) return <p role="alert" className="text-sm text-red-700">{error}</p>
  if (!grants || grants.length === 0) return null
  return (
    <section className="rounded-lg border border-slate-200 bg-white px-3 py-3 space-y-2">
      <h3 className="text-sm font-medium text-slate-900">已授权、还没公开的 Reel</h3>
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      <ul className="space-y-2">
        {grants.map(({ work_order_id: id, grant }) => (
          <li key={id} className="text-xs text-slate-700 space-y-1">
            <p>{grant.publish_on} · {STATUS_ZH[grant.status] ?? grant.status} · 批准人 {grant.authorized_by}</p>
            {grant.reason && grant.status !== 'armed' && <p className="text-slate-500">{grant.reason}</p>}
            <div className="flex gap-2">
              {grant.status !== 'claimed' && <button type="button" className="underline" onClick={() => void post({ action: 'revoke', work_order_id: id })}>撤回</button>}
              {REAUTH.has(grant.status) && <button type="button" className="underline" onClick={() => void startPreview(id)}>重新预览并授权</button>}
            </div>
            {preview?.id === id && (
              <ReelGoPublicPreviewPanel
                preview={preview.data}
                actions={<button type="button" className="underline" onClick={() => void post({ action: 'authorize', work_order_id: id, preview_token: preview.data.preview_token })}>按这个内容授权</button>}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
