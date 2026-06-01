import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

type TrainingLeadPayload = {
  ctaKey?: string
  destination?: 'contact' | 'email'
  href?: string
  pagePath?: string
  referrer?: string | null
}

const VALID_DESTINATIONS = new Set(['contact', 'email'])

export async function POST(request: NextRequest) {
  let body: TrainingLeadPayload

  try {
    body = (await request.json()) as TrainingLeadPayload
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const ctaKey = body.ctaKey?.trim()
  const destination = body.destination?.trim()
  const href = body.href?.trim()
  const pagePath = body.pagePath?.trim() || '/training'

  if (!ctaKey || !destination || !href || !VALID_DESTINATIONS.has(destination)) {
    return NextResponse.json({ error: 'Missing tracking fields.' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ ok: true, tracked: false })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const { error } = await supabase.from('website_lead_events').insert({
    page_path: pagePath,
    cta_key: ctaKey,
    destination,
    target_href: href,
    source: 'training',
    referrer: body.referrer?.trim() || null,
    metadata: {
      user_agent: request.headers.get('user-agent'),
      origin: request.headers.get('origin'),
    },
  })

  if (error) {
    console.error('[training/leads] insert failed:', error.message)
  }

  return NextResponse.json({ ok: true })
}
