import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BoardView, FatalBox, PageHeader } from '../_components/board-sections'
import type { PillarBlock, Board, BoardItem } from '@/lib/skill-cards/board'

function item(over: Partial<BoardItem>): BoardItem {
  return {
    cardId: 'c1',
    cardTitle: '标题一',
    key: 'k',
    text: '一句话',
    state: 'pm_decision',
    note: null,
    rule: null,
    handoff: null,
    owner: '74 号',
    verifyBy: '2026-10-01',
    ledgerStatus: null,
    overdue: false,
    verifiedPending: false,
    orphan: false,
    pillar: 'ads',
    ...over,
  }
}

function block(over: Partial<PillarBlock>): PillarBlock {
  return {
    pillar: 'ads',
    label: '广告 Agent',
    counts: { learning: 39, verifying: 21, pmDecision: 6, passed: 27, adopted: 0 },
    decisions: { shown: [], more: 0 },
    overdue: { shown: [], more: 0 },
    ...over,
  }
}

function board(pillars: PillarBlock[], over?: Partial<Board>): Board {
  return {
    fatal: null,
    groups: {
      learning: [],
      pm_decision: [],
      verifying: [],
      adopted: [],
      passed: [],
      already_in_me: [],
    },
    counts: { learning: 0, pmDecision: 0, verifying: 0, passed: 0, adopted: 0, alreadyInMe: 0 },
    issues: [],
    unorganized: [],
    cardCount: 3,
    pillars,
    ...over,
  }
}

function text(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

describe('PageHeader', () => {
  it('renders the title and the subtitle, without the deployment note', () => {
    const html = renderToStaticMarkup(<PageHeader />)
    expect(html).toContain('Agent 学习库')
    expect(html).toContain('各 Agent 学到的东西走到哪一步了；细节由 Agent 自己读笔记。')
    expect(html).not.toContain('数据来自线上部署')
  })
})

describe('BoardView', () => {
  it('renders both pillar blocks in order with their numbers', () => {
    const ads = block({})
    const seo = block({
      pillar: 'seo',
      label: 'SEO Agent',
      counts: { learning: 2, verifying: 0, pmDecision: 0, passed: 0, adopted: 0 },
    })
    const html = renderToStaticMarkup(<BoardView board={board([ads, seo])} />)
    const adsIdx = html.indexOf('广告 Agent')
    const seoIdx = html.indexOf('SEO Agent')
    expect(adsIdx).toBeGreaterThanOrEqual(0)
    expect(seoIdx).toBeGreaterThan(adsIdx)
    expect(html).toContain('学习中')
    expect(html).toContain('待验证')
    expect(html).toContain('等你拍板')
    expect(html).toContain('39')
    expect(html).toContain('21')
    expect(html).toContain('6')
    expect(text(html)).toContain('已放弃 27 · 已写进规则 0')
  })

  it('lists decision items under 等你拍板的 and hides empty sections', () => {
    const withDecision = block({
      decisions: { shown: [item({ text: 'AAA决策点' })], more: 0 },
    })
    const html = renderToStaticMarkup(<BoardView board={board([withDecision])} />)
    expect(html).toContain('等你拍板的')
    expect(html).toContain('AAA决策点')

    const empty = block({})
    const emptyHtml = renderToStaticMarkup(<BoardView board={board([empty])} />)
    expect(emptyHtml).not.toContain('等你拍板的')
    expect(emptyHtml).not.toContain('验证已过期的')
  })

  it('lists overdue items under 验证已过期的', () => {
    const b = block({
      overdue: {
        shown: [item({ text: 'BBB过期点', overdue: true, state: 'verifying' })],
        more: 0,
      },
    })
    const html = renderToStaticMarkup(<BoardView board={board([b])} />)
    expect(html).toContain('验证已过期的')
    expect(html).toContain('BBB过期点')
  })

  it('renders each row as one line with a link only', () => {
    const b = block({ decisions: { shown: [item({ rule: 'C-18', note: '备注内容XYZ' })], more: 0 } })
    const html = renderToStaticMarkup(<BoardView board={board([b])} />)
    expect(html).toContain(
      'href="https://github.com/bigbigraydeng-maker/magic-engine/blob/main/docs/skill-cards/c1.md"',
    )
    expect(html).toContain('标题一')
    expect(html).not.toContain('负责')
    expect(html).not.toContain('到期')
    expect(html).not.toContain('C-18')
    expect(html).not.toContain('备注内容XYZ')
    expect(html).not.toContain('74 号')
  })

  it('renders orphan items as a 交接卡 link', () => {
    const b = block({
      decisions: {
        shown: [item({ orphan: true, key: 'e-skill-handoff-1', cardId: '' })],
        more: 0,
      },
    })
    const html = renderToStaticMarkup(<BoardView board={board([b])} />)
    expect(html).toContain('交接卡')
    expect(html).toContain('e-skill-handoff-1.md')
  })

  it('shows the more line when items are cut off', () => {
    const b = block({ decisions: { shown: [item({})], more: 3 } })
    const html = renderToStaticMarkup(<BoardView board={board([b])} />)
    expect(text(html)).toContain('还有 3 条')
  })
})

describe('problem line', () => {
  it('shows the issue count and messages', () => {
    const b = board([block({})], {
      issues: [
        { level: 'error', cardId: 'c1', pointKey: 'k', message: 'MMM' },
        { level: 'warning', cardId: 'c1', pointKey: 'k', message: 'MMM' },
      ],
    })
    const html = renderToStaticMarkup(<BoardView board={b} />)
    expect(text(html)).toContain('数据对不上（2 条）')
  })

  it('hides the problem line when there are no problems', () => {
    const html = renderToStaticMarkup(<BoardView board={board([block({})])} />)
    expect(text(html)).not.toContain('数据对不上')
  })

  it('caps the shown rows and reports the remainder', () => {
    const unorganized = Array.from({ length: 8 }, (_, i) => ({
      file: `f${i + 1}.md`,
      reason: 'r',
    }))
    const html = renderToStaticMarkup(<BoardView board={board([block({})], { unorganized })} />)
    const t = text(html)
    expect(t).toContain('数据对不上（8 条）')
    expect(t).toContain('还有 3 条')
    expect(t).not.toContain('f6.md')
  })
})

describe('FatalBox', () => {
  it('renders the fatal heading and the message', () => {
    const html = renderToStaticMarkup(<FatalBox message="读文件失败" />)
    expect(html).toContain('学习库读不出来，先不显示数字')
    expect(html).toContain('读文件失败')
  })
})

describe('size guard', () => {
  it('keeps a realistic board under 1200 characters of text', () => {
    const decisions = Array.from({ length: 5 }, (_, i) =>
      item({ key: `d${i}`, text: '这是一个大约二十个字的决策点内容' }),
    )
    const overdue = Array.from({ length: 5 }, (_, i) =>
      item({ key: `o${i}`, text: '这是一个大约二十个字的过期点内容', overdue: true, state: 'verifying' }),
    )
    const b = block({
      decisions: { shown: decisions, more: 2 },
      overdue: { shown: overdue, more: 2 },
    })
    const html = renderToStaticMarkup(<BoardView board={board([b])} />)
    expect(text(html).length).toBeLessThan(1200)
  })
})
