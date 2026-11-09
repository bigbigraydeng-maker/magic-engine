import { describe, expect, it } from 'vitest'
import { HOME_ENTRIES, homeEntryVisible, viewerFacts, type HomeEntry } from '../home-entries'

const client = viewerFacts('client-viewer', 'client-1', false)
const scoped = viewerFacts('admin', 'client-1', true)
const domainAdmin = viewerFacts('admin', null, false)
const exactAdmin = viewerFacts('admin', null, true)

function hidden(facts: ReturnType<typeof viewerFacts>): HomeEntry[] {
  return HOME_ENTRIES.filter((entry) => !homeEntryVisible(facts, entry))
}

describe('客户首页入口', () => {
  it('both/dashboard 客户看不到内部入口', () => {
    expect(hidden(client)).toEqual([...HOME_ENTRIES])
    expect(homeEntryVisible(client, 'story')).toBe(false)
    expect(homeEntryVisible(client, 'memory')).toBe(false)
    expect(homeEntryVisible(client, 'week-overview')).toBe(false)
  })

  it('受限内部账号看得到记忆和日志，看不到 Story、本周总览和会跳走的平台入口', () => {
    expect(homeEntryVisible(scoped, 'memory')).toBe(true)
    expect(homeEntryVisible(scoped, 'work-logs')).toBe(true)
    expect(homeEntryVisible(scoped, 'story')).toBe(false)
    expect(homeEntryVisible(scoped, 'week-overview')).toBe(false)
    expect(homeEntryVisible(scoped, 'reels')).toBe(false)
    expect(homeEntryVisible(scoped, 'factory')).toBe(false)
    expect(homeEntryVisible(scoped, 'business-calculator')).toBe(false)
  })

  it('只有域名、不在精确名单里的管理员打不开 Story', () => {
    expect(homeEntryVisible(domainAdmin, 'story')).toBe(false)
    expect(homeEntryVisible(domainAdmin, 'week-overview')).toBe(false)
    expect(homeEntryVisible(domainAdmin, 'reels')).toBe(false)
    expect(homeEntryVisible(domainAdmin, 'factory')).toBe(true)
    expect(homeEntryVisible(domainAdmin, 'memory')).toBe(true)
  })

  it('精确管理员名单仍看得到全部入口', () => {
    expect(hidden(exactAdmin)).toEqual([])
  })
})
