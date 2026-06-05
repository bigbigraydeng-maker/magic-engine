/**
 * GET  /api/admin/users?type=portal|fde|dashboard|all
 * POST /api/admin/users
 *
 * Admin-only. Lists and creates client_portal_users entries.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin } from '@/lib/auth/require-admin'
import { getUserPermissions } from '@/lib/auth/whitelist'
import { ACCESS_TYPE_VALUES, type AccessType } from '@/lib/auth/access-types'

// Reuse the canonical list of access_type values + 'all' filter sentinel
// used by the FDE user-management UI.
const ALLOWED_TYPES = [...ACCESS_TYPE_VALUES, 'all'] as const

export async function GET(req: NextRequest): Promise<NextResponse> {
  const guard = await guardAdmin()
  if (guard) return guard

  const type = req.nextUrl.searchParams.get('type') ?? 'all'
  if (!ALLOWED_TYPES.includes(type as typeof ALLOWED_TYPES[number])) {
    return NextResponse.json({ error: 'Invalid type param.' }, { status: 400 })
  }

  let query = supabaseAdmin
    .from('client_portal_users')
    .select('id, email, client_id, access_type, display_name, created_at, created_by_email, clients(name)')
    .order('created_at', { ascending: false })

  if (type !== 'all') {
    query = query.eq('access_type', type)
  }

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ users: data ?? [] })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = await guardAdmin()
  if (guard) return guard

  let email: string, client_id: string, access_type: AccessType, display_name: string
  try {
    const body = (await req.json()) as {
      email?: unknown
      client_id?: unknown
      access_type?: unknown
      display_name?: unknown
    }

    if (!body.email || typeof body.email !== 'string') {
      return NextResponse.json({ error: 'email is required.' }, { status: 400 })
    }
    if (!body.client_id || typeof body.client_id !== 'string') {
      return NextResponse.json({ error: 'client_id is required.' }, { status: 400 })
    }
    if (!body.access_type || !ACCESS_TYPE_VALUES.includes(body.access_type as AccessType)) {
      return NextResponse.json({ error: `access_type must be one of: ${ACCESS_TYPE_VALUES.join(' | ')}.` }, { status: 400 })
    }

    email        = body.email.trim().toLowerCase()
    client_id    = body.client_id as string
    access_type  = body.access_type as AccessType
    display_name = typeof body.display_name === 'string' ? body.display_name.trim() : ''
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  // Refuse to create an entry for a super-admin email (they don't need DB rows)
  const perms = getUserPermissions(email)
  if (perms?.role === 'admin') {
    return NextResponse.json({ error: 'Super-admin emails do not need portal/FDE rows.' }, { status: 400 })
  }

  // Verify client exists
  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('id', client_id)
    .maybeSingle()

  if (!client) {
    return NextResponse.json({ error: 'client_id does not exist.' }, { status: 400 })
  }

  // Read caller email for audit
  const { data: { user: caller } } = await supabaseAdmin.auth.getUser()

  const { data, error } = await supabaseAdmin
    .from('client_portal_users')
    .insert({
      email,
      client_id,
      access_type,
      display_name,
      created_by_email: caller?.email ?? null,
    })
    .select('id, email, client_id, access_type, display_name, created_at')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ user: data }, { status: 201 })
}
