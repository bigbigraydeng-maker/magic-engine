'use client'

/**
 * 「今天看这里」成绩单旁边要用的两样事实（只读，只给内部员工）：
 *  - 在投每天预算合计 vs 客户总上限：用「今日实时」那份官方账户读数（60 秒缓存）和 /ad-accounts 的客户总上限；
 *  - 哪些系列 / 广告组现在是停的：快照说「已停」、并且实时读数里没有列为在投，两边都同意才算停。
 *    快照最多晚 6 小时，刚重新打开的组不能被它藏掉「调预算」。
 *
 * 🔴 任何一步读不到（含 403）都回 null：调用方按「不知道」处理，不能当成「没停」或「没超」。
 */

import { useEffect, useState } from 'react'
import type { EntityTreeResult } from '@/lib/ads-strategy/entity-tree/load'
import type { LiveTodayView } from '@/lib/ads-strategy/heartbeat/live-view'
import { computeBudgetHeadroom, type BudgetHeadroom } from '@/lib/ads-strategy/heartbeat/budget-headroom'

export interface BudgetFacts {
  /** 确认已停的系列 / 广告组 id；读不到快照时为 null（不是空集合） */
  stoppedIds: ReadonlySet<string> | null
  headroom: BudgetHeadroom | null
  /** 实时读数的读取时间 */
  readAtIso: string | null
}

const UNKNOWN: BudgetFacts = { stoppedIds: null, headroom: null, readAtIso: null }

export function snapshotStoppedIds(tree: EntityTreeResult['tree']): Set<string> {
  const ids = new Set<string>()
  for (const c of tree.campaigns) {
    if (c.state === 'stopped') ids.add(c.id)
    for (const a of c.adsets) if (a.state === 'stopped') ids.add(a.id)
  }
  return ids
}

/** 快照说停、实时读数却列为在投的，不算停。live 读不到时只信快照。 */
export function confirmedStoppedIds(snapshotStopped: ReadonlySet<string>, live: LiveTodayView | null): Set<string> {
  const liveActive = new Set<string>()
  for (const acc of live?.accounts ?? []) for (const a of acc.active) liveActive.add(a.adsetId)
  return new Set([...snapshotStopped].filter(id => !liveActive.has(id)))
}

async function getJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

async function fetchTree(clientId: string): Promise<EntityTreeResult['tree'] | null> {
  const json = (await getJson(`/api/clients/${clientId}/ad-health/entities`)) as Partial<EntityTreeResult> | null
  return json?.tree ?? null
}

async function fetchLive(clientId: string): Promise<LiveTodayView | null> {
  const json = (await getJson(`/api/clients/${clientId}/ad-health/live`)) as { view?: LiveTodayView } | null
  return json?.view ?? null
}

async function fetchTotalCapCents(clientId: string): Promise<number | null> {
  const json = (await getJson(`/api/clients/${clientId}/ad-accounts`)) as { client_total_cap_cents?: unknown } | null
  return typeof json?.client_total_cap_cents === 'number' ? json.client_total_cap_cents : null
}

export function useBudgetFacts(clientId: string): BudgetFacts {
  const [facts, setFacts] = useState<BudgetFacts>(UNKNOWN)

  useEffect(() => {
    let alive = true
    Promise.all([fetchTree(clientId), fetchLive(clientId), fetchTotalCapCents(clientId)])
      .then(([tree, live, capCents]) => {
        if (!alive) return
        setFacts({
          stoppedIds: tree ? confirmedStoppedIds(snapshotStoppedIds(tree), live) : null,
          headroom: live ? computeBudgetHeadroom(live.accounts, capCents) : null,
          readAtIso: live?.readAtIso ?? null,
        })
      })
      .catch(() => { /* 读不到就保持「不知道」 */ })
    return () => { alive = false }
  }, [clientId])

  return facts
}
