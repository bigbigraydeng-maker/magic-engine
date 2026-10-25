/**
 * GET/PATCH /api/clients/[id]/youtube-channel
 *
 * The YouTube channel a client publishes to is client configuration
 * (clients.youtube_channel_id). Only internal admins may change it: it decides
 * which channel the OAuth flow will accept and where videos are uploaded.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { supabaseAdmin } from '@/lib/supabase'
import { getClientChannelId } from '@/lib/youtube-publish/store'
import { isValidChannelId } from '@/lib/youtube-publish/oauth'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  const admin = await requireGlobalAdmin()
  return NextResponse.json({ channel_id: await getClientChannelId(params.id), can_edit: admin.ok })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireGlobalAdmin()
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status })
  const body = (await req.json().catch(() => null)) as { channel_id?: unknown } | null
  const raw = body?.channel_id
  const value = typeof raw === 'string' ? raw.trim() : raw
  if (value !== null && value !== '' && !isValidChannelId(value as string)) {
    return NextResponse.json({ error: 'channel_id must look like UC + 22 characters' }, { status: 400 })
  }
  const { error } = await supabaseAdmin
    .from('clients')
    .update({ youtube_channel_id: value === '' ? null : value })
    .eq('id', params.id)
  if (error) return NextResponse.json({ error: 'Failed to save channel id' }, { status: 500 })
  return NextResponse.json({ success: true, channel_id: value === '' ? null : value })
}
