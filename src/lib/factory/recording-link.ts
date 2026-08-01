// 录像链接归一化 — 客户手机录完直接同步 Dropbox，粘分享链接比再导出上传快。
// 关键坑：Dropbox 分享链接默认 dl=0 = 网页预览页，抓下来是 HTML 不是视频，必须转直下。
// 纯函数，网络探测在调用方(API 路由)做。

/** 私网 / 元数据地址：绝不允许做片 worker 去抓(SSRF 防线)。 */
const BLOCKED_HOST_RE = /^(localhost|127\.|0\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|metadata\.)/i

export interface LinkCheck {
  ok: boolean
  url?: string      // 归一化后的直下链接
  error?: string    // 人话原因(直接给客户看)
}

/**
 * 把粘进来的分享链接转成能直接下到视频的链接。
 * 支持：Dropbox 分享链接(自动转直下) / 任何 https 直链。
 */
export function normalizeRecordingLink(raw: string): LinkCheck {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return { ok: false, error: '把链接粘进来再点确定' }

  let u: URL
  try {
    u = new URL(trimmed)
  } catch {
    return { ok: false, error: '这不像一个链接 — 复制 Dropbox 的「共享链接」再粘一次' }
  }

  if (u.protocol !== 'https:') {
    return { ok: false, error: '只收 https 开头的链接' }
  }
  if (BLOCKED_HOST_RE.test(u.hostname)) {
    return { ok: false, error: '这个链接地址不能用，换 Dropbox 的共享链接' }
  }

  const host = u.hostname.toLowerCase()

  // Dropbox 分享页 → 直下(dl=1)。rlkey 等其它参数必须原样保留，否则 403。
  if (host === 'www.dropbox.com' || host === 'dropbox.com') {
    u.searchParams.delete('dl')
    u.searchParams.delete('raw')
    u.searchParams.set('dl', '1')
    return { ok: true, url: u.toString() }
  }
  // Dropbox 已经是直下域名，原样用
  if (host.endsWith('dropboxusercontent.com')) {
    return { ok: true, url: u.toString() }
  }

  // iCloud / Google Drive 分享页给不出直下链接，早点说清楚，别让人等到做片才失败
  if (host.includes('icloud.com')) {
    return { ok: false, error: 'iCloud 链接抓不到文件 — 用 Dropbox 共享链接，或直接上传文件' }
  }
  if (host.includes('drive.google.com')) {
    return { ok: false, error: 'Google 云端硬盘链接抓不到文件 — 用 Dropbox 共享链接，或直接上传文件' }
  }

  // 其它：当直链收，能不能下到视频由调用方探测决定
  return { ok: true, url: u.toString() }
}

/** 探测结果是不是视频(Dropbox 直下会返回 video/* 或 octet-stream)。 */
export function looksLikeVideoResponse(contentType: string | null, url: string): boolean {
  const ct = (contentType ?? '').toLowerCase()
  if (ct.startsWith('video/')) return true
  if (ct.includes('octet-stream') || ct.includes('binary')) return true
  // 有些 CDN 不给 content-type，退而看扩展名
  return /\.(mp4|mov|m4v|webm)(\?|$)/i.test(url)
}
