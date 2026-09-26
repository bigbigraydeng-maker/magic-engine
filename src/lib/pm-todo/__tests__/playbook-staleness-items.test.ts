/**
 * `pushPlaybookStalenessItems()` 测试 —— 每周巡检写进
 * `playbook_staleness_findings` 的疑似过期引用，拉模式读出来汇总成待办条目。
 */
import { describe, expect, it, vi } from 'vitest'
import { pushPlaybookStalenessItems, PLAYBOOK_REGISTRY, PLAYBOOK_PATHS } from '../playbook-staleness-items'
import type { ManualItem } from '../manual-items'
import { assertAbsoluteHref } from '../manual-items'

type Row = Record<string, unknown>

function fakeSupabase(rows: Row[] | null, error: { message: string } | null = null) {
  return {
    from: vi.fn(() => ({
      select: () => ({
        order: () => ({
          order: () => ({
            range: () => Promise.resolve({ data: rows, error }),
          }),
        }),
      }),
    })),
  }
}

describe('PLAYBOOK_REGISTRY', () => {
  it('7 本手册都登记了，路径和白名单一一对应', () => {
    expect(PLAYBOOK_REGISTRY).toHaveLength(7)
    for (const p of PLAYBOOK_REGISTRY) {
      expect(PLAYBOOK_PATHS.has(p.path)).toBe(true)
    }
  })
})

describe('pushPlaybookStalenessItems', () => {
  it('一条疑似过期的引用 → 一条 DEV_OWNED 待办，what 里带手册名和原句，how 是核实步骤', async () => {
    const supabase = fakeSupabase([
      {
        playbook_name: 'SEO通用经验手册',
        playbook_path: 'playbook-seo-general.md',
        quoted_line: '封装在 src/lib/dataforseo/ 的 serp.ts — getSerpPage(query, ...)',
        reference_text: 'getSerpPage',
        suspected_reason: 'grep src/ 找不到这个函数了，像是改名或删掉了',
        how_to_verify: '在本地仓库执行 grep -rn "getSerpPage" src/ 确认还在不在；确实没了的话回一句「这条手册引用处理掉了」',
      },
    ])
    const items: ManualItem[] = []
    await pushPlaybookStalenessItems(supabase as never, items)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'playbook_reference_stale', client_id: 'infra' })
    expect(items[0].what).toContain('SEO通用经验手册')
    expect(items[0].what).toContain('getSerpPage')
    expect(items[0].how).toContain('回一句')
    expect(items[0].href).toBe('')
    // href 留空是这个 kind 的既定设计（见文件头注），走 assertAbsoluteHref 的允许分支
    expect(() => assertAbsoluteHref(items[0])).not.toThrow()
  })

  it('原句超长 → what 里截断，不把整段手册原文糊到待办邮件里', async () => {
    const longLine = 'x'.repeat(300)
    const supabase = fakeSupabase([
      {
        playbook_name: '社媒/内容视频工厂通用经验手册',
        playbook_path: 'playbook-social-general.md',
        quoted_line: longLine,
        reference_text: 'someFn',
        suspected_reason: '找不到了',
        how_to_verify: '去查一下',
      },
    ])
    const items: ManualItem[] = []
    await pushPlaybookStalenessItems(supabase as never, items)
    expect(items[0].what.length).toBeLessThan(longLine.length)
    expect(items[0].what).toContain('…')
  })

  it('没有任何疑似过期的引用 → 不生成待办（上周的线索这周没再点名，自己消失）', async () => {
    const supabase = fakeSupabase([])
    const items: ManualItem[] = []
    await pushPlaybookStalenessItems(supabase as never, items)
    expect(items).toHaveLength(0)
  })

  it('查询失败 → 抛错（由调用方 manual-items.ts 的 .catch() 兜底，不在这里吞掉）', async () => {
    const supabase = fakeSupabase(null, { message: '模拟故障' })
    const items: ManualItem[] = []
    await expect(pushPlaybookStalenessItems(supabase as never, items)).rejects.toThrow()
  })
})
