/**
 * 「今天要联系」旧网址（2026-09-28 WP-B6 删掉整页、改成跳转）。
 *
 * 钉住的是「跳去哪」，不是 404——今日待办邮件、旧书签万一还留着这个网址，
 * 点进来要能到「全部客人」，`?contact=` 要原样带过去（那一页的直达链接靠这个）。
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`)
  },
}))

import CrmTodayRedirectPage from '../page'

describe('CrmTodayRedirectPage', () => {
  it('没有查询参数 → 跳到 /crm/all，不带 ?', () => {
    expect(() =>
      CrmTodayRedirectPage({ params: { id: 'cts' }, searchParams: {} }),
    ).toThrow('REDIRECT:/dashboard/clients/cts/crm/all')
  })

  it('?contact=<id> 原样带过去——「全部客人」的直达链接靠这个参数', () => {
    expect(() =>
      CrmTodayRedirectPage({ params: { id: 'cts' }, searchParams: { contact: 'c1' } }),
    ).toThrow('REDIRECT:/dashboard/clients/cts/crm/all?contact=c1')
  })

  it('多个参数、数组值（Next 允许 searchParams 是 string[]）都不炸，只转发字符串值', () => {
    expect(() =>
      CrmTodayRedirectPage({
        params: { id: 'cts' },
        searchParams: { contact: 'c1', stage: ['a', 'b'] },
      }),
    ).toThrow('REDIRECT:/dashboard/clients/cts/crm/all?contact=c1')
  })
})
