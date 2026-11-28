'use client'

/**
 * The narrow bar at the top of the drawer: "guests are waiting for you to release
 * them to AI".
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * Releasing needs a person to click. On 2026-11-28, 216 guests were waiting on the
 * "交给 AI 跟进" page and nobody had clicked for two weeks — because nothing on the
 * staff page said so. This bar is that "say so".
 *
 * ── Rules ─────────────────────────────────────────────────────────────────
 * · **Ask once on mount** — no interval, no document.title changes. This is a
 *   nudge, not a live feed.
 * · **Read failure renders nothing** — no red error. Same trade-off as
 *   NewMessagesBanner: this is a nice-to-have and must not block the drawer.
 * · **A late result after unmount must not setState** — guarded by an `alive` flag.
 */

import { useEffect, useState } from 'react'

interface Waiting {
  waiting: number
  daysSinceRelease: number | null
}

/** Narrow the parsed body to our shape; anything else means "render nothing". */
function parseWaiting(body: unknown): Waiting | null {
  if (typeof body !== 'object' || body === null) return null
  const rec = body as Record<string, unknown>
  if (typeof rec.waiting !== 'number') return null
  const days = rec.daysSinceRelease
  return {
    waiting: rec.waiting,
    daysSinceRelease: typeof days === 'number' ? days : null,
  }
}

export function AiPickupWaitingBanner({ clientId }: { clientId: string }) {
  const [state, setState] = useState<Waiting | null>(null)

  useEffect(() => {
    let alive = true

    const load = async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/crm/ai-pickup/waiting`)
        if (!res.ok) return
        const parsed = parseWaiting(await res.json())
        if (!alive || parsed === null) return
        setState(parsed)
      } catch {
        // Read failure: stay silent — no red error in the drawer.
      }
    }

    void load()

    return () => {
      alive = false
    }
  }, [clientId])

  if (state === null || state.waiting <= 0) return null

  const tail =
    state.daysSinceRelease === null
      ? '还从来没有人放行过。'
      : state.daysSinceRelease >= 1
        ? `已经 ${state.daysSinceRelease} 天没有人放行了。`
        : ''

  return (
    <div
      role="status"
      data-testid="ai-pickup-waiting-banner"
      className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-me-ochre/15 px-3 py-2 text-sm font-semibold text-me-charcoal"
    >
      <span>
        有 {state.waiting} 位客人在等你放行给 AI（询价 7 天没人打、打了没接通、或留言要目录）。{tail}
      </span>
      <a
        href={`/dashboard/clients/${clientId}/crm/ai-pickup`}
        className="rounded-md bg-me-charcoal px-3 py-1 text-xs font-bold text-white"
      >
        去放行
      </a>
    </div>
  )
}
