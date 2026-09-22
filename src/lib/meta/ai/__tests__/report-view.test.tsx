import { cleanup,render,screen } from '@testing-library/react'
import { afterEach,describe,expect,it } from 'vitest'
import ReportView, { splitReportSections,type ReportAnalysis } from '@/app/meta-ads-ai/[clientId]/ReportView'

const base: ReportAnalysis={
  id:'report-1',status:'completed',ad_account_id:'act_123456789012345678901234567890',
  window_since:'2026-09-13',window_until:'2026-09-19',error_code:null,
  created_at:'2026-09-20T01:00:00Z',completed_at:'2026-09-20T01:05:00Z',report_markdown:null,
}

afterEach(cleanup)

describe('Meta Ads AI report view',()=>{
  it('preserves every character while separating numbered Chinese sections',()=>{
    const report='报告说明：金额均为 NZD。\n\n一、总体结果\n花费 NZD 100，CTR 2.5%。\n二、表现较好（仅候选）\n不是全账户排名；数据不足。\n三、需要关注\n可能疲劳，但不能确定。'
    const sections=splitReportSections(report)
    expect(sections.map(section=>section.content).join('')).toBe(report)
    expect(sections).toHaveLength(4)

    render(<ReportView analysis={{ ...base,report_markdown:report }} />)
    expect(screen.getByTestId('report-body')).toHaveTextContent('不是全账户排名；数据不足。')
    expect(screen.getByText(/可能疲劳，但不能确定/)).toBeInTheDocument()
    expect(screen.getByText(base.ad_account_id)).toHaveClass('break-all')
    expect(screen.getByText('报告已生成')).toBeInTheDocument()
  })

  it('shows an unnumbered or incomplete report in full',()=>{
    const report='总体结果\n数据不足。\n\n只有这一段，没有章节编号。'
    expect(splitReportSections(report)).toEqual([{ content:report,heading:null }])
    render(<ReportView analysis={{ ...base,report_markdown:report }} />)
    expect(screen.getByText(/只有这一段，没有章节编号/)).toBeInTheDocument()
  })

  it('recognises old numbered headings without showing Markdown heading markers',()=>{
    const report='旧报告说明\n\n## 一、总体结果\n花费 NZD 88。\n## 二、需要关注\n数据不足，不能确定。'
    expect(splitReportSections(report).map(section=>section.content).join('')).toBe(report)
    render(<ReportView analysis={{ ...base,report_markdown:report }} />)
    expect(screen.getByRole('heading',{ name:'一、总体结果' })).toBeInTheDocument()
    expect(screen.queryByText('## 一、总体结果')).not.toBeInTheDocument()
    expect(screen.getByText(/数据不足，不能确定/)).toBeInTheDocument()
  })

  it('keeps a long report and its limiting language visible',()=>{
    const paragraph='所列候选不代表全部广告；没有足够数据判断。'
    const report=`一、总体结果\n${Array.from({ length:40 },()=>paragraph).join('\n')}`
    render(<ReportView analysis={{ ...base,report_markdown:report }} />)
    expect(screen.getAllByText(/所列候选不代表全部广告/)).toHaveLength(1)
    expect(screen.getByTestId('report-body').textContent).toContain(paragraph.repeat(1))
  })

  it.each([
    ['running','正在生成','报告正在生成，请稍后刷新页面。'],
    ['no_data','没有可分析数据','这个期间没有可分析的广告数据'],
    ['failed','生成未完成','本次分析没有完成。'],
  ] as const)('shows the %s state without requiring report text',(status,label,message)=>{
    render(<ReportView analysis={{ ...base,status,report_markdown:null }} />)
    expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.getByText(new RegExp(message))).toBeInTheDocument()
  })
})
