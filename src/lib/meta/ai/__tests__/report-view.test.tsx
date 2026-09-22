import { cleanup,render,screen } from '@testing-library/react'
import { afterEach,beforeAll,describe,expect,it,vi } from 'vitest'
import ReportView, { splitReportSections,type ReportAnalysis } from '@/app/meta-ads-ai/[clientId]/ReportView'

// recharts' ResponsiveContainer only renders its children once it measures a non-zero size,
// which jsdom never reports on its own.
beforeAll(()=>{
  vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockReturnValue(600)
  vi.spyOn(HTMLElement.prototype,'clientHeight','get').mockReturnValue(300)
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue(
    { width:600,height:300,top:0,left:0,right:600,bottom:300,x:0,y:0,toJSON(){} } as DOMRect,
  )
})

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

  it('shows the real reason for a failed report instead of the generic fallback — 2026-09-22 production: a real CTS analysis_too_large failure was hidden behind the same generic text as every other failure',()=>{
    render(<ReportView analysis={{ ...base,status:'failed',report_markdown:null,error_code:'analysis_too_large' }} />)
    expect(screen.getByText('当前广告数据量超过邀请测试版上限，请联系 Magic Engine 支持。')).toBeInTheDocument()
    expect(screen.queryByText(/本次分析没有完成/)).not.toBeInTheDocument()
  })

  it('falls back to the generic message when error_code is unrecognised',()=>{
    render(<ReportView analysis={{ ...base,status:'failed',report_markdown:null,error_code:'something_new' }} />)
    expect(screen.getByText(/本次分析没有完成/)).toBeInTheDocument()
  })

  it('renders charts from real evidence alongside the text report',()=>{
    const evidence={
      campaigns:[
        { campaign_name:'圣诞团-奥克兰 · 私信 · 20260916', spend:140.04 },
        { campaign_name:'圣诞团-基督城 · 私信 · 20260916', spend:107.72 },
      ],
      comparison:{
        spend:{ current:288.78, previous:324.29, percent_change:-10.95 },
        clicks:{ current:344, previous:41, percent_change:739.02 },
        ctr:{ current:0.0152, previous:0.0016, percent_change:874.39 },
        reach:{ current:9884, previous:6527, percent_change:51.43 },
      },
    }
    render(<ReportView analysis={{ ...base,report_markdown:'一、总体结果\n数据充足。',evidence }} />)
    const charts=screen.getByTestId('report-charts')
    expect(charts).toBeInTheDocument()
    // recharts wraps long labels and decimates axis ticks under jsdom's approximate text
    // measurement, so this only pins the wiring (real chart titles + comparison numbers render),
    // not which specific campaign tick survives — that's confirmed against production data instead.
    expect(charts.textContent).toContain('广告系列花费排行')
    expect(charts.textContent).toContain('基督城')
    expect(charts.textContent).toContain('739.0%')
  })

  it('renders no chart section when there is no usable evidence — must not crash on an older job or a no_data/failed status carrying null evidence',()=>{
    render(<ReportView analysis={{ ...base,report_markdown:'一、总体结果\n数据充足。',evidence:null }} />)
    expect(screen.queryByTestId('report-charts')).not.toBeInTheDocument()
  })
})
