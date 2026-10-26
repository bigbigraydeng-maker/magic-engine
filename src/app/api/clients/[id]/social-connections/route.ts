import { getInstagramConfig } from '@/lib/instagram-oauth/client'
import { NextRequest, NextResponse } from 'next/server'
import { requireOnboardingClientAccess } from '@/lib/auth/client-access'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { supabaseAdmin } from '@/lib/supabase'
import { projectFactoryConfig } from '@/lib/factory/client-config'
import { listSocialConnectionFacts } from '@/lib/platform-oauth/connection-store'
import { buildSocialConnections, type SocialClientFacts } from '@/lib/platform-oauth/social-onboarding'

export const dynamic = 'force-dynamic'

/** Saved facts only: reading this endpoint never refreshes tokens or calls a provider. */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireOnboardingClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  try {
    const [{ data, error }, connections, admin] = await Promise.all([
      supabaseAdmin.from('clients')
        .select('instagram_handle,facebook_page_url,tiktok_handle,factory_config,youtube_channel_id')
        .eq('id', params.id).maybeSingle(),
      listSocialConnectionFacts(params.id),
      requireGlobalAdmin(),
    ])
    if (error) throw new Error('Client facts unavailable')
    if (!data) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    const config = typeof data.factory_config === 'object' && data.factory_config !== null
      && !Array.isArray(data.factory_config) ? data.factory_config : null
    const target = projectFactoryConfig(config).publish_target
    const client: SocialClientFacts = {
      instagram_handle: data.instagram_handle, facebook_page_url: data.facebook_page_url,
      tiktok_handle: data.tiktok_handle, youtubeChannelId: data.youtube_channel_id,
      facebookPublishPageId: target?.platform === 'facebook' ? target.page_id : null,
    }
    const now = new Date()
    return NextResponse.json({ channels: buildSocialConnections(client, connections, now, Boolean(getInstagramConfig())),
      readAt: now.toISOString(), canManageConfiguration: admin.ok }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch {
    return NextResponse.json({ error: '暂时无法读取社媒授权记录，请稍后重试。' }, { status: 503 })
  }
}
