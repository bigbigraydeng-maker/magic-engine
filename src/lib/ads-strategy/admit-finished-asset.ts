/**
 * 仅素材工单验收前：把成片传进该客户主广告账户的视频库，拿回视频编号，
 * 以「按工单引用」写入素材池，状态固定为待批准（candidate）。
 *
 * 不批准、不建广告、不花钱。视频编号不从请求体读（#1090）：只接受这次
 * 上传到「该客户已登记账户」后 Meta 回的编号，或本流程上次写在工单上的同一条回执。
 *
 * 关掉上传：环境变量 ME_CREATIVE_POOL_META_UPLOAD=0。不设置则上传。
 */

import type { ConfigVersion, CreativePoolEntry } from './config'
import { canonicalAccountDigits, toActAccountId } from '@/lib/meta/ad-account-binding'

export const CREATIVE_POOL_UPLOAD_ENV = 'ME_CREATIVE_POOL_META_UPLOAD'
export const ACCOUNT_UPLOAD_SOURCE = 'account_upload'

export function creativePoolUploadEnabled(
  env: NodeJS.ProcessEnv | { ME_CREATIVE_POOL_META_UPLOAD?: string } = process.env,
): boolean {
  return env.ME_CREATIVE_POOL_META_UPLOAD !== '0'
}

export interface AdmitWorkOrder {
  id: string
  clientId: string
  status: string
  assetOnly: boolean
  videoPath: string | null
  reviewRef: Record<string, unknown>
}

export interface AdmitDeps {
  uploadEnabled: boolean
  publicBase: string
  accounts: () => Promise<
    | { ok: true; accounts: { adAccountId: string; isPrimary: boolean }[]; registeredIds: string[] }
    | { ok: false; status: number; error: string }
  >
  token: () => Promise<string | null>
  upload: (
    accountId: string,
    fileUrl: string,
    token: string,
    title: string,
  ) => Promise<{ ok: true; videoId: string } | { ok: false; error: string }>
  remember: (videoId: string, accountId: string) => Promise<{ ok: true } | { ok: false; error: string }>
  loadPool: () => Promise<
    | { ok: true; pool: CreativePoolEntry[]; version: ConfigVersion }
    | { ok: false; error: string }
  >
  writePool: (
    pool: CreativePoolEntry[],
    version: ConfigVersion,
  ) => Promise<{ ok: true } | { ok: false; conflict?: boolean; error: string }>
}

export type AdmitOutcome =
  | { ok: true; action: 'not_material' }
  | { ok: true; action: 'upload_disabled' }
  | { ok: true; action: 'pooled'; videoId: string; status: CreativePoolEntry['status'] }
  | { ok: false; status: number; error: string }

export function pickPrimaryAdAccount(
  accounts: { adAccountId: string; isPrimary: boolean }[],
): { ok: true; adAccountId: string } | { ok: false; error: string } {
  const usable = accounts
    .map((account) => ({ ...account, adAccountId: toActAccountId(account.adAccountId) }))
    .filter((account): account is { adAccountId: string; isPrimary: boolean } => account.adAccountId !== null)
  const primary = usable.filter((account) => account.isPrimary)
  if (primary.length === 1) return { ok: true, adAccountId: primary[0].adAccountId }
  if (usable.length === 1) return { ok: true, adAccountId: usable[0].adAccountId }
  if (usable.length === 0) return { ok: false, error: '这个客户还没配广告账户，成片没有进素材池。' }
  return { ok: false, error: '这个客户有多个广告账户，但没有唯一的主账户，成片没有上传。' }
}

export function accountIsRegistered(accountId: string, registered: readonly string[]): boolean {
  const target = canonicalAccountDigits(accountId)
  if (!target) return false
  return registered.some((id) => canonicalAccountDigits(id) === target)
}

/** 编号必须是这次上传的回执，且上传目标在该客户已登记的账户里。 */
export function acceptUploadedVideoId(input: {
  uploadedToAccountId: string
  registeredAccountIds: readonly string[]
  returnedVideoId: string
}): { ok: true; videoId: string } | { ok: false; error: string } {
  if (!/^\d{1,32}$/.test(input.returnedVideoId)) {
    return { ok: false, error: 'Meta 回的视频编号格式不对，成片没有进素材池。' }
  }
  if (!accountIsRegistered(input.uploadedToAccountId, input.registeredAccountIds)) {
    return { ok: false, error: '上传用的广告账户不是这个客户登记的账户，视频编号已拒绝。' }
  }
  return { ok: true, videoId: input.returnedVideoId }
}

export function reusableVideoId(reviewRef: Record<string, unknown>, accountId: string): string | null {
  if (reviewRef.meta_video_source !== ACCOUNT_UPLOAD_SOURCE) return null
  const id = reviewRef.meta_video_id
  const account = reviewRef.meta_video_account
  if (typeof id !== 'string' || !/^\d{1,32}$/.test(id)) return null
  if (typeof account !== 'string' || !accountIsRegistered(account, [accountId])) return null
  return id
}

export function factoryPublicVideoUrl(videoPath: string | null, publicBase: string): string | null {
  if (!videoPath || videoPath.includes('..') || !videoPath.startsWith('renders/')) return null
  const base = publicBase.replace(/\/$/, '')
  if (!base.startsWith('https://')) return null
  return `${base}/${videoPath}`
}

