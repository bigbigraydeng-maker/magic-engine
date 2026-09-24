/**
 * 编排：把一个客户的线索按路线分流、判重、追加进各自的 Google 表格。
 *
 * 纪律（跟 `meta/leads-sync.ts` 同一套，不另立规矩）：
 *   · **先读后写** —— 每条路线先把目标表现有的行读回来算判重键，再决定写什么。
 *     重跑不会写出第二行；跟别的管道（客户自己的 Zapier/Make、人手粘贴）
 *     往同一张表里写也不会互相写重。
 *   · **只追加** —— 一个已有单元格都不碰（见 `google-sheets/client.ts`）。
 *   · **一条路线炸了不牵连另一条** —— 错误记进那条路线的回执，继续跑下一条。
 *   · **失败要说人话** —— 原话带进回执，调用方据此下发人工待办。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { appendSheetValues, readSheetValues } from '@/lib/google-sheets/client'
import { loadClientRoutes } from './config'
import { loadLeadsSince } from './leads'
import { buildRow, dedupKeys, emptyNotes } from './row'
import { isWithinBackfillWindow, pickRoute } from './route-match'
import type { LeadRecord, LeadSheetClientReceipt, LeadSheetRoute, LeadSheetRouteReceipt } from './types'

/**
 * tab 名按 A1 记法转义。
 *
 * 🔴 名字里有空格（`FB 表单 2026`）或单引号时必须加引号，否则 Sheets 回 400，
 *    这条路线**永远**失败 —— 而待办里给出的说法会是「表是不是被改名了」，
 *    方向完全错。现在两个 tab 叫 Untitled / Sheet1 碰巧没事，配第三个就撞上。
 */
function quoteTab(tabName: string): string {
  return `'${tabName.replace(/'/g, "''")}'`
}

/** 读整张表用的范围。列到 ZZ 够宽，行不设上限。 */
function fullRange(tabName: string): string {
  return `${quoteTab(tabName)}!A:ZZ`
}

/** 追加用的范围。同上 —— Sheets 会自己找到最后一行。 */
function appendRange(tabName: string): string {
  return `${quoteTab(tabName)}!A:ZZ`
}

export interface SyncDeps {
  readSheet?: typeof readSheetValues
  appendSheet?: typeof appendSheetValues
  /** true = 只算不写。用来在真开闸之前把「会写什么」摆给人看。 */
  dryRun?: boolean
}

function emptyRouteReceipt(route: LeadSheetRoute): LeadSheetRouteReceipt {
  return {
    routeKey: route.routeKey,
    spreadsheetId: route.spreadsheetId,
    tabName: route.tabName,
    matched: 0,
    alreadyPresent: 0,
    skippedNoIdentity: 0,
    skippedLeadIds: [],
    appended: 0,
    appendedLeadIds: [],
    outsideWindow: 0,
    unmappedValues: [],
    blankedFields: [],
    error: null,
  }
}

/** 一条路线：读表 → 判重 → 追加。永不抛异常，错误进回执。 */
export async function syncOneRoute(
  clientId: string,
  route: LeadSheetRoute,
  leads: readonly LeadRecord[],
  deps: SyncDeps = {},
): Promise<LeadSheetRouteReceipt> {
  const read = deps.readSheet ?? readSheetValues
  const append = deps.appendSheet ?? appendSheetValues
  const receipt = emptyRouteReceipt(route)

  const inWindow: LeadRecord[] = []
  for (const lead of leads) {
    if (isWithinBackfillWindow(lead, route)) inWindow.push(lead)
    else receipt.outsideWindow++
  }
  receipt.matched = inWindow.length
  if (inWindow.length === 0) return receipt

  let existing: string[][]
  try {
    // 🔴 必须按「人看到的文本」读，不能按原始值读 —— 判重要跟人手填的行对上。
    //    用 unformatted 的话日期列回来是 46289.411… 这种序列号，永远对不上（实测）。
    existing = await read(clientId, route.spreadsheetId, fullRange(route.tabName), {
      render: 'formatted',
    })
  } catch (err) {
    // 🔴 读不到已有行就**什么都不写**。看不见表里有什么却照写不误 = 写一堆重复行，
    //    而重复行在这种表上是不可逆的（人会在上面手工标注跟进）。
    receipt.error = `读目标表格失败，本轮一行都没写：${err instanceof Error ? err.message : String(err)}`
    return receipt
  }

  const idCol = route.dedupIdColumn ?? undefined
  // 表里每一行贡献它**全部**能算出来的键：老行只有身份键，我们以前写的行两把都有。
  const present = new Set<string>()
  for (const row of existing) {
    for (const key of dedupKeys(row, route.dedupColumns, idCol)) present.add(key)
  }

  const notes = emptyNotes()
  const toAppend: string[][] = []
  const toAppendLeadIds: string[] = []
  // 同一轮里两条线索算出同一把键（例如同一个人同一分钟填了两次）也只写一条。
  const seenThisRun = new Set<string>()

  for (const lead of inWindow) {
    const cells = buildRow(lead, route, notes)
    const keys = dedupKeys(cells, route.dedupColumns, idCol)
    if (keys.length === 0) {
      /**
       * 判重键拼不出来 = 这条线索在这张表里没有可比的身份。写进去就再也认不出
       * 是谁、也去不掉，所以跳过。
       *
       * 🔴 但**必须按条计数 + 记下 lead id**：这些是真的没进销售手里的线索。
       *    早先只往 `blankedFields` 里塞一个词，会被去重成一个元素 —— 条数和
       *    是哪几条全丢了，人工待办那边也读不到，等于又一次「死在日志里」。
       */
      receipt.skippedNoIdentity++
      receipt.skippedLeadIds.push(lead.leadId)
      continue
    }
    // 🔴 **任一把键撞上就算已经有了**：机器键认我们自己写过的行，
    //    身份键认人手填的 / 外部管道写的老行。少一边就会写重复。
    if (keys.some((k) => present.has(k) || seenThisRun.has(k))) {
      receipt.alreadyPresent++
      continue
    }
    for (const k of keys) seenThisRun.add(k)
    toAppend.push(cells)
    toAppendLeadIds.push(lead.leadId)
  }

  receipt.unmappedValues = [...new Set(notes.unmappedValues)].sort()
  receipt.blankedFields = [...new Set([...receipt.blankedFields, ...notes.blankedFields])].sort()

  if (toAppend.length === 0) return receipt

  if (deps.dryRun) {
    // 只算不写：回执如实说「本来要写这几条」，但 appended 保持 0 —— 不能让
    // 试算看起来像写成功了。
    receipt.appendedLeadIds = toAppendLeadIds
    return receipt
  }

  try {
    const written = await append(clientId, route.spreadsheetId, appendRange(route.tabName), toAppend)
    receipt.appended = written
    if (written === toAppend.length) {
      receipt.appendedLeadIds = toAppendLeadIds
    } else {
      /**
       * 🔴 只写进去一部分时**不能**把全部 lead id 都说成写了。
       *    这个列表存在的理由就是「出事时能直接回查是哪几条」——
       *    在最需要它的那一刻撒谎，比没有这个字段还糟。
       *    Sheets 不告诉我们是哪几行成了，所以这里如实留空。
       */
      receipt.appendedLeadIds = []
      receipt.error =
        `打算写 ${toAppend.length} 行，Sheets 只认了 ${written} 行 —— 有一部分没写进去；` +
        `Sheets 没说是哪几行成了，所以这次不报 lead id（下一轮判重会把漏的补上）`
    }
  } catch (err) {
    receipt.error = `写目标表格失败：${err instanceof Error ? err.message : String(err)}`
  }

  return receipt
}

