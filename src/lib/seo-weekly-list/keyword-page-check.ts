/**
 * Pure confirmation step for one target keyword and the own pages that textually match it.
 *
 * The caller has already fetched each candidate page's own Google search queries (a free
 * Google read). This module uses those rows to CONFIRM which page really receives
 * impressions for the keyword, and to decide whether a human should look before the item
 * is written. No I/O, no async, never throws.
 */

import { tokenKey } from './candidates'
import type { PageQueryRow } from './ctr-diagnosis'

export interface KeywordPageInput {
  url: string
  queries: PageQueryRow[] | null
}

export interface RankingPage {
  url: string
  impressions: number
  clicks: number
  position: number
}

export type KeywordPageVerdict = 'proceed' | 'human_review'

export interface KeywordPageCheck {
  keyword: string
  /** Pages whose queries were actually read. */
  readablePages: number
  /** Pages whose queries could not be read (null). */
  unreadableUrls: string[]
  /** Pages with impressions for exactly this keyword (same tokenKey), highest impressions first. Confirmed by Google data. */
  ranking: RankingPage[]
  /** True when two or more own pages have impressions for this same keyword. */
  split: boolean
  verdict: KeywordPageVerdict
  /** Short plain-Chinese reasons, one per line, shown to the person. */
  reasons: string[]
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export function checkKeywordPages(keyword: string, pages: KeywordPageInput[]): KeywordPageCheck {
  const target = tokenKey(keyword)
  const unreadableUrls: string[] = []
  let readablePages = 0
  const ranking: RankingPage[] = []

  for (const page of pages) {
    if (page.queries === null) {
      unreadableUrls.push(page.url)
      continue
    }
    readablePages += 1
    let impressions = 0
    let clicks = 0
    let posWeighted = 0
    let posWeight = 0
    for (const row of page.queries) {
      if (tokenKey(row.query) !== target) continue
      const imp = row.impressions
      impressions += imp
      clicks += row.clicks
      if (imp > 0) {
        posWeighted += row.position * imp
        posWeight += imp
      }
    }
    if (impressions > 0) {
      ranking.push({
        url: page.url,
        impressions,
        clicks,
        position: posWeight > 0 ? round1(posWeighted / posWeight) : 0,
      })
    }
  }

  ranking.sort((a, b) => b.impressions - a.impressions)
  const split = ranking.length >= 2

  const reasons: string[] = []
  const noReadable = pages.length === 0 || readablePages === 0
  const proceed = readablePages >= 1 && unreadableUrls.length === 0 && ranking.length === 1

  if (proceed) {
    reasons.push('谷歌记录显示只有一个自家页在这个词上有曝光，可以直接按这页处理')
  } else {
    if (noReadable) {
      reasons.push('没能读到任何页面的搜索词，无法确认哪个自家页在排这个词，需要人看')
    }
    if (unreadableUrls.length > 0 && !noReadable) {
      reasons.push(`有 ${unreadableUrls.length} 个页面的搜索词没读到，结论不完整，需要人看`)
    }
    if (ranking.length === 0 && !noReadable) {
      reasons.push('读到了页面搜索词，但没有页面在这个词上有曝光（搜索词表只含排名靠前的词，不能证明站内没有），需要人看')
    }
    if (split) {
      reasons.push(`有 ${ranking.length} 个自家页都在这个词上有曝光（互相分食），先决定哪页当主页，需要人看`)
    }
  }

  return {
    keyword,
    readablePages,
    unreadableUrls,
    ranking,
    split,
    verdict: proceed ? 'proceed' : 'human_review',
    reasons,
  }
}
