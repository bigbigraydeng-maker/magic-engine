'use client'

/**
 * 「批下一周」：给人看的句子。开关关闭时没有同意按钮，也不会去授权。
 */

import { useEffect, useState } from 'react'

import { ReelGoPublicPreviewPanel, type ReelGoPublicPreview } from '@/app/dashboard/factory/_components/PromoteReelButton'

interface CardView {
  run_id: string
  expected_decision_id: string
  fingerprint: string
  what: string
  date: string
  display_scope: string
  status_line: string
  confirm_enabled: boolean
  decline_enabled: boolean
  blocked_reason: string | null
}

interface PackPage {
  success: true
  enabled: boolean
  reel_go_public: boolean
  headline: string
  lines: string[]
  posts_line: string
  cadence_line: string
  message: string | null
  card: CardView | null
  reels: Array<{ work_order_id: string; title: string }>
  receipt_lines: string[]
}

type Load = { kind: 'loading' } | { kind: 'error'; text: string } | { kind: 'ready'; page: PackPage }

function asText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() && !/[{}[\]]/.test(value) ? value : fallback
}

function readPreview(value: unknown): ReelGoPublicPreview | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (typeof row.preview_token !== 'string' || row.preview_token.length < 8) return null
  const text = (item: unknown) => (typeof item === 'string' ? item : '')
  return {
    preview_token: row.preview_token,
    page_id: text(row.page_id),
    video_id: text(row.video_id),
    caption: text(row.caption),
    first_comment: text(row.first_comment),
    mode: text(row.mode),
  }
}

function isPage(value: unknown): value is PackPage {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<PackPage>
  return row.success === true && typeof row.enabled === 'boolean' && typeof row.headline === 'string' && Array.isArray(row.lines)
}