/** 一个客户：读配置 → 取线索 → 逐条路线跑。永不抛异常。 */
export async function syncClientLeadSheets(
  supabase: SupabaseClient,
  client: { id: string; name: string | null },
  deps: SyncDeps = {},
): Promise<LeadSheetClientReceipt> {
  const receipt: LeadSheetClientReceipt = {
    clientId: client.id,
    clientName: client.name,
    routes: [],
    unrouted: 0,
    error: null,
  }

  let routes: LeadSheetRoute[]
  try {
    const loaded = await loadClientRoutes(supabase, client.id)
    routes = loaded.routes
    if (loaded.invalid.length > 0) {
      /**
       * 🔴 **一条路线坏了，整个客户这轮停手，一行都不写。**
       *
       * 不能只跳过坏掉的那条继续跑 —— `pickRoute` 看不见被跳过的路线，
       * 本该走它的线索会**掉进兜底路线**，被追加进错的那张表。追加不可逆；
       * 等配置修好，这些线索又会被写进正确的表一遍 —— 同一个人两张表都有，
       * 而两轮的回执都显示"成功"。
       *
       * 配置手误的正确代价是"今天没同步 + 待办里喊一声"，不是"写进错的表"。
       */
      receipt.error =
        `路线配置有 ${loaded.invalid.length} 条读不出来，本轮整个客户停手、一行都没写（` +
        `怕命中坏掉那条路线的线索掉进兜底表）：` +
        loaded.invalid.map((i) => i.reason).join(' | ')
      return receipt
    }
  } catch (err) {
    receipt.error = err instanceof Error ? err.message : String(err)
    return receipt
  }
  if (routes.length === 0) return receipt

  /**
   * 取数窗口 = 所有路线里最早的那个。某条路线没设窗口就等于要全部。
   *
   * 🔴 **按时间比，不按字符串比**。`'2026-09-24T00:00:00+12:00'` 字典序排在
   *    `'2026-09-20T12:00:00+00:00'` 后面，可偏移量不同的两个串比字典序会得出
   *    跟真实先后相反的结论 —— 窗口算晚了就是静默漏线索。
   */
  const since = routes.some((r) => !r.backfillSince)
    ? null
    : new Date(
        Math.min(...routes.map((r) => Date.parse(r.backfillSince as string))),
      ).toISOString()

  let leads: LeadRecord[]
  try {
    leads = await loadLeadsSince(supabase, client.id, since)
  } catch (err) {
    receipt.error = [receipt.error, `取线索失败：${err instanceof Error ? err.message : String(err)}`]
      .filter(Boolean)
      .join(' | ')
    return receipt
  }

  const byRoute = new Map<string, LeadRecord[]>()
  for (const lead of leads) {
    const route = pickRoute(lead, routes)
    if (!route) {
      receipt.unrouted++
      continue
    }
    const bucket = byRoute.get(route.routeKey)
    if (bucket) bucket.push(lead)
    else byRoute.set(route.routeKey, [lead])
  }

  for (const route of routes) {
    // 没分到线索的路线也出一条回执 —— 「这条路线今天 0 条」和「这条路线没跑」
    // 必须分得开。
    receipt.routes.push(
      await syncOneRoute(client.id, route, byRoute.get(route.routeKey) ?? [], deps),
    )
  }

  return receipt
}
