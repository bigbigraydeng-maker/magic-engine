/**
 * presenter 是 PM 看到的每个字的源头 —— 这里钉住的是「会不会让 PM 判断反了」。
 * 每条对应设计双审的一条阻塞项(子牙 M2/M3/M4/M5/M10 · 板桥 M1/M2/M3/M5/M8)。
 */

import { describe, expect, it } from 'vitest'
import { buildProductMapSnapshot, MANUAL_FACTS_SNAPSHOT } from '../index'
import { buildPresentation, humaniseCeilingReason } from '../presenter'
import type { PresenterInput, SyncRunView } from '../presenter'

const NOW = new Date('2026-08-15T12:00:00Z')

function run(overrides: Partial<SyncRunView> = {}): SyncRunView {
  return {
    status: 'ok',
    mode: 'full',
    startedAt: '2026-08-15T09:00:00Z',
    finishedAt: '2026-08-15T09:01:00Z',
    errorMessage: null,
    failedItems: [],
    truncations: [],
    skippedStale: 0,
    ...overrides,
  }
}

function input(overrides: Partial<PresenterInput> = {}): PresenterInput {
  return {
    snapshot: buildProductMapSnapshot(MANUAL_FACTS_SNAPSHOT),
    loadOutcome: 'ok',
    latestRun: run(),
    lastFullRunAt: '2026-08-15T09:00:00Z',
    prFacts: [],
    issueFacts: [],
    unclassified: [],
    oldestObservedAt: '2026-08-15T09:00:00Z',
    now: NOW,
    ...overrides,
  }
}

describe('三堆分类:在不在跑 优先于 建到哪一步(板桥 M1/M2)', () => {
  it('legacy 且在运营 → 归「在生产干活」,不因成熟度封顶 M3 而降级', () => {
    const p = buildPresentation(input())
    const meta = p.components.find((c) => c.name.includes('Facebook'))
    expect(meta?.bucket).toBe('operating')
    expect(meta?.operationalLabel).toContain('在生产干活')
  })

  it('ME2 原生但没通电 → 归「建好了但没通电」,哪怕成熟度是 M4', () => {
    const p = buildPresentation(input())
    const store = p.components.find((c) => c.name.includes('存档'))
    expect(store?.maturityCode).toBe('M4_PRODUCTION_VALIDATED')
    expect(store?.bucket).toBe('built_not_live')
  })

  it('三堆之和 == 组件总数(不许有组件掉出统计)', () => {
    const p = buildPresentation(input())
    const sum = p.buckets.operating + p.buckets.built_not_live + p.buckets.building
    expect(sum).toBe(p.totalComponents)
    expect(p.totalComponents).toBeGreaterThanOrEqual(20)
  })

  it('legacy 件带常驻说明,防「分低=没干活」误读', () => {
    const p = buildPresentation(input())
    const legacy = p.components.filter((c) => c.isLegacy)
    expect(legacy.length).toBeGreaterThan(0)
    for (const c of legacy) expect(c.legacyNote).toContain('不代表没在干活')
  })
})

describe('分组守恒(子牙 M10):按互斥的业务线分,不按可多选的阶段', () => {
  it('各泳道求和 == 总数', () => {
    const p = buildPresentation(input())
    const sum = p.lanes.reduce((n, l) => n + l.components.length, 0)
    expect(sum).toBe(p.totalComponents)
  })
})