export function WeekPackApproval({ clientId }: { clientId: string }) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [seen, setSeen] = useState<Record<string, string>>({})
  const [openPreview, setOpenPreview] = useState<(ReelGoPublicPreview & { work_order_id: string }) | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/week-pack`)
        const json: unknown = await res.json().catch(() => null)
        if (cancelled) return
        if (!res.ok || !isPage(json)) {
          const error = json && typeof json === 'object' ? asText((json as { error?: unknown }).error, '') : ''
          setLoad({ kind: 'error', text: error || '整包这一栏读不到，请刷新。不要当成这一周没有内容。' })
          return
        }
        setLoad({ kind: 'ready', page: json })
      } catch {
        if (!cancelled) setLoad({ kind: 'error', text: '整包这一栏读不到，请刷新。不要当成这一周没有内容。' })
      }
    })()
    return () => { cancelled = true }
  }, [clientId])

  async function send(action: 'confirm' | 'decline' | 'revoke', card: CardView | null) {
    setBusy(true)
    setNote(null)
    try {
      const preview_tokens = Object.entries(seen).map(([work_order_id, preview_token]) => ({ work_order_id, preview_token }))
      const res = await fetch(`/api/clients/${clientId}/week-pack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          run_id: card?.run_id,
          fingerprint: card?.fingerprint,
          expected_decision_id: card?.expected_decision_id,
          preview_tokens,
        }),
      })
      const json: unknown = await res.json().catch(() => null)
      if (!res.ok || !isPage(json)) {
        const error = json && typeof json === 'object' ? asText((json as { error?: unknown }).error, '') : ''
        setNote(error || '没点成，请刷新后再试。')
        return
      }
      setLoad({ kind: 'ready', page: json })
      setSeen({})
      setOpenPreview(null)
    } catch {
      setNote('没点成，请刷新后再试。')
    } finally {
      setBusy(false)
    }
  }

  async function preview(workOrderId: string) {
    setBusy(true)
    setNote(null)
    try {
      const res = await fetch(`/api/factory/work-orders/${workOrderId}/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: false }),
      })
      const json: unknown = await res.json().catch(() => null)
      const preview = readPreview(json)
      if (!res.ok || !preview) {
        const error = json && typeof json === 'object' ? asText((json as { error?: unknown }).error, '') : ''
        setNote(error || '预览没做成，请再到视频工厂点一次。')
        return
      }
      setSeen((current) => {
        const next = { ...current }
        delete next[workOrderId]
        return next
      })
      setOpenPreview({ ...preview, work_order_id: workOrderId })
    } catch {
      setNote('预览没做成，请再到视频工厂点一次。')
    } finally {
      setBusy(false)
    }
  }

  if (load.kind === 'loading') return <section id="approve-week" className="rounded-2xl border border-black/10 bg-white p-4 text-sm text-me-charcoal/70">正在看下一周的整包。</section>
  if (load.kind === 'error') return <section id="approve-week" className="rounded-2xl border border-[#8F2B22]/30 bg-white p-4 text-sm font-medium text-[#8F2B22]">{load.text}</section>

  const page = load.page
  return (
    <section id="approve-week" className="space-y-3 rounded-2xl border border-black/10 bg-white p-4">
      <div>
        <h2 className="text-lg font-bold text-me-charcoal">批下一周</h2>
        <p className="text-sm font-semibold text-me-charcoal">{page.headline}</p>
      </div>
      <ul className="space-y-1 text-sm text-me-charcoal/80">
        {page.lines.map((line) => <li key={line}>{line}</li>)}
      </ul>
      <p className="text-sm text-me-charcoal/80">{page.posts_line}</p>
      <p className="text-xs text-me-charcoal/70">{page.cadence_line}</p>
      {page.message && <p className="text-sm font-medium text-me-charcoal">{page.message}</p>}
      {page.card && (
        <div className="space-y-1 rounded-xl bg-[#f6f7f2] p-3 text-sm text-me-charcoal">
          <p>{page.card.what}</p>
          <p>{page.card.date}</p>
          <p>{page.card.display_scope}</p>
          <p className="font-semibold">{page.card.status_line}</p>
          {page.card.blocked_reason && <p className="text-[#8F2B22]">{page.card.blocked_reason}</p>}
        </div>
      )}
      {page.reel_go_public && page.reels.length > 0 && (
        <ul className="space-y-2">
          {page.reels.map((reel) => (
            <li key={reel.work_order_id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-me-charcoal">{reel.title}</span>
              <button type="button" disabled={busy} onClick={() => void preview(reel.work_order_id)} className="rounded-lg border border-black/15 px-2 py-1 text-xs font-semibold">
                {seen[reel.work_order_id] ? '已看过' : '先预览'}
              </button>
            </li>
          ))}
          {openPreview && (
            <li>
              <ReelGoPublicPreviewPanel
                preview={openPreview}
                actions={(
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setSeen((current) => ({ ...current, [openPreview.work_order_id]: openPreview.preview_token }))
                      setOpenPreview(null)
                    }}
                    className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >我看过了</button>
                )}
              />
            </li>
          )}
          <li className="text-xs text-me-charcoal/70">看过公开内容之后，这条才会算预览过。还没看过的不会公开。预览只有几分钟，过了要再点一次。</li>
        </ul>
      )}
      {page.receipt_lines.length > 0 && (
        <ul className="space-y-1 text-sm text-me-charcoal">
          {page.receipt_lines.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
        </ul>
      )}
      {note && <p className="text-sm font-medium text-[#8F2B22]">{note}</p>}
      {page.enabled && (
        <div className="flex flex-wrap gap-2">
          {page.card && (
            <button type="button" disabled={busy || !page.card.confirm_enabled} onClick={() => void send('confirm', page.card)} className="rounded-lg bg-me-ochre px-3 py-1.5 text-sm font-bold text-me-charcoal disabled:opacity-40">
              同意这一周
            </button>
          )}
          {page.card && (
            <button type="button" disabled={busy || !page.card.decline_enabled} onClick={() => void send('decline', page.card)} className="rounded-lg border border-black/15 px-3 py-1.5 text-sm font-semibold disabled:opacity-40">
              这一周先不发
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => void send('revoke', page.card)} className="rounded-lg border border-black/15 px-3 py-1.5 text-sm font-semibold disabled:opacity-40">
            停掉还没发出去的
          </button>
        </div>
      )}
    </section>
  )
}
