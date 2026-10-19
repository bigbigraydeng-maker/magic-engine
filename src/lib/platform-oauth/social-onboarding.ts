/** Persisted authorisation facts only: no provider calls, refreshes or publishing. */
import { INSTAGRAM_SCOPES, isInstagramAccountId, normalizeInstagramHandle } from '@/lib/instagram-oauth/identity'
import { META_PUBLISH_SCOPE } from '@/lib/meta-oauth/client'
import { TIKTOK_SCOPES } from '@/lib/tiktok-oauth/client'
import { YOUTUBE_PUBLISH_SCOPES } from '@/lib/youtube-publish/client'

export interface SocialConnectionFact {
  id: string
  provider: string
  purpose: string
  account_id: string
  location_name?: string | null
  display_name: string | null
  status: string
  scopes: unknown
  token_expiry: string | null
  last_synced_at: string | null
}

export interface SocialClientFacts {
  instagram_handle: string | null
  facebook_page_url: string | null
  tiktok_handle: string | null
  facebookPublishPageId: string | null
  youtubeChannelId: string | null
}

export type SocialAuthorization = 'not_connected' | 'target_missing' | 'account_mismatch'
  | 'ambiguous' | 'needs_attention' | 'unknown' | 'saved' | 'refresh_pending' | 'not_available'

export interface SocialChannelStatus {
  platform: 'facebook' | 'instagram' | 'threads' | 'x' | 'tiktok' | 'youtube'
  name: string
  profile: string | null
  targetAccountId: string | null
  authorization: SocialAuthorization
  identity: { accountId: string; displayName: string; verifiedAt: string | null } | null
  detail: string
  publishing: string
  connectAvailable?: boolean
  managedAccounts?: Array<{ connectionId: string; accountId: string; displayName: string }>
}

export interface SocialConnectionsSnapshot {
  channels: SocialChannelStatus[]
  readAt: string
  canManageConfiguration: boolean
}

