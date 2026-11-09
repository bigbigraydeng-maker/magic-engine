/**
 * 三关通过后的接线：读工单。验收规则拒绝新上传，所以这里不会把成片传到广告账户。
 * 纯规则在 admit-finished-asset.ts。不写素材池；入池由三关验收同一条流程完成。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isAssetOnly } from '@/lib/factory/deliverable'
import { validateRenderPath } from '@/lib/factory/worker-guard'
import { createKernel } from '@/lib/kernel'
import { getRegisteredAccountIds } from '@/lib/meta/campaign-ownership'
import { getClientAdAccounts } from '@/lib/meta/client-ad-accounts'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { requestVideoUploadCard } from './video-upload-card'
import {
  ACCOUNT_UPLOAD_SOURCE,
  ASSET_UPLOAD_REFUSED,
  admitFinishedAsset,
  creativePoolUploadEnabled,
  readyToUpload,
  type AdmitDeps,
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

function depsFor(supabase: SupabaseClient, order: AdmitWorkOrder): AdmitDeps {
  return {
    uploadEnabled: creativePoolUploadEnabled(),
    publicBase: contentFactoryPublicBase(),
    accounts: () => loadAccounts(order.clientId),
    token: () => getMetaTokenForClient(order.clientId),
    upload: async () => ({ ok: false, error: ASSET_UPLOAD_REFUSED }),
    remember: (videoId, accountId) => rememberVideo(supabase, order, videoId, accountId),
  }
}

export async function admitAssetBeforeAccept(
  supabase: SupabaseClient,
  workOrderId: string,
): Promise<AdmitOutcome> {
  const loaded = await loadOrder(supabase, workOrderId)
  if (!loaded.ok) return loaded
  return admitFinishedAsset(loaded.order, depsFor(supabase, loaded.order))
}

/** Issue the upload card. Does not copy the file. */
export async function requestFinishedVideoUpload(
  supabase: SupabaseClient,
  workOrderId: string,
): Promise<{ ok: true; runId: string } | { ok: false; status: number; error: string }> {
  const loaded = await loadOrder(supabase, workOrderId)
  if (!loaded.ok) return loaded
  const plan = await readyToUpload(loaded.order, depsFor(supabase, loaded.order))
  if (!plan.ok) return plan
  if (plan.kind !== 'needs_card') return { ok: false, status: 409, error: '这条成片不用再出上传确认卡。' }
  const card = await requestVideoUploadCard({
    kernel: createKernel(supabase),
    clientId: loaded.order.clientId,
    clicker: { kind: 'agent', email: null },
    workOrderId: loaded.order.id,
    accountId: plan.accountId,
    fileUrl: plan.fileUrl,
  })
  return { ok: true, runId: card.runId }
}
