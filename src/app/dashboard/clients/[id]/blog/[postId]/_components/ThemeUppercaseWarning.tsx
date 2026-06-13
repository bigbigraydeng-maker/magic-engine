'use client'

/**
 * ThemeUppercaseWarning — P12.R.A8 publish-time precheck.
 *
 * Mounts inside PublishToWebsitePanel and fires the cheap theme-CSS scan once
 * when the FDE looks at the post. Renders a warning chip ONLY when the scan
 * confirms the theme forces paragraph text to uppercase.
 *
 * Non-blocking by design: the publish flow is unchanged whether this chip is
 * present or not.
 */

import { useEffect, useState } from 'react'

interface CheckResponse {
  success?:     boolean
  uppercase?:   boolean | null
  matches?:     Array<{ selector: string; source: string }>
  warnings?:    string[]
  remediation?: string | null
}

interface Props {
  clientId: string
  /**
   * When false, skip the fetch entirely. Used by the parent to avoid wasting
   * a fetch when no WordPress connection is wired up.
   */
  enabled?: boolean
}

export function ThemeUppercaseWarning({ clientId, enabled = true }: Props) {
  const [result, setResult] = useState<CheckResponse | null>(null)
  const [show,   setShow]   = useState(true)   // FDE may dismiss the warning

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/cms/wordpress/theme-uppercase-check`)
        if (!res.ok) return
        const j = await res.json() as CheckResponse
        if (!cancelled) setResult(j)
      } catch {
        // Silent — this is a non-blocking precheck.
      }
    })()
    return () => { cancelled = true }
  }, [clientId, enabled])

  if (!enabled || !show || !result || result.uppercase !== true) return null

  // Show only the FIRST match in the chip; full list goes in the tooltip.
  const firstMatch    = result.matches?.[0]
  const matchSummary  = firstMatch
    ? `${firstMatch.selector}${result.matches && result.matches.length > 1 ? ` (+ ${result.matches.length - 1} more)` : ''}`
    : 'a content-paragraph rule'

  return (
    <div className="flex items-start gap-2 px-3 py-2 text-[11px] bg-amber-50 border border-amber-300 text-amber-900 rounded-md max-w-md">
      <span className="text-sm leading-none mt-0.5">⚠️</span>
      <div className="flex-1 space-y-1">
        <p className="font-semibold">
          客户主题强制段落大写
        </p>
        <p className="text-amber-800">
          检测到 <code className="font-mono bg-amber-100 px-1 rounded">{matchSummary}</code> 命中 <code className="font-mono">text-transform: uppercase</code>。
          {result.remediation
            ? ' Customizer → Typography → Body → Text Transform 改为 None,否则正文将全部渲染为大写。'
            : ' 发布后正文可能全部渲染为大写。'}
        </p>
      </div>
      <button
        onClick={() => setShow(false)}
        aria-label="Dismiss"
        className="text-amber-500 hover:text-amber-700 text-sm leading-none"
      >
        ✕
      </button>
    </div>
  )
}
