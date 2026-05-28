/**
 * POST /api/onboard/self
 *
 * P20.0.2: Self-service prospect onboarding.
 *
 * Called when a prospect clicks "Enter My Workspace" on the /prospect report page.
 * Idempotent — returns existing client_id if already onboarded.
 *
 * Flow:
 *   1. Verify session (user must be logged in via magic link from /discover)
 *   2. Find their latest completed public_scan_jobs record by email
 *   3. If already onboarded → return { client_id } immediately
 *   4. Create clients row (name + domain from discovery report)
 *   5. Copy scan result → client_discovery (so Portal can read it)
 *   6. Insert client_portal_users (access_type = 'portal')
 *   7. Bind public_scan_jobs.client_id
 *   8. Return { client_id }
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireSession } from '@/lib/auth/require-session'
import type { DiscoveryReport } from '@/lib/zhangqian/types'

export async function POST(_req: NextRequest): Promise<NextResponse> {
  const session = await requireSession()
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status })
  }

  const email = (session.user.email ?? '').toLowerCase().trim()

  // 1. Find latest completed scan for this email
  const { data: job } = await supabaseAdmin
    .from('public_scan_jobs')
    .select('id, domain, name, result, client_id')
    .eq('email', email)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!job?.result) {
    return NextResponse.json({ error: 'No completed scan found for this account.' }, { status: 404 })
  }

  // 2. Already onboarded — return existing client_id
  if (job.client_id) {
    return NextResponse.json({ client_id: job.client_id, already_onboarded: true })
  }

  // 3. Check via client_portal_users in case of partial prior run
  const { data: existingAccess } = await supabaseAdmin
    .from('client_portal_users')
    .select('client_id')
    .eq('email', email)
    .limit(1)
    .maybeSingle()

  if (existingAccess?.client_id) {
    return NextResponse.json({ client_id: existingAccess.client_id, already_onboarded: true })
  }

  // 4. Create client record from discovery report business info
  const report = job.result as unknown as DiscoveryReport
  const clientName = report.business?.name ?? job.domain
  const domain = job.domain

  const { data: client, error: clientErr } = await supabaseAdmin
    .from('clients')
    .insert({ name: clientName, domain, plan_tier: 'starter' })
    .select('id')
    .single<{ id: string }>()

  if (clientErr || !client) {
    console.error('[onboard/self] create client failed', clientErr)
    return NextResponse.json({ error: 'Failed to create workspace.' }, { status: 500 })
  }

  const clientId = client.id

  // 5. Copy scan result into client_discovery
  await supabaseAdmin
    .from('client_discovery')
    .insert({
      client_id: clientId,
      domain,
      payload: job.result,
      cost_usd: 0,
      model: 'public-scan',
      tool_calls: 0,
    })
    .then(() => undefined, (err) => console.error('[onboard/self] client_discovery insert', err))

  // 6. Grant portal access
  await supabaseAdmin
    .from('client_portal_users')
    .insert({
      email,
      client_id: clientId,
      access_type: 'portal',
      display_name: job.name ?? null,
    })
    .then(() => undefined, (err) => console.error('[onboard/self] portal_users insert', err))

  // 7. Bind scan job to the new client
  await supabaseAdmin
    .from('public_scan_jobs')
    .update({ client_id: clientId })
    .eq('id', job.id)
    .then(() => undefined, (err) => console.error('[onboard/self] scan job bind', err))

  return NextResponse.json({ client_id: clientId }, { status: 201 })
}
