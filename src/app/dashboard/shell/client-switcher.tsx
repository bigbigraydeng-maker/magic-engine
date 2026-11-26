'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { cx } from '@/components/ui/me-theme'
import type { ClientListRow } from './use-client-shell-data'
import { swapClientInPath } from './nav-active'

export function ClientSwitcher({
  clientId,
  clientName,
  clients,
  pathname,
}: {
  clientId: string
  clientName: string | null
  clients: ClientListRow[]
  pathname: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')

  const current = clients.find((c) => c.id === clientId)
  const label = current?.name ?? clientName ?? clientId.slice(0, 8)

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return clients
    return clients.filter(
      (c) =>
        c.name.toLowerCase().includes(needle) ||
        (c.domain ?? '').toLowerCase().includes(needle),
    )
  }, [clients, q])

  return (
    <div className="relative mb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-xl border border-black/10 bg-white px-2.5 py-2 text-left shadow-sm transition hover:border-me-ochre/35"
        aria-expanded={open}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-me-ochre text-sm font-black text-white">
          {label.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-bold text-me-charcoal">{label}</span>
          {current?.domain && (
            <span className="block truncate text-[11px] font-semibold text-me-charcoal/45">
              {current.domain}
            </span>
          )}
        </span>
        <span className="text-me-charcoal/40" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-40 rounded-xl border border-black/10 bg-white p-2 shadow-lg">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索客户"
            className="mb-2 w-full rounded-lg border border-black/10 px-2.5 py-2 text-sm font-semibold text-me-charcoal outline-none focus:border-me-ochre/50"
          />
          <ul className="max-h-56 space-y-0.5 overflow-y-auto">
            {filtered.map((c) => {
              const active = c.id === clientId
              return (
                <li key={c.id}>
                  <Link
                    href={swapClientInPath(pathname, c.id)}
                    onClick={() => setOpen(false)}
                    className={cx(
                      'flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold transition',
                      active ? 'bg-me-ochre/12 text-me-charcoal' : 'text-me-charcoal/70 hover:bg-black/[.04]',
                    )}
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-md bg-me-ochre/15 text-[11px] font-black text-me-ochre">
                      {c.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    {active && <span className="text-me-ochre">✓</span>}
                  </Link>
                </li>
              )
            })}
          </ul>
          <Link
            href="/dashboard/clients"
            className="mt-2 block rounded-lg px-2 py-2 text-center text-xs font-bold text-me-ochre hover:bg-me-ochre/8"
            onClick={() => setOpen(false)}
          >
            看全部客户 →
          </Link>
          <p className="mt-1 px-1 text-[10px] leading-snug text-me-charcoal/40">
            切换客户会留在当前功能页（如广告健康、任务）。
          </p>
        </div>
      )}
    </div>
  )
}