describe('coverageGap:同步没覆盖到 ≠ 活儿没干完(子牙 M3)', () => {
  it('登记册引用的 PR 没被同步到 → 标记缺口,不静默', () => {
    const p = buildPresentation(
      input({
        prFacts: [{ number: 863, state: 'merged', isDraft: false, unresolvedThreads: 0, title: 'x' }],
      }),
    )
    expect(p.trust.coverageGapPrs.length).toBeGreaterThan(0)
    expect(p.trust.coverageGapPrs).not.toContain(863)
    const affected = p.components.filter((c) => c.coverageGapPrs.length > 0)
    expect(affected.length).toBeGreaterThan(0)
  })

  it('同步没开通时不报缺口(那是「还没同步」,不是「没覆盖到」)', () => {
    const p = buildPresentation(input({ loadOutcome: 'not_provisioned', prFacts: [] }))
    expect(p.trust.coverageGapPrs).toEqual([])
  })

  it('PR 没同步到时,状态显示「没同步到」而不是「已关闭」之类的臆断', () => {
    const p = buildPresentation(
      input({
        prFacts: [{ number: 863, state: 'merged', isDraft: false, unresolvedThreads: 0, title: 'x' }],
      }),
    )
    const withGap = p.components.find((c) => c.coverageGapPrs.length > 0)
    expect(withGap?.linkedPrs.some((pr) => pr.stateLabel === '没同步到')).toBe(true)
  })
})

describe('可信度结论(板桥 S7 + 子牙 M2 两轴分离)', () => {
  it('未 provision → 明说同步没开通,不说「同步结果为空」', () => {
    const p = buildPresentation(input({ loadOutcome: 'not_provisioned', latestRun: null }))
    expect(p.trust.verdict).toContain('同步还没开通')
    expect(p.trust.health).toBe('unknown')
  })

  it('同步开着但零行 → never_synced,同样明说', () => {
    const p = buildPresentation(input({ loadOutcome: 'never_synced', latestRun: null }))
    expect(p.trust.verdict).toContain('一次都没跑过')
  })

  it('partial 轮 → 给结论(别照着做合并决定),不是状态词', () => {
    const p = buildPresentation(input({ latestRun: run({ status: 'partial' }) }))
    expect(p.trust.health).toBe('partial')
    expect(p.trust.verdict).toContain('没拉全')
  })

  it('只跑过 targeted(无全量)→ 不许冒充「刚全量核对过」', () => {
    const p = buildPresentation(input({ latestRun: run({ mode: 'targeted' }), lastFullRunAt: null }))
    expect(p.trust.health).toBe('unknown')
    expect(p.trust.verdict).toContain('还没做过完整核对')
  })

  it('全量轮超过 26 小时 → stale', () => {
    const p = buildPresentation(input({ lastFullRunAt: '2026-08-13T09:00:00Z' }))
    expect(p.trust.health).toBe('stale')
  })

  it('latestRun 为 null 但载入 ok → unknown,不许默认显示成一切正常', () => {
    const p = buildPresentation(input({ latestRun: null }))
    expect(p.trust.health).toBe('unknown')
    expect(p.trust.verdict).not.toContain('可以照着这页做决定')
  })

  it('鲜度取最旧那条并说人话', () => {
    const p = buildPresentation(input({ oldestObservedAt: '2026-08-13T09:00:00Z' }))
    expect(p.trust.freshnessText).toMatch(/天没更新/)
  })

  it('24 小时内说「X 小时前」,不用日历日 —— NZ 上午刚同步不许写成「昨天」', () => {
    // now = 2026-08-15T12:00Z(NZ 已是 16 日),数据 3 小时前同步
    const fresh = buildPresentation(input({ oldestObservedAt: '2026-08-15T09:00:00Z' }))
    expect(fresh.trust.freshnessText).toBe('数据是 3 小时前同步的')
    expect(fresh.trust.freshnessText).not.toContain('昨天')
  })

  it('数据来源三态都翻成人话', () => {
    const p = buildPresentation(input())
    expect(p.trust.factsSourceLabel).toContain('人工登记')
  })
})

