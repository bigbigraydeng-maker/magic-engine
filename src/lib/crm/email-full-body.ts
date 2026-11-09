/**
 * 抽屉里「上次说到这」要看全：邮件同步只存 255 字摘要，这里对**最新一封客人来信**
 * 单独去邮箱拉全文，并把下面带着的引用历史砍掉。拉不到就原样返回摘要，不挡抽屉。
 */
import { supabaseAdmin } from '@/lib/supabase'

const MAX_CHARS = 3000
/** 摘要长度上限是 255；比这短说明本来就是全文，不用再拉。 */
export const PREVIEW_LIMIT = 250

// 回复里「下面开始是引用的旧信」的几种常见起头。
const QUOTE_MARKERS = [
  /\r?\n-{2,}\s*Original Message\s*-{2,}/i,
  /\r?\nOn .{5,120} wrote:\s*\r?\n/,
  /\r?\nFrom:\s.+\r?\n(?:Sent|Date):\s/i,
  /\r?\n_{10,}\r?\n/,
]

/** 砍掉引用历史并限长。纯函数，便于测试。 */
export function trimQuotedReply(text: string, max = MAX_CHARS): string {
  let cut = text.length
  for (const re of QUOTE_MARKERS) {
    const m = re.exec(text)
    if (m && m.index > 0 && m.index < cut) cut = m.index
  }
  const head = text.slice(0, cut).trim()
  return head.length > max ? `${head.slice(0, max).trimEnd()}…` : head
}

export function mayBeTruncatedPreview(body: string | null | undefined): boolean {
  return (body ?? '').trim().length >= PREVIEW_LIMIT
}

/** 取一封信的全文（已去引用）。任何一步失败返回 null。 */
export async function fetchFullEmailBody(clientId: string, messageId: string): Promise<string | null> {
  try {
    const { MICROSOFT_MAIL_PROVIDER } = await import('@/lib/microsoft/mail-oauth')
    const { CONNECTION_STATUS } = await import('@/lib/platform-oauth/vocabulary')
    const { data } = await supabaseAdmin
      .from('platform_oauth_connections')
      .select('id')
      .eq('client_id', clientId)
      .eq('provider', MICROSOFT_MAIL_PROVIDER)
      .eq('status', CONNECTION_STATUS.ACTIVE)
      .limit(1)
      .maybeSingle()
    const connectionId = (data as { id: string } | null)?.id ?? null
    if (!connectionId) return null
    const { getValidTokenForConnection } = await import('@/lib/platform-oauth/token-manager')
    const { fetchMessageText } = await import('@/lib/microsoft/mail-graph')
    const token = await getValidTokenForConnection(connectionId)
    const r = await fetchMessageText(token, messageId)
    if (!r.ok) return null
    const full = trimQuotedReply(r.message.body)
    return full || null
  } catch {
    return null
  }
}
