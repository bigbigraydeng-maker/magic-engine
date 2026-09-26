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

  it('shows model_unavailable message when AI model fails but data was saved',()=>{
    render(<ReportView analysis={{ ...base,status:'failed',report_markdown:null,error_code:'model_unavailable' }} />)
    expect(screen.getByText(/AI 模型暂时无法响应/)).toBeInTheDocument()
    expect(screen.queryByText(/本次分析没有完成/)).not.toBeInTheDocument()
  })

  it('renders charts from evidence even when the analysis failed — model timeout should not hide collected data',()=>{
    const evidence={
      campaigns:[{ campaign_name:'测试广告',spend:50 }],comparison:null,
      daily_campaigns:null,placements:null,age_gender:null,devices:null,regions:null,
    }
    render(<ReportView analysis={{ ...base,status:'failed',report_markdown:null,error_code:'model_unavailable',evidence }} />)
    expect(screen.getByTestId('report-charts')).toBeInTheDocument()
    expect(screen.getByText(/广告系列花费排行/)).toBeInTheDocument()
    expect(screen.getByText(/AI 模型暂时无法响应/)).toBeInTheDocument()
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
      daily_campaigns:[
        { date_start:'2026-09-15',campaign_name:'A',spend:50,impressions:5000,clicks:80 },
        { date_start:'2026-09-16',campaign_name:'A',spend:60,impressions:6000,clicks:100 },
        { date_start:'2026-09-17',campaign_name:'A',spend:55,impressions:5500,clicks:90 },
      ],
      placements:[
        { publisher_platform:'facebook',platform_position:'feed',spend:120,impressions:8000,clicks:150 },
        { publisher_platform:'instagram',platform_position:'story',spend:80,impressions:5000,clicks:60 },
      ],
      age_gender:[
        { age:'25-34',gender:'male',spend:80,impressions:4000 },
        { age:'25-34',gender:'female',spend:90,impressions:4500 },
        { age:'35-44',gender:'male',spend:40,impressions:2000 },
      ],
      devices:[
        { device_platform:'mobile_app',spend:180,impressions:12000 },
        { device_platform:'desktop',spend:60,impressions:3000 },
      ],
      regions:[
        { country:'NZ',spend:200,impressions:13000 },
        { country:'AU',spend:50,impressions:2000 },
      ],
    }
    render(<ReportView analysis={{ ...base,report_markdown:'一、总体结果\n数据充足。',evidence }} />)
    const charts=screen.getByTestId('report-charts')
    expect(charts).toBeInTheDocument()
    expect(charts.textContent).toContain('广告系列花费排行')
    expect(charts.textContent).toContain('基督城')
    expect(charts.textContent).toContain('739.0%')
    expect(charts.textContent).toContain('每日花费与点击率趋势')
    expect(charts.textContent).toContain('版位花费分布')
    expect(charts.textContent).toContain('受众画像')
    expect(charts.textContent).toContain('设备分布')
    expect(charts.textContent).toContain('地区花费分布')
  })

  it('renders no chart section when there is no usable evidence — must not crash on an older job or a no_data/failed status carrying null evidence',()=>{
    render(<ReportView analysis={{ ...base,report_markdown:'一、总体结果\n数据充足。',evidence:null }} />)
    expect(screen.queryByTestId('report-charts')).not.toBeInTheDocument()
  })
})
