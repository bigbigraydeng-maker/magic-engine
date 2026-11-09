import type { SupabaseClient } from '@supabase/supabase-js'
import { ACCOUNT_UPLOAD_SOURCE, accountIsRegistered, factoryPublicVideoUrl } from '@/lib/ads-strategy/admit-finished-asset'
import type { VideoUploadExec } from '@/lib/ads-strategy/video-upload-card'
import { validateRenderPath } from '@/lib/factory/worker-guard'
import { readVideoInAdAccount, uploadVideoToMeta } from '@/lib/meta/asset-upload'
import { getRegisteredAccountIds } from '@/lib/meta/campaign-ownership'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
function publicBase(): string {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  if (!supabaseUrl.startsWith('https://')) return ''
  return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/content-factory`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function currentFileUrl(sb: SupabaseClient, clientId: string, workOrderId: string): Promise<string | null> {
  const { data, error } = await sb.from('content_work_orders')
    .select('output')
    .eq('id', workOrderId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (error || !isRecord(data) || !isRecord(data.output)) return null
  const raw = typeof data.output.video_path === 'string' ? data.output.video_path : null
  const path = raw ? validateRenderPath(raw, clientId, workOrderId) : null
  return factoryPublicVideoUrl(path, publicBase())
}

async function accountRegistered(clientId: string, accountId: string): Promise<boolean> {
  const registered = await getRegisteredAccountIds(clientId)
  if (registered.error) return false
  return accountIsRegistered(accountId, registered.ids)
}

async function sendVideo(accountId: string, fileUrl: string, token: string) {
  const uploaded = await uploadVideoToMeta(accountId, fileUrl, token, '成片')
  if (!uploaded.ok) return { ok: false as const, error: uploaded.error }
  if (uploaded.asset.kind !== 'video') return { ok: false as const, error: '上传回执不是视频。' }
  return { ok: true as const, videoId: uploaded.asset.videoId }
}

async function remember(sb: SupabaseClient, clientId: string, workOrderId: string, videoId: string, accountId: string) {
  const loaded = await sb.from('content_work_orders')
    .select('review_ref, status')
    .eq('id', workOrderId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (loaded.error || !isRecord(loaded.data) || loaded.data.status !== 'in_review') {
    return { ok: false as const, error: '工单已经不在待审，没有记下视频编号。' }
  }
  const prior = isRecord(loaded.data.review_ref) ? loaded.data.review_ref : {}
  const wrote = await sb.from('content_work_orders').update({
    review_ref: {
      ...prior,
      meta_video_id: videoId,
      meta_video_source: ACCOUNT_UPLOAD_SOURCE,
      meta_video_account: accountId,
    },
    updated_at: new Date().toISOString(),
  }).eq('id', workOrderId).eq('client_id', clientId).eq('status', 'in_review').select('id')
  if (wrote.error || !wrote.data || (wrote.data as unknown[]).length === 0) {
    return { ok: false as const, error: '工单没有记下视频编号。' }
  }
  return { ok: true as const }
}

export function makeVideoUploadExec(sb: SupabaseClient, clientId: string): VideoUploadExec {
  return {
    currentFileUrl: (workOrderId) => currentFileUrl(sb, clientId, workOrderId),
    accountRegistered: (accountId) => accountRegistered(clientId, accountId),
    token: () => getMetaTokenForClient(clientId),
    upload: sendVideo,
    readBack: (accountId, videoId, token) => readVideoInAdAccount(accountId, videoId, token),
    remember: (workOrderId, videoId, accountId) => remember(sb, clientId, workOrderId, videoId, accountId),
  }
}
