/**
 * 仅素材工单三关通过后的上传口。
 * 这里没有确认卡，所以不把成片传到广告账户。
 * 工单上已经记下的同账户回执可以复用，那一次不再上传。
 * 不写素材池。关掉上传的开关仍然直接跳过。
 */

export const ASSET_UPLOAD_REFUSED =
  '成片验收不能直接传到广告账户。这里没有确认卡，没有上传。'

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
}

export type AdmitOutcome =
  | { ok: true; action: 'not_material' }
  | { ok: true; action: 'upload_disabled' }
  | { ok: true; action: 'uploaded'; videoId: string; accountId: string }
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

export function accountUploadReceipt(reviewRef: unknown): { videoId: string; accountId: string } | null {
  if (typeof reviewRef !== 'object' || reviewRef === null || Array.isArray(reviewRef)) return null
  const ref = reviewRef as Record<string, unknown>
  if (ref.meta_video_source !== ACCOUNT_UPLOAD_SOURCE) return null
  const id = ref.meta_video_id
  const account = ref.meta_video_account
  if (typeof id !== 'string' || !/^\d{1,32}$/.test(id)) return null
  if (typeof account !== 'string' || account.length === 0) return null
  return { videoId: id, accountId: account }
}

export function reusableVideoId(reviewRef: Record<string, unknown>, accountId: string): string | null {
  const stored = accountUploadReceipt(reviewRef)
  if (!stored || !accountIsRegistered(stored.accountId, [accountId])) return null
  return stored.videoId
}

export function factoryPublicVideoUrl(videoPath: string | null, publicBase: string): string | null {
  if (!videoPath || videoPath.includes('..') || !videoPath.startsWith('renders/')) return null
  const base = publicBase.replace(/\/$/, '')
  if (!base.startsWith('https://')) return null
  return `${base}/${videoPath}`
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

function obtainVideoId(
  order: AdmitWorkOrder,
  accountId: string,
): { ok: true; videoId: string } | (AdmitOutcome & { ok: false }) {
  const reused = reusableVideoId(order.reviewRef, accountId)
  if (reused) return { ok: true, videoId: reused }
  return { ok: false, status: 409, error: ASSET_UPLOAD_REFUSED }
}

export async function admitFinishedAsset(order: AdmitWorkOrder, deps: AdmitDeps): Promise<AdmitOutcome> {
  if (!order.assetOnly || order.status !== 'in_review') return { ok: true, action: 'not_material' }
  if (!deps.uploadEnabled) return { ok: true, action: 'upload_disabled' }
  const target = await resolveTarget(deps)
  if (!target.ok) return target
  const video = obtainVideoId(order, target.accountId)
  if (!video.ok) return video
  return { ok: true, action: 'uploaded', videoId: video.videoId, accountId: target.accountId }
}