describe('id 绝不出渲染层(板桥 M8:id 里带真实供应商名)', () => {
  it('输出里不含 dataforseo / publer / openai 等供应商名', () => {
    const p = buildPresentation(input())
    const json = JSON.stringify(p)
    for (const vendor of ['dataforseo', 'publer', 'openai', 'DataForSEO', 'Publer', 'OpenAI']) {
      expect(json).not.toContain(vendor)
    }
  })

  it('组件对外只有不可读 key', () => {
    const p = buildPresentation(input())
    for (const c of p.components) expect(c.key).toMatch(/^c\d+$/)
  })

  it('依赖图节点、检索目录都不漏 id(填了事实也不漏)', () => {
    const p = buildPresentation(
      input({
        prFacts: [{ number: 863, state: 'merged', isDraft: false, unresolvedThreads: 0, title: 't' }],
        issueFacts: [{ number: 859, state: 'closed', title: 't' }],
      }),
    )
    for (const n of p.graph.nodes) expect(n.key).toMatch(/^c\d+$/)
    const json = JSON.stringify({ graph: p.graph, catalog: p.catalog })
    expect(json).not.toContain('platform.execution-kernel')
    for (const vendor of ['dataforseo', 'publer', 'openai']) expect(json).not.toContain(vendor)
  })
})

describe('全局依赖图(谁垫着谁:横轴=先后)', () => {
  const nodeByName = (p: ReturnType<typeof buildPresentation>, needle: string) =>
    p.graph.nodes.find((n) => n.name.includes(needle))

  it('地基件 depth=0,依赖它的更深(按值锁分层)', () => {
    const p = buildPresentation(input())
    expect(nodeByName(p, '执行内核')?.depth).toBe(0) // 零依赖 = 地基
    expect(nodeByName(p, '动作名字对表')?.depth).toBe(1) // requires 内核
    expect(nodeByName(p, 'GEO 分析脑')?.depth).toBe(3) // 契约/存储/执行叠三层
  })

  it('边方向是 上游 → 下游:内核 → 动作名字对表', () => {
    const p = buildPresentation(input())
    const kernel = nodeByName(p, '执行内核')!
    const bridge = nodeByName(p, '动作名字对表')!
    const edge = p.graph.edges.find((e) => e.fromKey === kernel.key && e.toKey === bridge.key)
    expect(edge).toBeDefined()
    expect(edge?.typeLabel).toBe('必须先有')
  })

  it('孤立件(无上下游)显式标 isolated,不默认无依赖', () => {
    const p = buildPresentation(input())
    expect(nodeByName(p, 'SEO 诊断')?.isolated).toBe(true) // 无依赖也无人依赖它
    expect(nodeByName(p, '执行内核')?.isolated).toBe(false) // 被多件依赖
  })
})

describe('检索目录(catalog:issue/PR 反查组件,标题来自同步)', () => {
  it('PR 标题落到正确的组件名下(按值锁 join,不只看长度)', () => {
    const p = buildPresentation(
      input({
        prFacts: [
          { number: 863, state: 'merged', isDraft: false, unresolvedThreads: 0, title: '内核 PR 真标题' },
        ],
      }),
    )
    const pr = p.catalog.find((c) => c.kind === 'pr' && c.number === 863)
    expect(pr?.title).toBe('内核 PR 真标题')
    expect(pr?.stateLabel).toBe('已合并')
    const names = pr!.components.map((c) => c.name)
    // #863 同时挂 执行内核 与「把博客草稿打包成能发的成品」—— join 必须两个都在
    expect(names.some((n) => n.includes('执行内核'))).toBe(true)
    expect(names.some((n) => n.includes('打包成能发'))).toBe(true)
  })

  it('Issue 关闭必带「≠已上线」(复用同一映射,不另造词)', () => {
    const p = buildPresentation(input({ issueFacts: [{ number: 859, state: 'closed', title: 'x' }] }))
    const iss = p.catalog.find((c) => c.kind === 'issue' && c.number === 859)
    expect(iss?.stateLabel).toBe('已关闭(≠已上线)')
  })

  it('同步没开通 → catalog 为空(而不是编造条目)', () => {
    const p = buildPresentation(input({ prFacts: [], issueFacts: [] }))
    expect(p.catalog).toHaveLength(0)
  })
})

