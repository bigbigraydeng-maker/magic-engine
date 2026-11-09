/**
 * GET/POST /api/public-scan/keyword-gap — internal DataForSEO keyword-gap research.
 *
 * Despite the `public-scan` path this is NOT a public endpoint: every call spends
 * DataForSEO Labs credits on an arbitrary domain, and nothing in the product calls it
 * (2026-09-27 audit: no UI, no cron, no sibling site). Global admins only; scoped
 * demo admins are rejected because the spend is platform-level, not per-client.
 */
import { NextRequest, NextResponse } from 'next/server'
import { guardGlobalAdmin } from '@/lib/auth/require-admin'
import { getPublicKeywordGapReport, type PublicGapMarket } from '@/lib/seo-gap/public-gap'

const DEFAULT_DOMAIN = 'magicengine.com.au'
const DEFAULT_MARKETS: PublicGapMarket[] = ['au', 'nz']

function parseMarkets(raw: string | null): PublicGapMarket[] {
  if (!raw) return DEFAULT_MARKETS

  const markets = raw
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter((value): value is PublicGapMarket => value === 'au' || value === 'nz')

  return markets.length > 0 ? Array.from(new Set(markets)) : DEFAULT_MARKETS
}

function jsonReport(body: unknown) {
  return NextResponse.json(body, {
    headers: {
      // Auth-gated response: a shared cache must never replay it to anonymous callers.
      'Cache-Control': 'private, no-store',
    },
  })
}

export async function GET(req: NextRequest) {
  const guard = await guardGlobalAdmin()
  if (guard) return guard

  const url = new URL(req.url)
  const domain = url.searchParams.get('domain')?.trim() || DEFAULT_DOMAIN
  const markets = parseMarkets(url.searchParams.get('markets'))
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '100') || 100, 10), 500)

  try {
    const report = await getPublicKeywordGapReport(domain, markets, limit)
    return jsonReport({ success: true, ...report })
  } catch (error) {
    console.error('[public-scan keyword-gap GET]', error)
    return NextResponse.json(
      { success: false, error: 'Keyword gap research failed' },
      { status: 502 },
    )
  }
}

export async function POST(req: NextRequest) {
  const guard = await guardGlobalAdmin()
  if (guard) return guard

  try {
    const body = await req.json().catch(() => ({})) as {
      domain?: string
      markets?: string[]
      limit?: number
    }

    const domain = body.domain?.trim() || DEFAULT_DOMAIN
    const markets = Array.isArray(body.markets)
      ? body.markets.filter((value): value is PublicGapMarket => value === 'au' || value === 'nz')
      : DEFAULT_MARKETS
    const resolvedMarkets = markets.length > 0 ? markets : DEFAULT_MARKETS
    const limit = Math.min(Math.max(Number(body.limit ?? 100) || 100, 10), 500)

    const report = await getPublicKeywordGapReport(domain, resolvedMarkets, limit)
    return jsonReport({ success: true, ...report })
  } catch (error) {
    console.error('[public-scan keyword-gap POST]', error)
    return NextResponse.json(
      { success: false, error: 'Keyword gap research failed' },
      { status: 502 },
    )
  }
}
