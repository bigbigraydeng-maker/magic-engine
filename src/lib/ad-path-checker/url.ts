import { isIP } from 'node:net'
import { classifyAddress } from '@/lib/net/safe-fetch'

export class ScanInputError extends Error {}

const PRIVATE_NAMES = /(?:^|\.)(?:localhost|local|internal|home|lan|invalid|test)$/i
const SECRET_QUERY = /token|secret|password|passwd|authorization|session|api.?key|signature|credential|email|phone/i

/** Input hygiene; safeFetchText independently validates DNS and every redirect. */
export function normalizeScanUrl(raw: string, facebook = false): URL {
  const text = raw.trim()
  if (!text || text.length > 2048 || /[\s\\\u0000-\u001f]/.test(text)) {
    throw new ScanInputError('请填写完整的网站地址，例如 www.yourcompany.com。')
  }
  let url: URL
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`)
  } catch {
    throw new ScanInputError('这个网址看起来不完整，请检查后再试。')
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port ||
    PRIVATE_NAMES.test(hostname) || (!hostname.includes('.') && !isIP(hostname)) ||
    (isIP(hostname) && classifyAddress(hostname).blocked) ||
    [...url.searchParams.keys()].some(key => SECRET_QUERY.test(key))) {
    throw new ScanInputError('请使用不含登录信息的公开网站地址，仅支持普通 HTTP / HTTPS 页面。')
  }
  if (facebook && !['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com'].includes(hostname)) {
    throw new ScanInputError('请粘贴 Facebook 主页或广告资料库的公开链接。')
  }
  url.hash = ''
  return url
}

/** Never echo query values or fragments in report evidence. */
export function publicSource(input: string): string {
  const url = new URL(input)
  url.username = ''
  url.password = ''
  url.search = ''
  url.hash = ''
  return url.href
}
