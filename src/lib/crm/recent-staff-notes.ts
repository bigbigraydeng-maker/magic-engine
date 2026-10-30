/** 最近手记是翻找入口，不代表承诺已完成或该再次致电。 */
export interface RecentStaffNote {
  touchpointId: string
  contactId: string
  name: string
  /** 员工写入 CRM 的时间，用来排“最近记一笔”。 */
  at: string
  /** 原通话时间，补记时可能早于 at。 */
  occurredAt: string
  preview: string
  /** 展开时显示完整员工原文；preview 仅供收起时快速浏览。 */
  content: string
  /** 仅这笔手记自己的解析摘要；没有时不借用旧对话概况。 */
  aiSummary?: string | null
}

export function recentStaffNotes(
  contacts: ReadonlyArray<{ id: string; display_name: string | null }>,
  touches: ReadonlyArray<{
    id: string
    contact_id: string
    source: string | null
    direction: 'inbound' | 'outbound'
    occurred_at: string
    created_at?: string | null
    raw: string | null
    metadata: Record<string, unknown> | null
  }>,
  now: Date,
  limit = 50,
): RecentStaffNote[] {
  const names = new Map(contacts.map((contact) => [contact.id, contact.display_name?.trim() || '未留名']))
  const cutoff = now.getTime() - 7 * 24 * 60 * 60 * 1000
  const latest = new Map<string, RecentStaffNote>()
  for (const touch of touches) {
    const loggedAt = touch.created_at ?? touch.occurred_at
    const atMs = Date.parse(loggedAt)
    const preview = touch.raw?.trim()
    const name = names.get(touch.contact_id)
    if (!name || touch.source !== 'me_manual' || !preview ||
      touch.metadata?.action || !Number.isFinite(atMs) || atMs < cutoff || atMs > now.getTime()) continue
    const existing = latest.get(touch.contact_id)
    if (!existing || atMs > Date.parse(existing.at)) {
      latest.set(touch.contact_id, {
        touchpointId: touch.id,
        contactId: touch.contact_id,
        name,
        at: loggedAt,
        occurredAt: touch.occurred_at,
        preview: preview.slice(0, 120),
        content: preview,
      })
    }
  }
  return [...latest.values()]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.contactId.localeCompare(b.contactId))
    .slice(0, Math.max(0, limit))
}
