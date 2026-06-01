import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { requireSession } from '@/lib/auth/require-session'
import { supabaseAdmin } from '@/lib/supabase'
import { MTC_PACKAGES } from '@/lib/mtc/types'

const PRICE_IDS: Record<string, string | undefined> = {
  starter_99: process.env.STRIPE_PRICE_ID_STARTER,
  growth_249: process.env.STRIPE_PRICE_ID_GROWTH,
  scale_599: process.env.STRIPE_PRICE_ID_SCALE,
}

// POST /api/mtc/checkout
// Body: { clientId, packageKey }
// Returns: { checkoutUrl }
export async function POST(request: NextRequest) {
  const session = await requireSession()
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: session.status })

  const body = await request.json().catch(() => null)
  const { clientId, packageKey } = body ?? {}

  if (!clientId || !packageKey) {
    return NextResponse.json({ error: 'clientId and packageKey required' }, { status: 400 })
  }

  // Verify caller owns this client
  const { data: portalUser } = await supabaseAdmin
    .from('client_portal_users')
    .select('client_id')
    .eq('email', (session.user.email ?? '').toLowerCase())
    .eq('client_id', clientId)
    .single()

  if (!portalUser) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const pkg = MTC_PACKAGES.find((p) => p.key === packageKey)
  if (!pkg) {
    return NextResponse.json({ error: `Unknown package: ${packageKey}` }, { status: 400 })
  }

  const priceId = PRICE_IDS[packageKey]
  if (!priceId) {
    return NextResponse.json(
      { error: `Stripe price not configured for ${packageKey}` },
      { status: 503 },
    )
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2026-05-27.dahlia' })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://magicengine.com.au'

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: {
      client_id: clientId,
      price_id: priceId,
      package_key: packageKey,
    },
    success_url: `${appUrl}/dashboard/clients/${clientId}/wallet?success=1&package=${packageKey}`,
    cancel_url: `${appUrl}/dashboard/clients/${clientId}/wallet?cancelled=1`,
    customer_email: session.user.email ?? undefined,
  })

  return NextResponse.json({ checkoutUrl: checkoutSession.url })
}
