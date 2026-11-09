/**
 * 同一件串台只出一条（2026-09-25：「CTS 名下存着 oztop 的网址」和「CTS 与 oztop 的发布
 * 通道指向同一网址」在今日待办里是两条一模一样的红线）。按涉及的网址 / 账号合并；
 * 不同网址的两件串台照样两条。
 */

import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/clients/cross-client-audit', () => ({
  auditCrossClientLeaks: vi.fn(),
}))

import { auditCrossClientLeaks } from '@/lib/clients/cross-client-audit'
import { pushCrossClientItems } from '../manual-items'
import type { ManualItem } from '../manual-item-types'

const SITE = 'https://oztopbuildingsupplies.com.au'

describe('pushCrossClientItems —— 同一件串台合成一条', () => {
  it('同一个网址查出的两条合成一条，客户名和两种说法都保留', async () => {
    vi.mocked(auditCrossClientLeaks).mockResolvedValueOnce([
      { source: 'client_connectors.config', clients: ['CTS Tours NZ'], value: SITE, what: 'CTS 名下存着 oztop 的网址', severity: 'critical' },
      { source: 'client_connectors.config', clients: ['CTS Tours NZ', 'oztop'], value: `${SITE}/`, what: 'CTS 和 oztop 的发布通道指向同一个网站', severity: 'critical' },
    ])
    const items: ManualItem[] = []
    await pushCrossClientItems({} as SupabaseClient, items)
    expect(items).toHaveLength(1)
    expect(items[0].client_name).toBe('CTS Tours NZ / oztop')
    expect(items[0].what).toContain('CTS 名下存着 oztop 的网址')
    expect(items[0].what).toContain('发布通道指向同一个网站')
    expect(items[0].what.startsWith('🔴 客户资料串台：')).toBe(true)
  })

  it('不同网址 / 不同严重程度的不合', async () => {
    vi.mocked(auditCrossClientLeaks).mockResolvedValueOnce([
      { source: 'client_connectors.config', clients: ['A'], value: 'https://a.example', what: 'A 串台', severity: 'critical' },
      { source: 'client_connectors.config', clients: ['B'], value: 'https://b.example', what: 'B 串台', severity: 'critical' },
      { source: 'client_connectors.config', clients: ['X', 'Y'], value: 'act_1', what: '共用广告账户', severity: 'warning' },
    ])
    const items: ManualItem[] = []
    await pushCrossClientItems({} as SupabaseClient, items)
    expect(items).toHaveLength(3)
  })
})
