/**
 * GET /api/clients/[id]/cms/wordpress/theme-uppercase-check  [P12.R.A8]
 *
 * Fetches the client's WordPress homepage + every linked stylesheet and
 * scans for `text-transform: uppercase` rules targeting content paragraphs.
 *
 * Used by the Blog Detail "Publish to website" panel to warn the FDE BEFORE
 * they push ME-generated content — if the theme forces uppercase, the post
 * will render in all-caps on the public page (2026-06-13 Astra incident).
 *
 * Non-blocking by design: always returns 200 with `{ success: true, ... }`
 * even when the check could not complete. The UI degrades gracefully.
 *
 * Caching:
 *   No server-side cache; the cost is one homepage fetch + ≤10 stylesheet
 *   fetches per call. The Blog Detail page calls this once on mount, so the
 *   cost per FDE-session is bounded.
 *
 * Auth: requirePaidClientAccess.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { getWordpressConnection } from '@/lib/cms/connection-store'
import { detectThemeUppercase, type UppercaseMatch } from '@/lib/cms/theme-text-transform-check'

interface RouteContext {
  params: { id: string }
}

interface ResponseBody {
  success:    true
  /** `null` when we couldn't run the check at all (no WP connection, etc.) */
  uppercase:  boolean | null
  matches:    UppercaseMatch[]
  /** Why uppercase is `null`, or per-stylesheet fetch failures from the lib. */
  warnings:   string[]
  /** Helpful next step text for the UI. */
  remediation: string | null
}

function shape(body: Partial<ResponseBody>): NextResponse {
  return NextResponse.json({
    success:    true,
    uppercase:  null,
    matches:    [],
    warnings:   [],
    remediation: null,
    ...body,
  } satisfies ResponseBody)
}

export async function GET(_req: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const { id: clientId } = params

  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const conn = await getWordpressConnection(clientId)
  if (!conn) {
    return shape({ warnings: ['No WordPress connection — skipping theme check.'] })
  }
  if (conn.status !== 'connected') {
    return shape({ warnings: ['WordPress connection not verified — skipping theme check.'] })
  }

  try {
    const result = await detectThemeUppercase(conn.siteUrl)
    return shape({
      uppercase:   result.uppercase,
      matches:     result.matches,
      warnings:    result.warnings,
      remediation: result.uppercase
        ? "Theme forces paragraph text to UPPERCASE. Open WP → Customizer → Typography → Body → Text Transform and set it to 'None', then re-publish."
        : null,
    })
  } catch (err) {
    // Final safety net — assertPublicHost may throw for unusual host setups.
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return shape({ warnings: [`Theme check failed: ${msg}`] })
  }
}
