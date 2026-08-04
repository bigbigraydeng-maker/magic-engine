/**
 * 配置中心落在哪一组。
 *
 * 只有一条真的会伤到人：**授权回来时必须落在「接通」**。
 *
 * 商家页和邮箱授权完都会跳回配置中心并带上 `?mail=ok` / `?gbp=connected`，
 * 那条「✓ 连上了」的提示渲染在「接通」这一组里。落错组的话，人授权完看到的是
 * 一片跟他无关的东西 —— 他会以为没成功，然后重来一遍。
 *
 * 2026-08-03 这一整天在邮箱授权上来回了六七次，很大一部分就是「看不出成没成」。
 * 这一条不能再靠人眼去发现。
 */

import { describe, expect, it } from 'vitest'
import { pickInitialTab, SETTINGS_TABS } from '../SettingsTabs'

/** 把一组参数变成 pickInitialTab 要的读取函数。 */
const from = (params: Record<string, string>) => (k: string) => params[k] ?? null

describe('授权回来时落在「接通」', () => {
  it.each([
    ['mail', 'ok'],
    ['mail', 'admin_ok'],
    ['mail', 'error'],
    ['gbp', 'connected'],
    ['gbp', 'needs_location'],
    ['gbp', 'error'],
  ])('?%s=%s → 接通', (key, value) => {
    expect(pickInitialTab(from({ [key]: value }))).toBe('connect')
  })

  /**
   * 授权回跳**压过** `?tab=`。
   *
   * 人上次停在「客户资料」，地址栏里就留着 `tab=profile`；授权跳回来时两个参数
   * 会同时存在。这一刻他不是来挑页签的，是来看授权成没成的。
   */
  it('同时带着 tab= 和授权参数 → 仍然落在接通', () => {
    expect(pickInitialTab(from({ tab: 'profile', mail: 'ok' }))).toBe('connect')
    expect(pickInitialTab(from({ tab: 'content', gbp: 'error' }))).toBe('connect')
  })
})

describe('没有授权参数时', () => {
  it.each(SETTINGS_TABS.map((t) => t.key))('?tab=%s → 就去那一组', (key) => {
    expect(pickInitialTab(from({ tab: key }))).toBe(key)
  })

  it('什么都没带 → 接通（新客户最先要办的就是接通）', () => {
    expect(pickInitialTab(from({}))).toBe('connect')
  })

  /** 认不出的值不能让页面空着 —— 退回默认，不抛错。 */
  it.each([['profil'], ['CONNECT'], [''], ['<script>']])('认不出的 tab=%s → 退回接通', (bad) => {
    expect(pickInitialTab(from({ tab: bad }))).toBe('connect')
  })
})

describe('分组本身', () => {
  it('五组，键不重复', () => {
    const keys = SETTINGS_TABS.map((t) => t.key)
    expect(keys).toHaveLength(5)
    expect(new Set(keys).size).toBe(5)
  })

  /** 每组都要有一句人话说清是干什么的 —— 不写的话人还是要靠点开试。 */
  it('每组都有名字和一句说明', () => {
    for (const t of SETTINGS_TABS) {
      expect(t.label.trim()).not.toBe('')
      expect(t.hint.trim()).not.toBe('')
    }
  })
})
