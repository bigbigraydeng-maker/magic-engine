'use client'

/**
 * Phase X.S4 — Functional-feature lock for self_serve users.
 *
 * Wrap functional pages with this component. When the visitor is on a tier
 * below `paid_client`, the children are hidden behind a soft overlay and a
 * "Talk to Us / Magic Lab Class" modal is shown.
 *
 *   <FeatureLockGate tier={userTier} feature="goals">
 *     <GoalsPage clientId={...} />
 *   </FeatureLockGate>
 *
 * Two trigger paths:
 *   1. Static — when `tier !== 'admin' && tier !== 'paid_client'` on mount,
 *      the gate engages and the children render dimmed and non-interactive.
 *   2. Dynamic — when the backend returns 403 with `reason: 'paid_only'`,
 *      callers can dispatch a `feature-lock:trigger` window event with
 *      `{ feature }` detail; the modal opens with the feature label.
 *
 * The dynamic path lets API helpers throw a typed PaidOnlyError and have
 * the modal surface without every page needing to wire its own handler.
 */

import React, { useEffect, useState } from 'react'
import Link from 'next/link'

export type UserTierProp = 'admin' | 'paid_client' | 'self_serve' | 'portal_only'

export interface FeatureLockGateProps {
  tier: UserTierProp
  /** Display name for the locked feature (e.g. "Goals", "Strategy", "Diagnostic"). */
  feature: string
  /** A short subtitle shown under the title. */
  subtitle?: string
  children?: React.ReactNode
}

/**
 * Top-level page gate. Renders children dimmed + opens the upsell modal
 * automatically for non-paid tiers.
 */
export function FeatureLockGate({ tier, feature, subtitle, children }: FeatureLockGateProps) {
  const locked = tier !== 'admin' && tier !== 'paid_client'
  const [open, setOpen] = useState(locked)

  // Allow other code (API helpers, child components) to manually trigger the
  // modal with a richer feature label when a paid_only 403 is encountered.
  useEffect(() => {
    if (!locked) return
    function onTrigger(evt: Event) {
      const e = evt as CustomEvent<{ feature?: string } | undefined>
      // We always reuse the same modal; we don't currently override the label
      // dynamically because in practice the surrounding page already represents
      // the locked feature. The event is here for future use.
      void e
      setOpen(true)
    }
    window.addEventListener('feature-lock:trigger', onTrigger)
    return () => window.removeEventListener('feature-lock:trigger', onTrigger)
  }, [locked])

  return (
    <>
      <div className={locked ? 'pointer-events-none select-none opacity-40 blur-[0.5px]' : undefined} aria-hidden={locked}>
        {children}
      </div>
      <FeatureLockModal feature={feature} subtitle={subtitle} open={open} onClose={() => setOpen(false)} dismissible={false} />
    </>
  )
}

/**
 * Standalone modal — exported for callers that want to trigger the upsell
 * without wrapping the page (e.g. on a button click).
 */
export function FeatureLockModal({
  feature,
  subtitle,
  open,
  onClose,
  dismissible = true,
}: {
  feature: string
  subtitle?: string
  open: boolean
  onClose: () => void
  /** Whether the user can close the modal. For full-page gates we keep it pinned. */
  dismissible?: boolean
}) {
  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Unlock ${feature}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={dismissible ? onClose : undefined}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl sm:p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-700">
          Paid feature
        </p>
        <h2 className="mt-2 text-xl font-black text-slate-950">
          Unlock {feature}
        </h2>
        {subtitle && (
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {subtitle}
          </p>
        )}
        {!subtitle && (
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {feature} needs hands-on configuration and ongoing coaching to deliver
            real lift. Choose the path that fits your team:
          </p>
        )}

        <div className="mt-6 grid gap-3">
          <a
            href="mailto:hello@magiclab.com.au?subject=FDE%20chaperone%20—%20Magic%20Engine"
            className="flex items-start gap-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4 transition hover:border-indigo-400 hover:bg-indigo-100"
          >
            <span className="text-2xl">💬</span>
            <span className="flex-1">
              <span className="block text-sm font-bold text-indigo-950">
                Talk to us — FDE chaperone
              </span>
              <span className="mt-1 block text-xs leading-5 text-indigo-900/80">
                A Magic Engine field engineer configures, runs and reviews this with you.
              </span>
            </span>
          </a>
          <a
            href="https://magiclab.com.au/class"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 transition hover:border-emerald-400 hover:bg-emerald-100"
          >
            <span className="text-2xl">🎓</span>
            <span className="flex-1">
              <span className="block text-sm font-bold text-emerald-950">
                Magic Lab Class
              </span>
              <span className="mt-1 block text-xs leading-5 text-emerald-900/80">
                Self-paced training — learn the playbook and run it yourself.
              </span>
            </span>
          </a>
        </div>

        {dismissible ? (
          <button
            type="button"
            onClick={onClose}
            className="mt-5 w-full rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            Maybe later
          </button>
        ) : (
          <Link
            href="/dashboard"
            className="mt-5 block w-full rounded-lg border border-slate-200 px-4 py-2 text-center text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            Back to dashboard
          </Link>
        )}
      </div>
    </div>
  )
}

/**
 * Helper to dispatch the trigger event from anywhere in the client tree.
 * Call this after catching a 403 reason='paid_only' from a fetch.
 */
export function triggerFeatureLock(feature: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('feature-lock:trigger', { detail: { feature } }))
}
