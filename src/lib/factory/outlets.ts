export interface OutletStatus {
  key: 'facebook' | 'instagram' | 'tiktok' | 'ads' | 'daily_plan'
  label: string
  connected: boolean
  note: string
}

// Static facts verified against the code on 2026-10-06; update when an outlet is wired.
export const REVIEW_OUTLETS: readonly OutletStatus[] = [
  {
    key: 'facebook',
    label: 'Facebook 主页 Reel',
    connected: true,
    note: '通过后排进发布队列,每小时自动发一次;全局发布开关没开时只存成草稿、不公开',
  },
  {
    key: 'instagram',
    label: 'Instagram',
    connected: false,
    note: '未接通(开发中)',
  },
  {
    key: 'tiktok',
    label: 'TikTok',
    connected: false,
    note: '未接通(审核页的片子不走 TikTok)',
  },
  {
    key: 'ads',
    label: '广告',
    connected: false,
    note: '未接通(计划中:发布后自动起草「暂停」广告,你批了才会开)',
  },
  {
    key: 'daily_plan',
    label: '每日计划(主页 Reel / 帖子 / Story)',
    connected: false,
    note: '未接通(暂缓,等 Remotion 在 CTS 跑稳两周再定)',
  },
]

export function factoryVideoUrl(
  videoPath: string | undefined | null,
  supabaseUrl: string,
  downloadName?: string,
): string {
  if (!videoPath) {
    return ''
  }

  const baseUrl = `${supabaseUrl}/storage/v1/object/public/content-factory/${videoPath}`

  if (downloadName) {
    return `${baseUrl}?download=${encodeURIComponent(downloadName)}`
  }

  return baseUrl
}
