import { safeFetchText, BlockedAddressError, ResponseTooLargeError, type SafeFetchTextResponse } from '@/lib/net/safe-fetch'
import { analyzeDocuments, linkedResources, type SourceDocument } from './analyze'
import { normalizeScanUrl, publicSource, ScanInputError } from './url'
import type { ScanReport } from './types'

export class ScanReadError extends Error {}

const USER_AGENT = 'MagicEnginePublicChecker/1.0 (public HTML inspection; no forms submitted)'

function isHtml(response: SafeFetchTextResponse): boolean {
  const challenge = /<title[^<>]*>\s*(?:just a moment|attention required|access denied|verify you are human|security check)/i.test(response.text)
  return !challenge && response.ok && /(?:text\/html|application\/xhtml\+xml)/i.test(response.headers.get('content-type') ?? '') && /<(?:html|body|head|!doctype)\b/i.test(response.text)
}

export async function scanWebsite(rawUrl: string, rawAdUrl?: string): Promise<ScanReport> {
  const url = normalizeScanUrl(rawUrl)
  const adUrl = rawAdUrl?.trim() ? normalizeScanUrl(rawAdUrl, true) : undefined
  // Max wall-time is bounded by the sum of per-hop DNS/request limits:
  // first page <= 12s; next parallel batch <= 6.5s (+ small CPU/cleanup).
  const main = await safeFetchText(url, { timeoutMs: 3000, dnsTimeoutMs: 1000, maxRedirects: 2, maxResponseBytes: 750_000, userAgent: USER_AGENT })
  if (!isHtml(main)) throw new ScanReadError('这次没能读取完整网页。请换成官网首页再试，或稍后重试。')
  const finalUrl = normalizeScanUrl(main.url)
  const sourceUrl = publicSource(main.url)
  const documents: SourceDocument[] = [{ text: main.text, source: sourceUrl, kind: 'page' }]
  const resources = linkedResources(main.text, finalUrl)
  const targets = [
    ...resources.scripts.map(target => ({ target, kind: 'script' as const })),
    ...(resources.contact ? [{ target: resources.contact, kind: 'page' as const }] : []),
    ...(adUrl ? [{ target: adUrl.href, kind: 'ad' as const }] : []),
  ]
  let incomplete = false
  let ad: 'omitted' | 'unreadable' | 'readable' = adUrl ? 'unreadable' : 'omitted'
  const results = await Promise.allSettled(targets.map(async ({ target, kind }) => {
    const result = await safeFetchText(target, {
      timeoutMs: kind === 'script' ? 2000 : 2500, dnsTimeoutMs: kind === 'script' ? 500 : 750,
      maxRedirects: kind === 'script' ? 0 : 1, maxResponseBytes: kind === 'page' ? 400_000 : 300_000, userAgent: USER_AGENT,
    })
    if (kind === 'ad') return { kind, result, usable: isHtml(result) && !/login|checkpoint|consent/i.test(new URL(result.url).pathname) }
    const sameOrigin = new URL(result.url).origin === finalUrl.origin
    return { kind, result, usable: sameOrigin && (kind === 'page' ? isHtml(result) : result.ok && /(?:javascript|ecmascript|text\/plain)/i.test(result.headers.get('content-type') ?? '')) }
  }))
  for (const result of results) {
    if (result.status === 'rejected') { incomplete = true; continue }
    const value = result.value
    if (value.kind === 'ad') { ad = value.usable ? 'readable' : 'unreadable'; continue }
    if (!value.usable) { incomplete = true; continue }
    documents.push({ text: value.result.text, source: publicSource(value.result.url), kind: value.kind })
  }
  const utm = [...url.searchParams.keys()].filter(key => /^utm_/i.test(key))
  return analyzeDocuments({ documents, sourceUrl, scannedAt: new Date().toISOString(), https: finalUrl.protocol === 'https:', status: main.status, incomplete, ad,
    utm: !utm.length ? 'absent' : utm.every(key => JSON.stringify(url.searchParams.getAll(key)) === JSON.stringify(finalUrl.searchParams.getAll(key))) ? 'preserved' : 'changed',
  })
}

export function scanErrorMessage(error: unknown): { status: number; message: string } {
  if (error instanceof ScanInputError) return { status: 400, message: error.message }
  if (error instanceof BlockedAddressError) return { status: 400, message: '这个地址不在可检查的公开网站范围内，请使用公司官网。' }
  if (error instanceof ResponseTooLargeError) return { status: 422, message: '页面内容超过本次读取范围，请换一个更简洁的页面再试。' }
  if (error instanceof ScanReadError) return { status: 422, message: error.message }
  return { status: 422, message: '这次没能打开这个页面。请检查网址，或换成官网首页再试。部分网站会限制自动读取。' }
}
