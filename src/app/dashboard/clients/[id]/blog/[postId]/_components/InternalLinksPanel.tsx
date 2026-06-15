'use client'

/**
 * InternalLinksPanel — surface the `internal_links[]` array stored on the
 * blog post so FDE can see which links the generator wanted to embed and
 * mark each one as Resolved once they've added the target page in WP.
 *
 * Phase 12.R.B10 — until this PR the column was written-to but never read.
 * FDE had no way to mark links as resolved without editing JSON in Supabase
 * Studio, so the field rotted as draft posts shipped with `resolved: false`
 * even when the WP target eventually went live.
 *
 * UI shape
 * --------
 *   - One row per link: anchor + target slug + status chip + Toggle button.
 *   - Unresolved rows get an amber border so they're visible at-a-glance.
 *   - "Resolved" rows get a green check.
 *   - Optimistic update: flip the local state, fire PATCH, roll back on error.
 */

import { useCallback, useState } from 'react'
import type { BlogInternalLink } from '@/types/magic-engine'

interface Props {
  clientId:      string
  postId:        string
  initialLinks:  BlogInternalLink[]
  /** Bubble up the canonical list after a successful save so the parent
   *  cache (BlogPostPage `post.internal_links`) stays in sync. */
  onChange?:    (links: BlogInternalLink[]) => void
}

export function InternalLinksPanel({ clientId, postId, initialLinks, onChange }: Props) {
  const [links,   setLinks]   = useState<BlogInternalLink[]>(initialLinks)
  const [busyIdx, setBusyIdx] = useState<number | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  const total      = links.length
  const resolved   = links.filter(l => l.resolved).length
  const unresolved = total - resolved

  const persist = useCallback(async (next: BlogInternalLink[]): Promise<boolean> => {
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/blog/${postId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ internal_links: next }),
      })
      const j = await res.json() as { success?: boolean; post?: { internal_links?: BlogInternalLink[] }; error?: string }
      if (!res.ok || !j.success) {
        setError(j.error ?? `Save failed (HTTP ${res.status})`)
        return false
      }
      // Trust the server's canonical list (it sanitizes / re-orders).
      const canonical = j.post?.internal_links ?? next
      setLinks(canonical)
      onChange?.(canonical)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
      return false
    }
  }, [clientId, postId, onChange])

  const handleToggle = useCallback(async (idx: number) => {
    if (busyIdx !== null) return
    setBusyIdx(idx)
    const snapshot = links
    const next     = links.map((l, i) => i === idx ? { ...l, resolved: !l.resolved } : l)
    // Optimistic flip.
    setLinks(next)
    const ok = await persist(next)
    if (!ok) {
      // Roll back optimistic flip on failure.
      setLinks(snapshot)
    }
    setBusyIdx(null)
  }, [busyIdx, links, persist])

  if (total === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Internal Links</h3>
        <p className="text-xs text-gray-500">
          The generator did not propose any internal links for this post.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Internal Links</h3>
        <span className="text-[11px] text-gray-500">
          {resolved}/{total} resolved
          {unresolved > 0 && (
            <span className="ml-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-50 border border-amber-200 text-amber-700 rounded">
              ⚠ {unresolved} pending
            </span>
          )}
        </span>
      </div>
      {error && (
        <p className="text-xs text-red-600">{error}</p>
      )}
      <ul className="space-y-2">
        {links.map((link, idx) => {
          const isUnresolved = !link.resolved
          return (
            <li
              key={`${link.target_slug}-${idx}`}
              className={`flex items-start gap-2 border rounded-md px-3 py-2 ${
                isUnresolved ? 'border-amber-200 bg-amber-50/40' : 'border-gray-200 bg-white'
              }`}
            >
              <span className="flex-shrink-0 mt-0.5 text-xs">
                {link.resolved ? '✅' : '⚠️'}
              </span>
              <div className="flex-1 min-w-0 space-y-0.5">
                <p className="text-xs text-gray-900 break-words">
                  &ldquo;{link.anchor || <span className="text-gray-400">(no anchor)</span>}&rdquo;
                </p>
                <p className="text-[11px] text-gray-500 font-mono break-all">
                  → {link.target_slug || <span className="italic">(no slug)</span>}
                </p>
                {isUnresolved && (
                  <p className="text-[11px] text-amber-700 mt-0.5">
                    Add a page at this slug in WP, then mark resolved.
                  </p>
                )}
              </div>
              <button
                onClick={() => void handleToggle(idx)}
                disabled={busyIdx !== null}
                className={`flex-shrink-0 text-[11px] font-medium px-2 py-1 rounded border transition-colors disabled:opacity-40 ${
                  link.resolved
                    ? 'border-gray-300 text-gray-600 hover:bg-gray-50'
                    : 'border-green-300 text-green-700 hover:bg-green-50'
                }`}
              >
                {busyIdx === idx ? '…' : link.resolved ? 'Mark unresolved' : 'Mark resolved'}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
