/**
 * 从链接或查询参数里取出客户 ID。
 * 邮件客户端会在长链接里插入换行或不可见字符，整段因此通不过 uuid 校验，
 * 核对页就显示「client_id 必填且必须是 uuid」——其实链接里客户 ID 是齐的。
 */

const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

export function extractUuid(raw: string | null | undefined): string | null {
  if (!raw) return null
  const compact = raw.replace(/[\s\u200B\u200C\u200D\uFEFF]/g, '')
  const match = compact.match(UUID_IN_TEXT)
  return match ? match[0].toLowerCase() : null
}

/** 核对页深链认 `client`（今日待办）也认 `client_id`。 */
export function clientIdFromSearch(search: string): { id: string | null; raw: string } {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const raw = params.get('client') ?? params.get('client_id') ?? ''
  return { id: extractUuid(raw), raw }
}
