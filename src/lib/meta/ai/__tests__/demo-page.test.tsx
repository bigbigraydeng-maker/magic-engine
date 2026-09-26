import { render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import ReportView from '@/app/meta-ads-ai/[clientId]/ReportView'
import DemoPage from '@/app/meta-ads-ai/demo/page'
import { demoAnalysis } from '@/app/meta-ads-ai/demo/sample'

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 400 })
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 800, height: 400, top: 0, left: 0, right: 800, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }),
  })
})

const TODAY = '2026-10-10'

describe('demoAnalysis', () => {
  it('uses the 7 complete days ending yesterday', () => {
    const analysis = demoAnalysis(TODAY)
    expect(analysis.window_since).toBe('2026-10-03')
    expect(analysis.window_until).toBe('2026-10-09')
  })

  it('builds two rule cards and replaces the third section', () => {
    const analysis = demoAnalysis(TODAY)
    const evidence = analysis.evidence as { rule_cards: { cards: unknown[]; bodyReplaced: boolean } }
    expect(evidence.rule_cards).not.toBeNull()
    expect(evidence.rule_cards.cards).toHaveLength(2)
    expect(evidence.rule_cards.bodyReplaced).toBe(true)
    expect(analysis.report_markdown).toContain('三、需要留意的广告\n这 2 条已经放在上面「我们正在跟进的广告」里，这里不再重复。')
  })

  it('has each section heading exactly once and no stray numbered line', () => {
    const report = demoAnalysis(TODAY).report_markdown ?? ''
    const lines = report.split('\n')
    for (const heading of ['一、', '二、', '三、', '四、', '五、', '六、', '七、', '八、']) {
      expect(lines.filter((line) => line.startsWith(heading))).toHaveLength(1)
    }
    const numbered = lines.filter((line) => /^\d+\. /.test(line))
    expect(numbered).toHaveLength(3)
    expect(report).not.toContain('4. 广告出现的位置')
  })

  it('sums daily and campaign spend to 700', () => {
    const evidence = demoAnalysis(TODAY).evidence as {
      daily_campaigns: { spend: number }[]
      campaigns: { spend: number }[]
    }
    expect(evidence.daily_campaigns.reduce((sum, row) => sum + row.spend, 0)).toBe(700)
    expect(evidence.campaigns.reduce((sum, row) => sum + row.spend, 0)).toBe(700)
  })

  it('stores the click rate as a fraction and describes the audience share', () => {
    const analysis = demoAnalysis(TODAY)
    const evidence = analysis.evidence as { comparison: { ctr: { current: number } } }
    expect(evidence.comparison.ctr.current).toBe(0.0143)
    const report = analysis.report_markdown ?? ''
    expect(report).toContain('约 47%')
    expect(report).not.toContain('六成')
  })

  it('does not use the stale promise wording', () => {
    // 承诺句在卡片里，不在正文（魏征：原来查正文永远会过）
    const cards = (demoAnalysis(TODAY).evidence as { rule_cards: { promise: string } }).rule_cards
    expect(cards.promise).toContain('你不用动手')
    expect(cards.promise).not.toContain('原定')
  })

  it('contains no real client names or account ids', () => {
    const json = JSON.stringify(demoAnalysis(TODAY))
    for (const forbidden of [
      'CTS', 'China Tours', 'Oztop', 'oztop', 'NAL', 'New Asian', 'Roman',
      'East International', 'Magic Picks', 'Medspa', 'Kiteroa', 'act_',
      '1616575215312482', 'Grand Tour', 'Carrington', 'Park Homes', 'Bamwave', 'NZCPE', 'Rothesay',
    ]) {
      expect(json).not.toContain(forbidden)
    }
  })
})

describe('demo page', () => {
  it('renders the report view with cards and body', () => {
    render(<ReportView analysis={demoAnalysis(TODAY)} />)
    expect(screen.getByTestId('rule-cards')).toBeInTheDocument()
    expect(screen.getByText('广告：秋季补水套餐 · 预约表单 · 第 2 版')).toBeInTheDocument()
    expect(screen.getByTestId('report-body')).toBeInTheDocument()
  })

  it('renders the banner, heading and footer email', () => {
    render(<DemoPage />)
    expect(screen.getByRole('note')).toHaveTextContent('以下数字全部是虚构的样例。报告的格式和检查方法，跟签约客户看到的一模一样。')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('示例报告：Magic Bridge 每周给你看什么')
    expect(screen.getByRole('link', { name: 'hello@magicengine.cloud' })).toHaveAttribute(
      'href',
      'mailto:hello@magicengine.cloud?subject=Magic%20Bridge%20广告报告',
    )
  })
})
