import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase'
import type { PackageKey } from '@/lib/mtc/types'

const PACKAGE_MTC: Record<string, { packageKey: PackageKey; mtcAmount: number; amountNzd: number }> = {
  [process.env.STRIPE_PRICE_ID_STARTER ?? 'price_starter']: {
    packageKey: 'starter_29',
    mtcAmount: 300,
    amountNzd: 29,
  },
  [process.env.STRIPE_PRICE_ID_GROWTH ?? 'price_growth']: {
    packageKey: 'growth_79',
    mtcAmount: 1200,
    amountNzd: 79,
  },
  [process.env.STRIPE_PRICE_ID_SCALE ?? 'price_scale']: {
    packageKey: 'scale_199',
    mtcAmount: 3500,
    amountNzd: 199,
  },
}

export async function POST(request: NextRequest) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2025-05-28.basil' })
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!

  const body = await request.text()
  const sig = request.headers.get('stripe-signature')

  if (!sig) return NextResponse.json({ error: 'No signature' }, { status: 400 })

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // Idempotency guard: skip already-processed events
  const { data: existing } = await supabaseAdmin
    .from('stripe_events_log')
    .select('stripe_event_id')
    .eq('stripe_event_id', event.id)
    .single()

  if (existing) {
    return NextResponse.json({ received: true, status: 'skipped' })
  }

  let processStatus: 'processed' | 'failed' = 'processed'
  let errorMessage: string | null = null

  try {
    if (event.type === 'checkout.session.completed') {
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session)
    }
    // Other event types ignored for now
  } catch (err) {
    processStatus = 'failed'
    errorMessage = err instanceof Error ? err.message : String(err)
    console.error('[stripe/webhook] processing error:', err)
  }

  await supabaseAdmin.from('stripe_events_log').insert({
    stripe_event_id: event.id,
    event_type: event.type,
    status: processStatus,
    error_message: errorMessage,
  })

  if (processStatus === 'failed') {
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const clientId = session.metadata?.client_id
  if (!clientId) throw new Error('Missing client_id in session metadata')

  const priceId = session.metadata?.price_id
  const pkg = priceId ? PACKAGE_MTC[priceId] : null
  if (!pkg) throw new Error(`Unknown price_id: ${priceId}`)

  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id ?? null

  const purchasedAt = new Date()
  const expiresAt = new Date(purchasedAt)
  expiresAt.setFullYear(expiresAt.getFullYear() + 1)

  const { error } = await supabaseAdmin.from('mtc_purchases').insert({
    client_id: clientId,
    stripe_payment_intent_id: paymentIntentId,
    package_key: pkg.packageKey,
    amount_nzd: pkg.amountNzd,
    mtc_amount: pkg.mtcAmount,
    mtc_remaining: pkg.mtcAmount,
    purchased_at: purchasedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    status: 'completed',
  })

  if (error) throw new Error(`Failed to insert mtc_purchase: ${error.message}`)

  // Update stripe_customer_id on the client record if provided
  if (session.customer && typeof session.customer === 'string') {
    await supabaseAdmin
      .from('clients')
      .update({ stripe_customer_id: session.customer })
      .eq('id', clientId)
  }
}
