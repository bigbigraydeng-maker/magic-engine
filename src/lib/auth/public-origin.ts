/**
 * Resolve the public-facing origin for redirects.
 *
 * On Render, request.url / request.nextUrl.origin returns the internal
 * `localhost:PORT` address, NOT the public hostname. This utility centralises
 * the resolution logic used by all auth routes that redirect back to the app.
 *
 * Priority:
 *   1. process.env.APP_URL              (server-only, explicit, recommended)
 *   2. process.env.NEXT_PUBLIC_APP_URL  (legacy fallback)
 *   3. x-forwarded-host / x-forwarded-proto headers (reverse-proxy hint)
 *   4. host header                       (final fallback, may be internal on Render)
 */

import type { NextRequest } from 'next/server'

export function getPublicOrigin(request: NextRequest): string {
  const explicit = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL
  if (explicit) return explicit.replace(/\/$/, '')

  const host = request.headers.get('x-forwarded-host')
    ?? request.headers.get('host')
    ?? 'localhost:3001'
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]
    ?? (host.startsWith('localhost') ? 'http' : 'https')

  return `${proto}://${host}`
}
