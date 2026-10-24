/**
 * 推广活动返回给浏览器之前的裁剪。
 *
 * 活动描述目前和内部备注写在同一格：PM 指令、刻意停放、竞品调研都在 description。
 * 客户角色只拿下面点名的字段，没点名的（含以后新加的列）一律不发。
 * 内部身份沿用 requireDashboardClientAccess 的 role === 'admin'
 * （精确名单、管理员域名、DEMO_ADMINS、scoped_admin）。both / dashboard 不是内部。
 */

const CLIENT_FIELDS = [
  'id',
  'client_id',
  'status',
  'title',
  'valid_from',
  'valid_until',
  'source_urls',
  'source_file_urls',
  'offer',
  'target_audience_detail',
  'proof_points',
  'primary_cta',
  'channel_goal',
  'campaign_angle',
  'vi_mood',
  'vi_color_accent',
  'vi_specific_dos',
  'vi_specific_donts',
  'listing_id',
  'created_at',
  'updated_at',
] as const

const CLIENT_MUTABLE = new Set<string>([
  'title',
  'valid_from',
  'valid_until',
  'source_urls',
  'source_file_urls',
  'offer',
  'target_audience_detail',
  'proof_points',
  'primary_cta',
  'channel_goal',
  'campaign_angle',
  'vi_mood',
  'vi_color_accent',
  'vi_specific_dos',
  'vi_specific_donts',
])

export type CampaignViewer = 'client' | 'internal'

export function campaignViewer(role: string): CampaignViewer {
  return role === 'admin' ? 'internal' : 'client'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function presentCampaign(row: unknown, viewer: CampaignViewer): unknown {
  if (viewer === 'internal' || !isRecord(row)) return row
  const out: Record<string, unknown> = {}
  for (const key of CLIENT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(row, key)) out[key] = row[key]
  }
  return out
}

export function presentCampaigns(rows: unknown, viewer: CampaignViewer): unknown {
  if (viewer === 'internal' || !Array.isArray(rows)) return rows
  return rows.map((row) => presentCampaign(row, viewer))
}

/** 客户写入丢掉 description 等内部列，避免编辑时把内部备注写成空。 */
export function campaignPatchForViewer(
  body: Record<string, unknown>,
  viewer: CampaignViewer,
): Record<string, unknown> {
  const rest: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    if (key === 'status' || key === 'client_id' || key === 'id') continue
    rest[key] = value
  }
  if (viewer === 'internal') return rest
  const out: Record<string, unknown> = {}
  for (const key of CLIENT_MUTABLE) {
    if (Object.prototype.hasOwnProperty.call(rest, key)) out[key] = rest[key]
  }
  return out
}
