import Parser from 'rss-parser'
import { createHash } from 'node:crypto'
import type { RawItem, Result } from '@/lib/agent-learning/contracts'

/**
 * 可识别的固定 User-Agent（不是裸爬虫 UA）。
 * 契约 L6b：固定可识别 UA、遵守 robots、不绕反爬；此处只负责"标识自己"。
 * 采用 `Mozilla/5.0 (compatible; Bot/x; +url)` 通行格式：仍明示身份，但不被只认该格式的站点拒绝。
 */
export const LEARNING_USER_AGENT =
  'Mozilla/5.0 (compatible; MagicEngineLearningBot/1.0; +https://magicengine.com.au)'

/** 单次抓取（含正文读取）超时；与 rss-parser 模板同口径 15s。 */
export const FEED_FETCH_TIMEOUT_MS = 15_000

const FEED_ACCEPT = 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8'

/** 注入式抓取：只拿文本，不解析、不写库、不抛错。 */
export type FetchText = (url: string) => Promise<{ ok: true; text: string } | { ok: false; error: string }>

/** 抓取单元只需要来源标识与 feed 地址；不含任何客户信息。 */
export interface FeedSource {
  sourceKey: string
  feedUrl: string
}

type FetchResponseLike = { ok: boolean; status: number; text(): Promise<string> }

type FetchImpl = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<FetchResponseLike>

const defaultFetchImpl: FetchImpl = async (url, init) => {
  const res = await fetch(url, { headers: init.headers, signal: init.signal })
  return { ok: res.ok, status: res.status, text: () => res.text() }
}

/**
 * 把注入的 fetch 包成 FetchText：带 UA、带 15s 超时（覆盖正文读取）、
 * 非 2xx → `http_<status>`、异常 → `network_error` / `timeout`，永不抛错。
 */
export function createFetchText(fetchImpl: FetchImpl = defaultFetchImpl): FetchText {
  return async (url: string) => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FEED_FETCH_TIMEOUT_MS)
    try {
      const res = await fetchImpl(url, {
        headers: { 'User-Agent': LEARNING_USER_AGENT, Accept: FEED_ACCEPT },
        signal: controller.signal,
      })
      if (!res.ok) return { ok: false, error: `http_${res.status}` }
      const text = await res.text()
      return { ok: true, text }
    } catch (error) {
      const timedOut =
        controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')
      return { ok: false, error: timedOut ? 'timeout' : 'network_error' }
    } finally {
      clearTimeout(timeoutId)
    }
  }
}

function fromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return ''
  try {
    return String.fromCodePoint(code)
  } catch {
    return ''
  }
}

/** 先解数字实体与命名实体，`&amp;` 放最后，避免二次解码。 */
function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec: string) => fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/**
 * 正文 HTML → 纯文本。按契约 L6b：去 script/style、块级标签转换行、去剩余标签、
 * 解实体、规整空白；**不截断长度**（模板里的 2000 字符截断是它的业务需要，不是我们的）。
 */
export function htmlToText(html: string): string {
  if (html.length === 0) return ''
  let text = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
  text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  text = text.replace(/<br\s*\/?>/gi, '\n')
  text = text.replace(/<\/(?:p|li|h[1-6]|div|blockquote|tr)\s*>/gi, '\n')
  text = text.replace(/<[^>]*>/g, '')
  text = decodeEntities(text)
  text = text.replace(/[ \t\f\v]+/g, ' ')
  text = text.replace(/ *\n */g, '\n')
  text = text.replace(/\n{3,}/g, '\n\n')
  return text.trim()
}

/** 正文的 sha256（用于 (source_id, content_hash) 去重）。 */
export function contentHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** 合法 feed 必然以 '<' 开头；用于把"根本不是 XML"的响应确定性地判为解析失败。 */
function looksLikeXml(xml: string): boolean {
  return xml.replace(/^\uFEFF/, '').trimStart().startsWith('<')
}

/**
 * 解析 RSS 2.0 / Atom。复用 rss-parser（不自己写 XML 解析器）。
 * 解析失败 → `feed_parse_error`；条目缺链接或标题则跳过；正文不截断。
 */
export async function parseFeedXml(xml: string, opts: { limit: number }): Promise<Result<RawItem[]>> {
  if (!looksLikeXml(xml)) {
    return { ok: false, error: 'feed_parse_error', code: 'validation' }
  }

  const parser = new Parser({ customFields: { item: ['content:encoded', 'content'] } })

  let parsed: unknown
  try {
    parsed = await parser.parseString(xml)
  } catch {
    return { ok: false, error: 'feed_parse_error', code: 'validation' }
  }

  const itemsField = isRecord(parsed) ? parsed.items : undefined
  const rawItems: unknown[] = Array.isArray(itemsField) ? itemsField : []
  const limit = Number.isFinite(opts.limit) ? Math.max(0, Math.floor(opts.limit)) : 0

  const items: RawItem[] = []
  for (const raw of rawItems) {
    if (items.length >= limit) break
    if (!isRecord(raw)) continue

    const externalRef = str(raw.link) ?? str(raw.guid) ?? str(raw.id)
    if (externalRef === null) continue

    const title = str(raw.title)
    if (title === null) continue

    const publishedAt = str(raw.isoDate) ?? str(raw.pubDate) ?? null
    const rawText =
      str(raw['content:encoded']) ??
      str(raw.content) ??
      str(raw.summary) ??
      str(raw.contentSnippet) ??
      ''

    items.push({ externalRef, title, publishedAt, text: htmlToText(rawText) })
  }

  return { ok: true, value: items }
}

/**
 * 抓取并解析一个来源。fetch 必须注入（测试替身/未来 robots 包装都走这里）；
 * 本函数除注入的 fetch 外无任何副作用，不写库、不写 items、不抛错。
 */
export async function fetchFeedItems(
  deps: { fetchText: FetchText },
  source: FeedSource,
  opts: { limit: number },
): Promise<Result<RawItem[]>> {
  let fetched: Awaited<ReturnType<FetchText>>
  try {
    fetched = await deps.fetchText(source.feedUrl)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `feed_fetch_failed:${reason}`, code: 'db_error' }
  }

  if (!fetched.ok) {
    return { ok: false, error: `feed_fetch_failed:${fetched.error}`, code: 'db_error' }
  }

  return parseFeedXml(fetched.text, opts)
}
