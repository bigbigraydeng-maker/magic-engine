/**
 * PATCH /api/clients/[id]/domain
 *
 * Self-serve onboarding Step 2: let a client set their OWN website domain.
 *
 * Deliberately a narrow route, NOT the main clients PATCH (which is admin-only
 * and can also write billing fields plan_tier / monthly_mtc_cap). This route
 * writes ONLY `domain` under requireOnboardingClientAccess, so a self_serve
 * client can complete onboarding without ever being able to touch billing.
 *
 * Body: { domain: string }  — a URL or bare host; normalised to a bare host.
 *
 * AD-SEC-4 (2026-09-17): the domain also picks which staff-provisioned Meta token
 * (META_SYSTEM_USER_TOKEN_<DOMAIN_KEY>) the client runs on. A client member could
 * otherwise type in a domain that has such a token — another client's, or one
 * whose client moved away — and run on it. Keys WITH a configured token are
 * therefore settable only by internal staff; every other domain is unaffected.
 * (Self-serve rows never own a key either — see src/lib/meta/token-selection.ts.)
 * Reference: Phase B $990 self-serve onboarding wizard spec (Step 2).
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireOnboardingClientAccess } from '@/lib/auth/client-access'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { domainToEnvKey } from '@/lib/meta/token-selection'

/** Strip protocol, path, query, and leading www./trailing slash → bare host. */
function normaliseDomain(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  // Take the host portion whether or not a protocol was supplied.
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  let host: string
  try {
    host = new URL(withScheme).hostname
  } catch {
    return null
  }
  host = host.replace(/^www\./i, '').toLowerCase()
  // Must look like a domain (at least one dot, no spaces).
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) return null
  return host
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const access = await requireOnboardingClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: { domain?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (typeof body.domain !== 'string') {
    return NextResponse.json({ error: 'domain must be a string' }, { status: 400 })
  }

  const domain = normaliseDomain(body.domain)
  if (!domain) {
    return NextResponse.json({ error: 'Enter a valid website address (e.g. yourbusiness.co.nz)' }, { status: 400 })
  }

  if (process.env[`META_SYSTEM_USER_TOKEN_${domainToEnvKey(domain)}`]) {
    const staff = await requireGlobalAdmin()
    if (!staff.ok) {
      return NextResponse.json(
        {
          error: 'This website address needs to be confirmed by the Magic Lab team. Please contact us and we will set it for you.',
          reason: 'domain_reserved',
        },
        { status: 409 },
      )
    }
  }

  const { data, error } = await supabaseAdmin
    .from('clients')
    .update({ domain })
    .eq('id', params.id)
    .select('id, domain')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ client: data })
}