describe('ceilingReason 说人话(子牙 M5 + 板桥 M4)', () => {
  it('黑话逐条翻译', () => {
    expect(humaniseCeilingReason('止步 M1_CONTRACT_FROZEN:缺 merged 的 implements PR')).toBe(
      '交付它的代码还没合进主干',
    )
    // legacy 专属判据必须优先命中 —— 否则天天在生产干活的老系统会被写成「还没跑过」
    expect(
      humaniseCeilingReason('止步 M3_INTEGRATED:缺可审计的生产执行证据(legacy 件不进 ME2 M4)'),
    ).toContain('老系统不按新标准计分')
    expect(humaniseCeilingReason('止步 M3_INTEGRATED:缺可审计的生产执行证据')).toBe(
      '还没在真客户身上跑过一次',
    )
    expect(humaniseCeilingReason('全部证据齐')).toBe('证据齐了')
  })

  it('每个组件都带翻译后的卡点原因', () => {
    const p = buildPresentation(input())
    for (const c of p.components) expect(c.ceilingReasonHuman.length).toBeGreaterThan(0)
  })
})

describe('待拍板拆两栏(板桥 M5)', () => {
  it('被上游卡住的决策进「条件到了会来找你」,不混进「现在等你一句话」', () => {
    const p = buildPresentation(input())
    expect(p.decisionsNow.length + p.decisionsLater.length).toBeGreaterThan(0)
    // GEO 分析脑要等页面清单 → 必须在 later
    const geoLater = p.decisionsLater.some((d) => d.componentName.includes('GEO 分析脑'))
    expect(geoLater).toBe(true)
    expect(p.decisionsNow.some((d) => d.componentName.includes('GEO 分析脑'))).toBe(false)
  })

  it('每条决策都有直达链接;PR 类决策带未解决线程数(有同步事实时)', () => {
    const p = buildPresentation(
      input({
        prFacts: [{ number: 962, state: 'open', isDraft: true, unresolvedThreads: 3, title: 'x' }],
      }),
    )
    for (const d of [...p.decisionsNow, ...p.decisionsLater]) {
      expect(d.links.length).toBeGreaterThan(0)
    }
    const merge = [...p.decisionsNow, ...p.decisionsLater].find((d) => d.kindLabel === '要不要合代码')
    expect(merge?.unresolvedThreads).toBe(3)
  })

  it('决策文案回答「不做会怎样」(不是光一句 go)', () => {
    const p = buildPresentation(input())
    const all = [...p.decisionsNow, ...p.decisionsLater]
    expect(all.every((d) => d.decision.length > 30)).toBe(true)
  })
})

describe('其它必须露头的事实', () => {
  it('Issue「已关闭」必须带「≠已上线」提醒(子牙 M9)', () => {
    const p = buildPresentation(
      input({ issueFacts: [{ number: 859, state: 'closed', title: 'x' }] }),
    )
    const withIssue = p.components.find((c) => c.linkedIssues.some((i) => i.number === 859))
    expect(withIssue?.linkedIssues.find((i) => i.number === 859)?.stateLabel).toContain('≠已上线')
  })

  it('登记册自检 errors / warnings 都有落点(子牙 M6)', () => {
    const p = buildPresentation(input())
    expect(Array.isArray(p.trust.registryErrors)).toBe(true)
    expect(Array.isArray(p.trust.registryWarnings)).toBe(true)
  })

  it('被卡住 = 自身 blocker 或被上游传导', () => {
    const p = buildPresentation(input())
    expect(p.blocked.length).toBeGreaterThan(0)
    for (const c of p.blocked) {
      expect(c.blockers.length > 0 || c.blockedByUpstream.length > 0).toBe(true)
    }
  })

  it('M4+ 且仅手工证据 → 逐行标未核验;其余不标(不许满屏黄标)', () => {
    const p = buildPresentation(input())
    const flagged = p.components.filter((c) => c.evidenceUnverified)
    expect(flagged.length).toBeGreaterThan(0)
    expect(flagged.length).toBeLessThan(p.totalComponents / 2)
  })

  it('blocker 的类型翻成人话(卡在哪一类)', () => {
    const p = buildPresentation(input())
    const withBlocker = p.components.find((c) => c.blockers.length > 0)
    expect(withBlocker?.blockers[0].kindLabel).not.toMatch(/^[a-z_]+$/)
  })
})
