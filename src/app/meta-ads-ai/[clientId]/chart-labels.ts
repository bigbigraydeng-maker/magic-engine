/** 图表里 Meta 返回的英文代号 → 老板看得懂的中文（真实客户报告与演示页共用；板桥 2026-09-27）。 */

export function placementLabel(platform: string, position: string): string {
  const p = platform.toLowerCase()
  const pos = position.toLowerCase()
  if (p === 'audience_network') return 'Meta 合作的其它 App'
  if (p === 'messenger') return 'Messenger'
  if (p === 'facebook') {
    if (pos === 'feed') return 'Facebook 动态'
    if (pos === 'story') return 'Facebook 快拍'
    if (pos === 'facebook_reels' || pos === 'reels') return 'Facebook 短视频'
  }
  if (p === 'instagram') {
    if (pos === 'stream' || pos === 'feed') return 'Instagram 动态'
    if (pos === 'story') return 'Instagram 快拍'
    if (pos === 'reels') return 'Instagram 短视频'
    if (pos === 'explore') return 'Instagram 发现页'
  }
  return `${platform} · ${position}`
}

export function deviceLabel(platform: string): string {
  if (platform === 'mobile_app') return '手机 App'
  if (platform === 'mobile_web') return '手机网页'
  if (platform === 'desktop') return '电脑'
  return platform
}

export function regionLabel(country: string): string {
  if (country === 'NZ') return '新西兰'
  if (country === 'AU') return '澳大利亚'
  return country
}
