// Supabase adapter for the material dual review. Pool writes go through the existing config lock.

import type { SupabaseClient } from '@supabase/supabase-js'
import { admitAssetBeforeAccept } from '@/lib/ads-strategy/admit-finished-asset-run'
import { loadAdStrategyConfigWithSource, loadConfigVersion, writeConfigCas } from '@/lib/ads-strategy/config'
import type { AssetOrder, DualReviewIo } from './asset-dual-review-run'
import { readOfficialPage } from './asset-dual-review-page'
import { remotionMusicClearance } from './remotion-music-options.mjs'
import { websiteHosts } from './topic-alignment'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function loadOrder(supabase: SupabaseClient, id: string): Promise<AssetOrder | null | 'unreadable'> {
  const { data, error } = await supabase
    .from('content_work_orders')
    .select('id, client_id, status, brief, output, review_ref')
    .eq('id', id)
    .maybeSingle()
  if (error) return 'unreadable'
  if (!data || !isRecord(data)) return null
  if (typeof data.client_id !== 'string' || typeof data.status !== 'string') return 'unreadable'
  return { id, clientId: data.client_id, status: data.status, brief: data.brief, output: data.output, reviewRef: data.review_ref }
}

async function loadHosts(supabase: SupabaseClient, clientId: string): Promise<string[] | null> {
  const client = await supabase.from('clients').select('domain').eq('id', clientId).maybeSingle()
  if (client.error) return null
  const brief = await supabase
    .from('master_briefs')
    .select('website')
    .eq('client_id', clientId)
    .or('status.eq.active,is_active.eq.true')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (brief.error) return null
  const domain = isRecord(client.data) && typeof client.data.domain === 'string' ? client.data.domain : null
  const website = isRecord(brief.data) && typeof brief.data.website === 'string' ? brief.data.website : null
  return websiteHosts(domain, website)
}

async function writeOrder(
  supabase: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
  expectStatus: string,
): Promise<'ok' | 'conflict' | 'error'> {
  const { data, error } = await supabase
    .from('content_work_orders')
    .update(patch)
    .eq('id', id)
    .eq('status', expectStatus)
    .select('id')
  if (error) return 'error'
  if (!data || data.length !== 1) return 'conflict'
  return 'ok'
}

async function loadPool(clientId: string): Promise<Awaited<ReturnType<DualReviewIo['loadPool']>>> {
  const version = await loadConfigVersion(clientId)
  if (!version.ok) return null
  const loaded = await loadAdStrategyConfigWithSource(clientId)
  if (loaded.source === 'fallback') return null
  return { version: version.version, pool: loaded.config.creative_pool }
}

function musicOf(brief: unknown) {
  const remotion = isRecord(brief) ? brief.remotion : null
  return remotionMusicClearance(remotion)
}

export function supabaseDualReviewIo(supabase: SupabaseClient): DualReviewIo {
  return {
    loadOrder: (id) => loadOrder(supabase, id),
    loadHosts: (clientId) => loadHosts(supabase, clientId),
    readPage: (url, hosts) => readOfficialPage(url, hosts),
    musicOf,
    loadPool,
    writePool: async (clientId, pool, version) => {
      const wrote = await writeConfigCas(clientId, { creative_pool: pool }, version)
      if (wrote.ok) return 'ok'
      return wrote.kind === 'conflict' ? 'conflict' : 'error'
    },
    writeOrder: (id, patch, expectStatus) => writeOrder(supabase, id, patch, expectStatus),
    now: () => new Date().toISOString(),
    attachVideo: async (order) => {
      const uploaded = await admitAssetBeforeAccept(supabase, order.id)
      if (!uploaded.ok) return { ok: false as const, error: uploaded.error }
      if (uploaded.action !== 'uploaded') return { ok: true as const, videoId: null, accountId: null }
      return { ok: true as const, videoId: uploaded.videoId, accountId: uploaded.accountId }
    },
  }
}
