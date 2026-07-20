/**
 * Admin auth guard for Voice Agent API routes. Reuses ME's existing session +
 * whitelist model (service-role backend, admin JWT gate) — NOT Supabase end-user
 * RLS (魏征 #2). Returns the admin email or a NextResponse to short-circuit.
 */
import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getUserPermissions } from '@/lib/auth/whitelist'

export async function requireVoiceAdmin(): Promise<{ email: string } | NextResponse> {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const email = user.email.toLowerCase()
  const perms = getUserPermissions(email)
  if (perms?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return { email }
}
