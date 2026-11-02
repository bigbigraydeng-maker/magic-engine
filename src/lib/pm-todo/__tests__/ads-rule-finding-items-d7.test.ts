/**
 * D7（广告授权 / 数据 / 配置体检）→ 今日待办。
 *
 * D7 命中只带人工任务三件套（做什么 / 怎么做 / 链接），系统不会自己改授权和设置。
 * 以前它只进内部日报邮件和广告健康页，不进今日待办：2026-11-03 生产库里 4 个账户的
 * 「广告结果怎么算没设置」连着 29 天没人处理（"管道不许断头"，见 CLAUDE.md §3）。
 */
import { describe, expect, it } from 'vitest'
import { buildAdsRuleFindingItems, type GrowthStateRow, type RuleFinding } from '../ads-rule-finding-items'

const MONDAY = new Date('2026-11-02T06:00:00Z')
const SUNDAY = new Date('2026-11-01T06:00:00Z')

function d7(what: string, how: string, href: string | null = '/dashboard/clients/c1/settings'): RuleFinding {
  return {
    code: 'D7',
    status: 'hit',
    title: `D7 ${what}`,
    units: [{ level: 'account', id: 'c1', name: null }],
    reasons: ['内部提醒'],
    clientVisible: false,
    manualTask: { what, how, href },
  }
}

const OUTCOME_UNSET = d7('这个客户的领先结果 / 主结果 / 目标单次成本没设置。', '在客户设置页「广告结果怎么算」里选好两级结果、填目标单次成本。')

function d3(adsetId: string): RuleFinding {
  return {
    code: 'D3',
    status: 'hit',
    title: `D3 ${adsetId}`,
    units: [{ level: 'adset', id: adsetId, name: adsetId }],
    reasons: ['建议这样做'],
  }
}

/** 从 `last` 往回数 `days` 天，每天一行（最新在前）。 */
function daily(clientId: string, last: string, days: number, problems: RuleFinding[], completeness = 'complete'): GrowthStateRow[] {
  const out: GrowthStateRow[] = []
  const end = Date.parse(`${last}T00:00:00Z`)
  for (let i = 0; i < days; i++) {
    const date = new Date(end - i * 86_400_000).toISOString().slice(0, 10)
    out.push({ client_id: clientId, date, payload: { dataCompleteness: completeness, problems } })
  }
  return out
}

const nameOf = (id: string) => `name-${id}`

describe('D7 并入今日待办', () => {
  it('连着 2 天命中 → 出 1 条待办，三件套齐全，链接补成完整网址', () => {
    const items = buildAdsRuleFindingItems(daily('c1', '2026-11-01', 2, [OUTCOME_UNSET]), MONDAY, nameOf)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'ads_rule_finding',
      client_id: 'c1',
      client_name: 'name-c1',
      href: 'https://app.magicengine.com.au/dashboard/clients/c1/settings',
    })
    expect(items[0].what).toContain('目标单次成本没设置')
    expect(items[0].how).toContain('「广告结果怎么算」')
  })

  it('只命中 1 天 → 不出（多半是波动）', () => {
    expect(buildAdsRuleFindingItems(daily('c1', '2026-11-01', 1, [OUTCOME_UNSET]), MONDAY, nameOf)).toEqual([])
  })

  it('数据没拉全（partial）那天也照出：D7 就是专门报数据和配置坏了的', () => {
    const items = buildAdsRuleFindingItems(daily('c1', '2026-11-01', 3, [OUTCOME_UNSET], 'partial'), MONDAY, nameOf)
    expect(items).toHaveLength(1)
  })

  it('最新一行已经 7 天前 → 巡察自己停了，不拿旧结论说事', () => {
    const items = buildAdsRuleFindingItems(daily('c1', '2026-11-01', 5, [OUTCOME_UNSET]), new Date('2026-11-08T06:00:00Z'), nameOf)
    expect(items).toEqual([])
  })

  it('没有 manualTask 的 D7 不出（没有可下发的人工任务）', () => {
    const bare: RuleFinding = { ...OUTCOME_UNSET, manualTask: undefined }
    expect(buildAdsRuleFindingItems(daily('c1', '2026-11-01', 3, [bare]), MONDAY, nameOf)).toEqual([])
  })

  it('同一个客户有好几个 D7 → 仍然只出 1 条，每个任务都列出来，最多 3 个，其余写条数', () => {
    const many = [
      d7('任务甲', '怎么办甲', 'https://example.test/a'),
      d7('任务乙', '怎么办乙', '/dashboard/clients/c1/settings'),
      d7('任务丙', '怎么办丙', null),
      d7('任务丁', '怎么办丁', null),
    ]
    const items = buildAdsRuleFindingItems(daily('c1', '2026-11-01', 2, many), MONDAY, nameOf)
    expect(items).toHaveLength(1)
    for (const t of ['怎么办甲', '怎么办乙', '怎么办丙']) expect(items[0].how).toContain(t)
    expect(items[0].how).not.toContain('怎么办丁')
    expect(items[0].how).toContain('另有 1 条')
    expect(items[0].href).toBe('https://example.test/a')
  })

  it('没有链接的任务退回广告健康页', () => {
    const items = buildAdsRuleFindingItems(daily('c1', '2026-11-01', 2, [d7('任务', '怎么办', null)]), MONDAY, nameOf)
    expect(items[0].href).toBe('https://app.magicengine.com.au/dashboard/clients/c1/ads-health')
  })

  it('提醒节奏：连着 8 天，周一不提醒；周日提醒（头 3 天每天，之后只周日）', () => {
    expect(buildAdsRuleFindingItems(daily('c1', '2026-11-01', 8, [OUTCOME_UNSET]), MONDAY, nameOf)).toEqual([])
    expect(buildAdsRuleFindingItems(daily('c1', '2026-10-31', 8, [OUTCOME_UNSET]), SUNDAY, nameOf)).toHaveLength(1)
  })

  it('不同客户各出各的', () => {
    const rows = [...daily('c1', '2026-11-01', 2, [OUTCOME_UNSET]), ...daily('c2', '2026-11-01', 2, [OUTCOME_UNSET])]
    const items = buildAdsRuleFindingItems(rows, MONDAY, nameOf)
    expect(items.map((i) => i.client_id).sort()).toEqual(['c1', 'c2'])
  })

  it('跟 D3 待办互不影响：同一个客户两种问题就是两条', () => {
    const items = buildAdsRuleFindingItems(daily('c1', '2026-11-01', 2, [d3('as1'), OUTCOME_UNSET]), MONDAY, nameOf)
    expect(items).toHaveLength(2)
    expect(items.filter((i) => i.what.includes('目标单次成本没设置'))).toHaveLength(1)
    expect(items.filter((i) => i.what.includes('D3 as1'))).toHaveLength(1)
  })
})