export function placeWorkOrderCandidate(
  pool: CreativePoolEntry[],
  workOrderId: string,
  videoId: string,
): { pool: CreativePoolEntry[]; changed: boolean; status: CreativePoolEntry['status'] } {
  const byOrder = pool.find((entry) => entry.kind === 'work_order' && entry.ref === workOrderId)
  const holders = pool.filter((entry) => entry.ref === videoId || (entry.alias_refs ?? []).includes(videoId))
  if (byOrder && (byOrder.alias_refs ?? []).includes(videoId)) {
    return { pool, changed: false, status: byOrder.status }
  }
  if (holders.length > 0 && (!byOrder || holders.some((entry) => entry !== byOrder))) {
    return { pool, changed: false, status: holders[0].status }
  }
  if (byOrder) {
    const next = pool.map((entry) => (
      entry === byOrder ? { ...entry, alias_refs: [...(entry.alias_refs ?? []), videoId] } : entry
    ))
    return { pool: next, changed: true, status: byOrder.status }
  }
  const entry: CreativePoolEntry = { kind: 'work_order', ref: workOrderId, status: 'candidate', alias_refs: [videoId] }
  return { pool: [...pool, entry], changed: true, status: 'candidate' }
}

async function resolveTarget(deps: AdmitDeps): Promise<
  { ok: true; accountId: string; registeredIds: string[] } | AdmitOutcome & { ok: false }
> {
  const loaded = await deps.accounts()
  if (!loaded.ok) return loaded
  const picked = pickPrimaryAdAccount(loaded.accounts)
  if (!picked.ok) return { ok: false, status: 424, error: picked.error }
  if (!accountIsRegistered(picked.adAccountId, loaded.registeredIds)) {
    return { ok: false, status: 403, error: '上传用的广告账户不是这个客户登记的账户，视频编号已拒绝。' }
  }
  return { ok: true, accountId: picked.adAccountId, registeredIds: loaded.registeredIds }
}

async function obtainVideoId(
  order: AdmitWorkOrder,
  accountId: string,
  registeredIds: readonly string[],
  deps: AdmitDeps,
): Promise<{ ok: true; videoId: string } | (AdmitOutcome & { ok: false })> {
  const reused = reusableVideoId(order.reviewRef, accountId)
  if (reused) return { ok: true, videoId: reused }
  const fileUrl = factoryPublicVideoUrl(order.videoPath, deps.publicBase)
  if (!fileUrl) return { ok: false, status: 422, error: '成片路径不能给广告账户用，没有上传。' }
  const token = await deps.token()
  if (!token) return { ok: false, status: 424, error: '拿不到这个客户的 Meta 授权，成片没有上传。' }
  const uploaded = await deps.upload(accountId, fileUrl, token, `asset ${order.id}`)
  if (!uploaded.ok) return { ok: false, status: 502, error: `成片传到广告账户失败：${uploaded.error}` }
  const accepted = acceptUploadedVideoId({
    uploadedToAccountId: accountId,
    registeredAccountIds: registeredIds,
    returnedVideoId: uploaded.videoId,
  })
  if (!accepted.ok) return { ok: false, status: 422, error: accepted.error }
  const remembered = await deps.remember(accepted.videoId, accountId)
  if (!remembered.ok) return { ok: false, status: 500, error: remembered.error }
  return { ok: true, videoId: accepted.videoId }
}

async function putPool(
  workOrderId: string,
  videoId: string,
  deps: AdmitDeps,
): Promise<{ ok: true; status: CreativePoolEntry['status'] } | (AdmitOutcome & { ok: false })> {
  const loaded = await deps.loadPool()
  if (!loaded.ok) return { ok: false, status: 503, error: loaded.error }
  const next = placeWorkOrderCandidate(loaded.pool, workOrderId, videoId)
  if (!next.changed) return { ok: true, status: next.status }
  const written = await deps.writePool(next.pool, loaded.version)
  if (written.ok) return { ok: true, status: next.status }
  if (written.conflict) return { ok: false, status: 409, error: '素材池刚被别处改过，请再验收一次。' }
  return { ok: false, status: 500, error: written.error }
}

async function writeCandidate(
  workOrderId: string,
  videoId: string,
  deps: AdmitDeps,
): Promise<{ ok: true; status: CreativePoolEntry['status'] } | (AdmitOutcome & { ok: false })> {
  const first = await putPool(workOrderId, videoId, deps)
  if (first.ok || first.status !== 409) return first
  return putPool(workOrderId, videoId, deps)
}

export async function admitFinishedAsset(order: AdmitWorkOrder, deps: AdmitDeps): Promise<AdmitOutcome> {
  if (!order.assetOnly || order.status !== 'in_review') return { ok: true, action: 'not_material' }
  if (!deps.uploadEnabled) return { ok: true, action: 'upload_disabled' }
  const target = await resolveTarget(deps)
  if (!target.ok) return target
  const video = await obtainVideoId(order, target.accountId, target.registeredIds, deps)
  if (!video.ok) return video
  const pooled = await writeCandidate(order.id, video.videoId, deps)
  if (!pooled.ok) return pooled
  return { ok: true, action: 'pooled', videoId: video.videoId, status: pooled.status }
}
