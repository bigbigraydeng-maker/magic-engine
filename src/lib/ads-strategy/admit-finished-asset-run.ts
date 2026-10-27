/**
 * 验收路由用的接线：读工单、上传、写素材池。纯规则在 admit-finished-asset.ts。
 * 一次请求里做完，失败就不归档，所以没有另开异步任务。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isAssetOnly } from '@/lib/factory/deliverable'
import { validateRenderPath } from '@/lib/factory/worker-guard'
import { uploadVideoToMeta } from '@/lib/meta/asset-upload'
import { getRegisteredAccountIds } from '@/lib/meta/campaign-ownership'
import { getClientAdAccounts } from '@/lib/meta/client-ad-accounts'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import {
  loadAdStrategyConfigWithSource,
  loadConfigVersion,
  writeConfigCas,
  type CreativePoolEntry,
} from './config'
import {
  ACCOUNT_UPLOAD_SOURCE,
  admitFinishedAsset,
  creativePoolUploadEnabled,
  type AdmitOutcome,
  type AdmitWorkOrder,
} from './admit-finished-asset'

export type { AdmitOutcome }

function contentFactoryPublicBase(): string {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  if (!supabaseUrl.startsWith('https://')) return ''
  return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/content-factory`
}

function toOrder(row: Record<string, unknown>): AdmitWorkOrder | null {
  const id = row.id
  const clientId = row.client_id
  if (typeof id !== 'string' || typeof clientId !== 'string') return null
  const output = (row.output ?? {}) as Record<string, unknown>
  const rawPath = typeof output.video_path === 'string' ? output.video_path : null
  return {
    id,
    clientId,
    status: typeof row.status === 'string' ? row.status : '',
    assetOnly: isAssetOnly(row.brief),
    videoPath: rawPath ? validateRenderPath(rawPath, clientId, id) : null,
    reviewRef: (row.review_ref ?? {}) as Record<string, unknown>,
  }
}

async function loadOrder(
  supabase: SupabaseClient,
  workOrderId: string,
): Promise<{ ok: true; order: AdmitWorkOrder } | { ok: false; status: number; error: string }> {
  const { data, error } = await supabase
    .from('content_work_orders')
    .select('id, client_id, status, brief, output, review_ref')
    .eq('id', workOrderId)
    .maybeSingle()
  if (error) return { ok: false, status: 500, error: error.message }
  if (!data) return { ok: false, status: 404, error: 'work order not found' }
  const order = toOrder(data as Record<string, unknown>)
  if (!order) return { ok: false, status: 500, error: '工单缺客户或编号，没有上传。' }
  return { ok: true, order }
}

async function loadAccounts(clientId: string) {
  const registered = await getRegisteredAccountIds(clientId)
  if (registered.error) return { ok: false as const, status: 503, error: registered.error }
  const accounts = await getClientAdAccounts(clientId)
  return {
    ok: true as const,
    accounts: accounts.map((account) => ({ adAccountId: account.adAccountId, isPrimary: account.isPrimary })),
    registeredIds: registered.ids,
  }
}

async function rememberVideo(
  supabase: SupabaseClient,
  order: AdmitWorkOrder,
  videoId: string,
  accountId: string,
) {
  const { data, error } = await supabase
    .from('content_work_orders')
    .update({
      review_ref: {
        ...order.reviewRef,
        meta_video_id: videoId,
        meta_video_source: ACCOUNT_UPLOAD_SOURCE,
        meta_video_account: accountId,
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', order.id)
    .eq('status', 'in_review')
    .select('id')
  if (error) return { ok: false as const, error: error.message }
  if (!data || data.length === 0) return { ok: false as const, error: '工单已经不在待审，没有记下视频编号。' }
  return { ok: true as const }
}

async function loadPool(clientId: string) {
  const version = await loadConfigVersion(clientId)
  if (!version.ok) return { ok: false as const, error: version.error }
  const loaded = await loadAdStrategyConfigWithSource(clientId)
  if (loaded.source === 'fallback') return { ok: false as const, error: loaded.error ?? '读设置失败' }
  return { ok: true as const, pool: loaded.config.creative_pool, version: version.version }
}

async function writePool(clientId: string, pool: CreativePoolEntry[], version: { exists: boolean; updatedAt: string | null }) {
  const written = await writeConfigCas(clientId, { creative_pool: pool }, version)
  if (written.ok) return { ok: true as const }
  return { ok: false as const, conflict: written.kind === 'conflict', error: written.message }
}

export async function admitAssetBeforeAccept(
  supabase: SupabaseClient,
  workOrderId: string,
): Promise<AdmitOutcome> {
  const loaded = await loadOrder(supabase, workOrderId)
  if (!loaded.ok) return loaded
  const order = loaded.order
  return admitFinishedAsset(order, {
    uploadEnabled: creativePoolUploadEnabled(),
    publicBase: contentFactoryPublicBase(),
    accounts: () => loadAccounts(order.clientId),
    token: () => getMetaTokenForClient(order.clientId),
    upload: async (accountId, fileUrl, token, title) => {
      const uploaded = await uploadVideoToMeta(accountId, fileUrl, token, title)
      if (!uploaded.ok) return uploaded
      if (uploaded.asset.kind !== 'video') return { ok: false, error: '上传回执不是视频。' }
      return { ok: true, videoId: uploaded.asset.videoId }
    },
    remember: (videoId, accountId) => rememberVideo(supabase, order, videoId, accountId),
    loadPool: () => loadPool(order.clientId),
    writePool: (pool, version) => writePool(order.clientId, pool, version),
  })
}
