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
import { buildRow, dedupKey, emptyNotes, isUsableDedupKey } from './row'
import { isWithinBackfillWindow, pickRoute } from './route-match'
import type { LeadRecord, LeadSheetClientReceipt, LeadSheetRoute, LeadSheetRouteReceipt } from './types'

/** 读整张表用的范围。列到 ZZ 够宽，行不设上限。 */
function fullRange(tabName: string): string {
  return `${tabName}!A:ZZ`
}

/** 追加用的范围。同上 —— Sheets 会自己找到最后一行。 */
function appendRange(tabName: string): string {
  return `${tabName}!A:ZZ`
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

  const present = new Set<string>()
  for (const row of existing) {
    const key = dedupKey(row, route.dedupColumns)
    if (isUsableDedupKey(key)) present.add(key)
  }

  const notes = emptyNotes()
  const toAppend: string[][] = []
  const toAppendLeadIds: string[] = []
  // 同一轮里两条线索算出同一把键（例如同一个人同一分钟填了两次）也只写一条。
  const seenThisRun = new Set<string>()

  for (const lead of inWindow) {
    const cells = buildRow(lead, route, notes)
    const key = dedupKey(cells, route.dedupColumns)
    if (!isUsableDedupKey(key)) {
      // 判重键全空 = 这条线索连身份都拼不出来（没电话没邮箱没时间）。
      // 写进去就再也去不掉了，宁可跳过并在回执里留痕。
      receipt.blankedFields.push('dedup_key')
      continue
    }
    if (present.has(key) || seenThisRun.has(key)) {
      receipt.alreadyPresent++
      continue
    }
    seenThisRun.add(key)
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
    receipt.appendedLeadIds = toAppendLeadIds
    if (written !== toAppend.length) {
      receipt.error = `打算写 ${toAppend.length} 行，Sheets 只认了 ${written} 行 —— 有一部分没写进去`
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
      receipt.error = loaded.invalid.map((i) => i.reason).join(' | ')
    }
  } catch (err) {
    receipt.error = err instanceof Error ? err.message : String(err)
    return receipt
  }
  if (routes.length === 0) return receipt

  // 取数窗口 = 所有路线里最早的那个。某条路线没设窗口就等于要全部。
  const since = routes.some((r) => !r.backfillSince)
    ? null
    : routes
        .map((r) => r.backfillSince as string)
        .sort()[0]

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