const PUBLICATION = {
  facebook: '发帖权限记录不代表已可发布；仍需单独授权的试发核验。',
  tiktok: '公开发布资格尚未实时核实，仍需核对应用审核和账号可见范围。',
  youtube: '当前连接用于私享上传及读回核对；公开发布需要另外授权。',
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function date(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString() : null
}

type Grant = Pick<SocialChannelStatus, 'authorization' | 'identity' | 'detail'>

function assessGrant(row: SocialConnectionFact, required: readonly string[], now: Date): Grant {
  const identity = { accountId: row.account_id, displayName: text(row.display_name) ?? row.account_id,
    verifiedAt: date(row.last_synced_at) }
  if (row.status === 'revoked') return { authorization: 'not_connected', identity: null, detail: '此账号的授权已主动断开。' }
  if (row.status === 'error' || row.status === 'expired') {
    return { authorization: 'needs_attention', identity, detail: '授权记录显示连接需要处理，请重新核实或授权。' }
  }
  const expiry = date(row.token_expiry)
  if (row.status !== 'active' || !text(row.account_id) || !expiry || !Array.isArray(row.scopes)
    || !row.scopes.every((scope: unknown) => typeof scope === 'string')) {
    return { authorization: 'unknown', identity: null, detail: '授权记录不完整，暂时无法确认状态。' }
  }
  if (required.some(scope => !(row.scopes as string[]).includes(scope))) {
    return { authorization: 'needs_attention', identity, detail: '已保存账号授权，但缺少该连接所需的权限，请重新授权。' }
  }
  if (Date.parse(expiry) <= now.getTime()) {
    return (row.provider === 'meta' || row.provider === 'instagram' || row.provider === 'tiktok')
      ? { authorization: 'needs_attention', identity, detail: '保存的授权已到期，需要重新授权。' }
      : { authorization: 'refresh_pending', identity, detail: '已保存授权；访问凭据待使用时刷新，当前未实时核验。' }
  }
  return { authorization: 'saved', identity, detail: '已保存授权记录，当前未实时核验平台连接。' }
}

function resolveGrant(rows: SocialConnectionFact[], target: string | null, required: readonly string[], now: Date, requireTarget: boolean): Grant {
  if (requireTarget && !target) return { authorization: 'target_missing', identity: null, detail: '尚未确认发布目标，请先由团队核实配置。' }
  const live = rows.filter(row => row.status !== 'revoked')
  const matches = target ? rows.filter(row => row.account_id === target) : rows
  if ((rows[0]?.provider !== 'meta' && live.length > 1) || matches.filter(row => row.status === 'active').length > 1) {
    return { authorization: 'ambiguous', identity: null, detail: '存在多个授权账号，当前发布账号仍需团队核实。' }
  }
  const row = matches.find(value => value.status !== 'revoked') ?? matches[0]
  if (!row) return { authorization: live.length ? 'account_mismatch' : 'not_connected', identity: null,
    detail: live.length ? '保存的授权账号与当前配置的发布目标不一致。' : '尚未保存此目标账号的授权。' }
  return assessGrant(row, required, now)
}

export function buildSocialConnections(client: SocialClientFacts, rows: SocialConnectionFact[], now: Date, instagramAvailable = false): SocialChannelStatus[] {
  // Never inherit the principal-scoped Meta Ads pilot's identity or grant.
  const legacy = rows.filter(row => row.purpose === 'legacy')
  const page = text(client.facebookPublishPageId)
  const channel = text(client.youtubeChannelId)
  const facebookTarget = page && /^\d{5,32}$/.test(page) ? page : null
  const youtubeTarget = channel && /^UC[A-Za-z0-9_-]{22}$/.test(channel) ? channel : null
  const facebook: SocialChannelStatus = {
    platform: 'facebook', name: 'Facebook Page', profile: text(client.facebook_page_url), targetAccountId: facebookTarget,
    ...resolveGrant(legacy.filter(row => row.provider === 'meta'), facebookTarget, [META_PUBLISH_SCOPE], now, true),
    publishing: PUBLICATION.facebook,
  }
  const tiktok: SocialChannelStatus = {
    platform: 'tiktok', name: 'TikTok', profile: text(client.tiktok_handle), targetAccountId: null,
    ...resolveGrant(legacy.filter(row => row.provider === 'tiktok'), null, TIKTOK_SCOPES, now, false),
    publishing: PUBLICATION.tiktok,
  }
  const youtube: SocialChannelStatus = {
    platform: 'youtube', name: 'YouTube Shorts', profile: channel, targetAccountId: youtubeTarget,
    ...resolveGrant(legacy.filter(row => row.provider === 'google_youtube'), youtubeTarget, YOUTUBE_PUBLISH_SCOPES, now, true),
    ...(!youtubeTarget && !channel ? { detail: '尚未确认频道。连接拥有单个频道的 Google 账号后，可自动登记目标频道。' } : {}),
    publishing: PUBLICATION.youtube,
    managedAccounts: legacy.filter(row => row.provider === 'google_youtube' && row.status !== 'revoked' && text(row.id) && text(row.account_id))
      .map(row => ({ connectionId: row.id, accountId: row.account_id, displayName: text(row.display_name) ?? row.account_id })),
  }
  const igRows = legacy.filter(row => row.provider === 'instagram')
  const igHandle = normalizeInstagramHandle(client.instagram_handle)
  const igLive = igRows.filter(row => row.status !== 'revoked')
  let igGrant: Grant
  if (!igHandle) igGrant = { authorization: 'target_missing', identity: null, detail: '请先登记有效的 Instagram 用户名。' }
  else if (igLive.length > 1) igGrant = { authorization: 'ambiguous', identity: null, detail: '存在多个 Instagram 授权记录，需要团队核实后再继续连接。' }
  else {
    const igRow = igRows.find(row => row.status !== 'revoked') ?? igRows[0]
    if (!igRow) igGrant = { authorization: 'not_connected', identity: null, detail: '尚未保存此 Instagram 账号的授权。' }
    else if (igRow.status === 'revoked') igGrant = assessGrant(igRow, INSTAGRAM_SCOPES, now)
    else if (!isInstagramAccountId(igRow.account_id) || !normalizeInstagramHandle(igRow.location_name)) {
      igGrant = { authorization: 'unknown', identity: null, detail: '保存的账号身份不完整，请重新核实。' }
    } else if (normalizeInstagramHandle(igRow.location_name) !== igHandle) {
      igGrant = { authorization: 'account_mismatch', identity: null, detail: '保存的 Instagram 授权与登记用户名不一致，请核实后重新连接。' }
    } else igGrant = assessGrant(igRow, INSTAGRAM_SCOPES, now)
  }
  const instagram: SocialChannelStatus = {
    platform: 'instagram', name: 'Instagram', profile: text(client.instagram_handle), targetAccountId: null,
    ...igGrant, connectAvailable: instagramAvailable && Boolean(igHandle),
    ...(!instagramAvailable && !igRows.length ? { authorization: 'not_available' as const,
      detail: 'Instagram 原生授权暂未开放，登记账号资料不代表已接通。' } : {}),
    publishing: '当前仅连接账号资料，尚不支持发布。',
    managedAccounts: igLive.map(row => ({ connectionId: row.id, accountId: row.account_id,
      displayName: text(row.display_name) ?? row.account_id })),
  }
  const unavailable = (platform: 'threads' | 'x', name: string, profile: string | null): SocialChannelStatus => ({
    platform, name, profile: text(profile), targetAccountId: null, authorization: 'not_available', identity: null,
    detail: '原生授权暂未开放，登记账号资料不代表已接通。', publishing: '当前入口暂不支持此平台的原生发布。',
  })
  return [facebook, instagram, unavailable('threads', 'Threads', null),
    unavailable('x', 'X', null), tiktok, youtube]
}
