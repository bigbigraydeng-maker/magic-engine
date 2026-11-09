/**
 * 个人 IP 概览读数 —— 只查已有表，不拉新渠道。
 * 查询模式复用 SocialContentAdapter、weekly-report、GA4 快照、张骞发现。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { SOCIAL_METRIC_KEY } from '@/lib/flywheel/vocabulary'
import type { DiscoveredSocial } from '@/lib/zhangqian/types'
import {
  buildPersonalIpTiles,
  type PersonalIpRawSnapshot,
  type PersonalIpTile,
} from './personal-ip-overview'

const WINDOW_DAYS = 28

function windowStartIso(now = new Date()): string {
  return new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString()
}

async function latestFlywheelMetric(
  supabase: SupabaseClient,
  clientId: string,
  metricKey: string,
): Promise<number | null> {
  const { data, error } = await supabase
    .from('flywheel_metrics')
    .select('metric_value')
    .eq('client_id', clientId)
    .eq('metric_key', metricKey)
    .order('measured_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ metric_value: number | null }>()

  if (error || data == null) return null
  const v = data.metric_value
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

async function countScheduledPublishedPosts(
  supabase: SupabaseClient,
  clientId: string,
  sinceIso: string,
): Promise<number | null> {
  const { count, error } = await supabase
    .from('content_posts')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('status', 'published')
    .not('scheduled_at', 'is', null)
    .gte('published_at', sinceIso)

  if (error) return null
  return count ?? 0
}

async function readGa4Pageviews(
  supabase: SupabaseClient,
  clientId: string,
): Promise<number | null> {
  const { data, error } = await supabase
    .from('ga4_traffic_snapshots')
    .select('total_pageviews')
    .eq('client_id', clientId)
    .order('period_start', { ascending: false })
    .limit(1)
    .maybeSingle<{ total_pageviews: number | null }>()

  if (error || !data) return null
  const v = data.total_pageviews
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function socialFollowersFromDiscovery(payload: unknown): {
  facebook: number | null
  tiktok: number | null
} {
  if (!payload || typeof payload !== 'object') {
    return { facebook: null, tiktok: null }
  }
  const profiles = (payload as { social_profiles?: unknown }).social_profiles
  if (!Array.isArray(profiles)) return { facebook: null, tiktok: null }

  let facebook: number | null = null
  let tiktok: number | null = null
  for (const row of profiles) {
    if (!row || typeof row !== 'object') continue
    const p = row as DiscoveredSocial
    const n = p.followers_count
    if (typeof n !== 'number' || !Number.isFinite(n)) continue
    if (p.platform === 'facebook' && facebook == null) facebook = n
    if (p.platform === 'tiktok' && tiktok == null) tiktok = n
  }
  return { facebook, tiktok }
}

async function readDiscoveryFollowers(
  supabase: SupabaseClient,
  clientId: string,
): Promise<{ facebook: number | null; tiktok: number | null }> {
  const { data, error } = await supabase
    .from('client_discovery')
    .select('payload')
    .eq('client_id', clientId)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ payload: unknown }>()

  if (error || !data) return { facebook: null, tiktok: null }
  return socialFollowersFromDiscovery(data.payload)
}

async function countInboundTouchpoints(
  supabase: SupabaseClient,
  clientId: string,
  sinceIso: string,
): Promise<number | null> {
  const { count, error } = await supabase
    .from('contact_touchpoints')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('direction', 'inbound')
    .in('channel', ['messenger', 'whatsapp', 'web_form', 'phone', 'email'])
    .gte('occurred_at', sinceIso)

  if (error) return null
  return count ?? 0
}

async function countLeadsRows(
  supabase: SupabaseClient,
  clientId: string,
  sinceIso: string,
): Promise<number | null> {
  const { count, error } = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .gte('created_at', sinceIso)

  if (error) return null
  return count ?? 0
}

export async function loadPersonalIpOverviewSnapshot(
  supabase: SupabaseClient,
  clientId: string,
  now = new Date(),
): Promise<PersonalIpRawSnapshot> {
  const sinceIso = windowStartIso(now)

  const [
    postsOnSchedule,
    tiktokFlywheel,
    pageviews,
    discoveryFollowers,
    touchpoints,
    leadsCount,
  ] = await Promise.all([
    countScheduledPublishedPosts(supabase, clientId, sinceIso),
    latestFlywheelMetric(supabase, clientId, SOCIAL_METRIC_KEY.TIKTOK_FOLLOWERS),
    readGa4Pageviews(supabase, clientId),
    readDiscoveryFollowers(supabase, clientId),
    countInboundTouchpoints(supabase, clientId, sinceIso),
    countLeadsRows(supabase, clientId, sinceIso),
  ])

  const tiktokFollowers = tiktokFlywheel ?? discoveryFollowers.tiktok

  return {
    postsOnSchedule,
    facebookFollowers: discoveryFollowers.facebook,
    tiktokFollowers,
    websitePageviews: pageviews,
    dmsAndEnquiries: touchpoints,
    leads: leadsCount,
  }
}

export async function loadPersonalIpOverviewTiles(
  supabase: SupabaseClient,
  clientId: string,
): Promise<PersonalIpTile[]> {
  const raw = await loadPersonalIpOverviewSnapshot(supabase, clientId)
  return buildPersonalIpTiles(raw)
}

export { socialFollowersFromDiscovery }
