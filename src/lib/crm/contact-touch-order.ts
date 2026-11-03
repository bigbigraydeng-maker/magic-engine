/**
 * 「全部客人」默认排序：最近有互动的人排最前。
 *
 * 之前服务端按 first_seen_at（第一次进线）倒序再分页，页面只在已选出的这一页里按「最近联系」
 * 重排，于是一个老客人今天来了新消息，仍沉在后面几页里（PM 2026-10-14）。contacts.last_seen_at
 * 不能用来排：实测它在生产里 721/1159 个人比真实最新触点旧，没人保证它被维护。
 *
 * 这里按真实触点时间排：从最新的触点往回翻，翻到凑够「要显示到第几位」就停，所以第一页通常只读一小批。
 * 纯逻辑，不碰数据库；取一页触点的动作由调用方传进来。
 */

export interface TouchOrderContact {
  id: string
  firstSeenAt: string | null
}

export interface TouchRowLite {
  contact_id: string
  occurred_at: string
}

export interface TouchOrderOptions {
  contacts: TouchOrderContact[]
  /** 至少要排准前几位（= page * perPage）。 */
  need: number
  /** 取第 i 批触点（按 occurred_at 倒序，每批 pageSize 条）；null/空数组 = 没有了。 */
  fetchTouchPage: (pageIndex: number) => Promise<TouchRowLite[]>
  pageSize: number
  /** 最多翻这么多批，防止没有触点的大客户把整张表翻一遍。 */
  maxPages: number
}

function ts(v: string | null | undefined): number {
  if (!v) return 0
  const t = Date.parse(v)
  return Number.isNaN(t) ? 0 : t
}

/**
 * 返回全部 contacts 的 id，顺序：有触点的按最新触点时间倒序（先翻到的先排），
 * 其余（没触点 / 超出翻页上限没翻到）按 first_seen_at 倒序接在后面。
 */
export async function orderContactIdsByLatestTouch(opts: TouchOrderOptions): Promise<string[]> {
  const { contacts, need, fetchTouchPage, pageSize, maxPages } = opts
  const wanted = new Set(contacts.map((c) => c.id))
  const seen: string[] = []
  const seenSet = new Set<string>()

  for (let i = 0; i < maxPages && seen.length < need && seen.length < wanted.size; i++) {
    const rows = await fetchTouchPage(i)
    if (rows.length === 0) break
    for (const row of rows) {
      if (!wanted.has(row.contact_id) || seenSet.has(row.contact_id)) continue
      seenSet.add(row.contact_id)
      seen.push(row.contact_id)
    }
    if (rows.length < pageSize) break
  }

  const rest = contacts
    .filter((c) => !seenSet.has(c.id))
    .sort((a, b) => ts(b.firstSeenAt) - ts(a.firstSeenAt) || (a.id < b.id ? -1 : 1))
    .map((c) => c.id)

  return [...seen, ...rest]
}

export interface ScanOptions {
  /** 至少要凑够几个不同的人（= page * perPage）。 */
  need: number
  fetchTouchPage: (pageIndex: number) => Promise<TouchRowLite[]>
  pageSize: number
  maxPages: number
}

/**
 * 没有任何筛选时的快路径：不用先把全客户的 id 都取出来，直接从最新触点往回翻，
 * 翻到凑够 need 个不同的人为止，返回他们的 id（最新互动在前）。
 * 凑不够（触点里的人不到 need 个，或翻页到上限）时返回 null —— 调用方改走完整路径，
 * 那条路会把没有触点的人按首次进线接在后面。
 */
export async function scanLatestTouchContactIds(opts: ScanOptions): Promise<string[] | null> {
  const { need, fetchTouchPage, pageSize, maxPages } = opts
  const seen: string[] = []
  const seenSet = new Set<string>()
  for (let i = 0; i < maxPages; i++) {
    const rows = await fetchTouchPage(i)
    for (const row of rows) {
      if (seenSet.has(row.contact_id)) continue
      seenSet.add(row.contact_id)
      seen.push(row.contact_id)
      if (seen.length >= need) return seen
    }
    if (rows.length < pageSize) break
  }
  return null
}
