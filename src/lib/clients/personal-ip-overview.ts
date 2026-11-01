/**
 * 个人 IP 客户概览首屏 —— 五格数字的纯函数（展示层）。
 * 读数在 personal-ip-overview-load.ts；读不到一律「读不到」，不当 0。
 */

export const PERSONAL_IP_UNREADABLE = '读不到'

export type PersonalIpTileKey =
  | 'posts_on_schedule'
  | 'social_followers'
  | 'website_views'
  | 'dms_enquiries'
  | 'leads'

export interface PersonalIpRawSnapshot {
  postsOnSchedule: number | null
  facebookFollowers: number | null
  tiktokFollowers: number | null
  websitePageviews: number | null
  dmsAndEnquiries: number | null
  leads: number | null
}

export interface PersonalIpTile {
  key: PersonalIpTileKey
  label: string
  value: string
}

export const PERSONAL_IP_TILE_LABELS: Readonly<Record<PersonalIpTileKey, string>> = {
  posts_on_schedule: '按时发布帖子',
  social_followers: 'FB / TikTok 粉丝',
  website_views: '网站浏览',
  dms_enquiries: '私信与咨询',
  leads: '线索',
}

function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString('en-NZ')
}

export function formatCount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return PERSONAL_IP_UNREADABLE
  return fmtCount(value)
}

export function formatSocialFollowers(
  facebook: number | null | undefined,
  tiktok: number | null | undefined,
): string {
  if (facebook == null && tiktok == null) return PERSONAL_IP_UNREADABLE
  const fb = facebook != null && Number.isFinite(facebook)
    ? `FB ${fmtCount(facebook)}`
    : 'FB 读不到'
  const tt = tiktok != null && Number.isFinite(tiktok)
    ? `TikTok ${fmtCount(tiktok)}`
    : 'TikTok 读不到'
  return `${fb} · ${tt}`
}

export function buildPersonalIpTiles(raw: PersonalIpRawSnapshot): PersonalIpTile[] {
  return [
    {
      key: 'posts_on_schedule',
      label: PERSONAL_IP_TILE_LABELS.posts_on_schedule,
      value: formatCount(raw.postsOnSchedule),
    },
    {
      key: 'social_followers',
      label: PERSONAL_IP_TILE_LABELS.social_followers,
      value: formatSocialFollowers(raw.facebookFollowers, raw.tiktokFollowers),
    },
    {
      key: 'website_views',
      label: PERSONAL_IP_TILE_LABELS.website_views,
      value: formatCount(raw.websitePageviews),
    },
    {
      key: 'dms_enquiries',
      label: PERSONAL_IP_TILE_LABELS.dms_enquiries,
      value: formatCount(raw.dmsAndEnquiries),
    },
    {
      key: 'leads',
      label: PERSONAL_IP_TILE_LABELS.leads,
      value: formatCount(raw.leads),
    },
  ]
}
