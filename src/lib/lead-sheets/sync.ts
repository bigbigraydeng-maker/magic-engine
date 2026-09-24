/**
 * 编排：把一个客户的线索按路线分流、判重、追加进各自的 Google 表格。
 *
 * 纪律（跟 `meta/leads-sync.ts` 同一套，不另立规矩）：
 *   · **先读后写** —— 先把目标表现有的行读回来算判重键，再决定写什么。
 *     重跑不会写出第二行；跟别的管道（客户自己的 Zapier/Make、人手粘贴）
 *     往同一张表里写也不会互相写重。
 *   · **同一张表只读一次** —— 几条路线写同一张表是常态（所有表单汇总进一张，
 *     用「来源表单」那一列区分），它们共用一份判重键集合，见 `DestinationSnapshot`。
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

/**
 * 同一张表（同一个 tab）在这一轮里的共享状态。
 *
 * 🔴 **为什么要共享**：PM 2026-09-24 拍板「所有表单汇总进一张表」之后，几条路线
 *    写同一张表成了常态。各读各的会出两个毛病：
 *      1. 同一张表读两遍，纯浪费（而且第二遍读到的内容取决于第一条路线写没写完，
 *         等于让判重结果跟路线顺序挂钩）。
 *      2. **试算模式下会多报**：第一条路线只算不写，第二条再读回来的还是老内容，
 *         两条路线上身份键相同的两个人会双双显示「会写」。真跑时不会重复（第二遍
 *         读得到第一条写进去的行），于是试算跟真跑对不上 —— 而试算存在的全部意义
 *         就是「先看清楚会写什么」。
 *
 *    共享一份键集合两个毛病一起没了：读一次，谁排进队列谁就把键加进去。
 *
 * 🔴 拿**第一条**路线的 dedup 配置去算已有行的键。这一点成立的前提是
 *    `config.ts::describeLayoutMismatch` 已经保证同一张表上的路线判重配置一致 ——
 *    两处是绑定的，改一边要看另一边。
 */
export interface DestinationSnapshot {
  /** 表里已有的 + 本轮已排进队列的判重键。 */
  keys: Set<string>
  /** 读过了没。第一条用到这张表的路线负责读。 */
  loaded: boolean
  /** 读表失败时的原话。非 null = 这张表上的路线这一轮全部停手。 */
  readError: string | null
}

export function newDestinationSnapshot(): DestinationSnapshot {
  return { keys: new Set(), loaded: false, readError: null }
}

/** 同一个 key = 同一张表的同一个 tab。 */
export function destinationKey(route: LeadSheetRoute): string {
  return `${route.spreadsheetId}\u0000${route.tabName}`
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
  /**
   * 同一张表上几条路线共用的键集合。不传就自己建一个（单条路线跑、脚本试算
   * 都是这个用法），行为跟以前完全一样。
   */
  snapshot: DestinationSnapshot = newDestinationSnapshot(),
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
  // 一条线索都没有就别读表 —— 同一张表上后面还有别的路线，谁先有活谁去读。
  if (inWindow.length === 0) return receipt

  const idCol = route.dedupIdColumn ?? undefined

  if (!snapshot.loaded) {
    snapshot.loaded = true
    try {
      // 🔴 必须按「人看到的文本」读，不能按原始值读 —— 判重要跟人手填的行对上。
      //    用 unformatted 的话日期列回来是 46289.411… 这种序列号，永远对不上（实测）。
      const existing = await read(clientId, route.spreadsheetId, fullRange(route.tabName), {
        render: 'formatted',
      })
      // 表里每一行贡献它**全部**能算出来的键：老行只有身份键，我们以前写的行两把都有。
      for (const row of existing) {
        for (const key of dedupKeys(row, route.dedupColumns, idCol)) snapshot.keys.add(key)
      }
    } catch (err) {
      // 🔴 读不到已有行就**什么都不写**。看不见表里有什么却照写不误 = 写一堆重复行，
      //    而重复行在这种表上是不可逆的（人会在上面手工标注跟进）。
      snapshot.readError = `读目标表格失败，本轮一行都没写：${err instanceof Error ? err.message : String(err)}`
    }
  }

  if (snapshot.readError) {
    // 同一张表上的每条路线都要在**自己的**回执里说这件事 —— 待办按路线下发，
    // 只记在第一条上的话，后面那几条看起来像「这轮 0 条、一切正常」。
    receipt.error = snapshot.readError
    return receipt
  }

  const present = snapshot.keys

  const notes = emptyNotes()
  const toAppend: string[][] = []
  const toAppendLeadIds: string[] = []

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
    /**
     * 🔴 **任一把键撞上就算已经有了**：机器键认我们自己写过的行，
     *    身份键认人手填的 / 外部管道写的老行。少一边就会写重复。
     *
     *    `present` 里除了表里已有的行，还有这一轮已经排进队列的行 —— 同一个人
     *    同一分钟填了两次、或者同一张表上另一条路线已经收了他，都只写一条。
     *
     *    排进队列就先占键（不等写成功）。代价是：万一前一条路线的追加失败了，
     *    同一张表上后一条路线里跟它撞键的那条会被当成「已有」跳过一轮。
     *    下一轮两边都会重新算，自己会追上 —— 反过来「等写成功再占键」会在
     *    追加成功但回执丢了的时候写出重复行，那个是不可逆的。
     */
    if (keys.some((k) => present.has(k))) {
      receipt.alreadyPresent++
      continue
    }
    for (const k of keys) present.add(k)
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

  /**
   * 同一张表（同一个 tab）上的几条路线共用一份快照：读一次、判重键互通。
   * `config.ts::describeLayoutMismatch` 已经保证同一张表上的路线判重配置一致，
   * 所以这份键集合对它们是同一把尺子。
   */
  const snapshots = new Map<string, DestinationSnapshot>()

  for (const route of routes) {
    const dest = destinationKey(route)
    let snapshot = snapshots.get(dest)
    if (!snapshot) {
      snapshot = newDestinationSnapshot()
      snapshots.set(dest, snapshot)
    }
    // 没分到线索的路线也出一条回执 —— 「这条路线今天 0 条」和「这条路线没跑」
    // 必须分得开。
    receipt.routes.push(
      await syncOneRoute(client.id, route, byRoute.get(route.routeKey) ?? [], deps, snapshot),
    )
  }

  return receipt
}
