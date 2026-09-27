import { cleanup,render,screen } from '@testing-library/react'
import { afterEach,beforeAll,describe,expect,it,vi } from 'vitest'
import ReportView, { splitReportSections,type ReportAnalysis } from '@/app/meta-ads-ai/[clientId]/ReportView'
import { placementLabel } from '@/app/meta-ads-ai/[clientId]/chart-labels'

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
    expect(screen.getByText(/各广告系列花了多少钱/)).toBeInTheDocument()
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
    expect(charts.textContent).toContain('各广告系列花了多少钱')
    expect(charts.textContent).toContain('基督城')
    expect(charts.textContent).toContain('739.0%')
    expect(charts.textContent).toContain('每日花费与点击率趋势')
    expect(charts.textContent).toContain('广告出现在哪里')
    expect(charts.textContent).toContain('受众画像')
    expect(charts.textContent).toContain('设备分布')
    expect(charts.textContent).toContain('地区花费分布')
  })

  it('labels placements in plain Chinese and never leaks raw platform codes',()=>{
    // jsdom 不画坐标轴文字，所以直接测换名函数
    expect(placementLabel('audience_network','classic')).toBe('Meta 合作的其它 App')
    expect(placementLabel('facebook','feed')).toBe('Facebook 动态')
    expect(placementLabel('instagram','story')).toBe('Instagram 快拍')
    expect(placementLabel('instagram','reels')).toBe('Instagram 短视频')
    expect(placementLabel('threads','feed')).toBe('threads · feed')
    expect(placementLabel('facebook','marketplace')).toBe('Facebook 市场')
    expect(placementLabel('messenger','story')).toBe(placementLabel('messenger','messenger_inbox'))
  })

  it('renders no chart section when there is no usable evidence — must not crash on an older job or a no_data/failed status carrying null evidence',()=>{
    render(<ReportView analysis={{ ...base,report_markdown:'一、总体结果\n数据充足。',evidence:null }} />)
    expect(screen.queryByTestId('report-charts')).not.toBeInTheDocument()
  })
})

describe('我们正在跟进的广告（卡片）',()=>{
  const cardsEvidence=(n:number)=>({
    rule_cards:{
      title:`我们正在跟进的广告（${n} 条）`,
      intro:'这次检查了 40 条正在投放的广告，下面这 3 条有变化，其余没发现明显变差。',
      promise:'我们的广告团队已经看到这几条，会在10月2日前后复查并处理，你不用动手。',
      bodyReplaced:true,
      cards:Array.from({ length:n },(_,i)=>({
        adLabel:`Ad ${i+1}`,headline:`标题 ${i+1}`,detail:`说明 ${i+1}`,action:`处理 ${i+1}`,
      })),
    },
  })

  it('shows the cards before the report body for a completed report',()=>{
    render(<ReportView analysis={{ ...base,report_markdown:'一、总体结果\n数据充足。',evidence:cardsEvidence(3) }} />)
    const cards=screen.getByTestId('rule-cards')
    expect(cards).toBeInTheDocument()
    expect(screen.getByText('我们正在跟进的广告（3 条）')).toBeInTheDocument()
    expect(screen.getByText(/这次检查了 40 条正在投放的广告/)).toBeInTheDocument()
    expect(screen.getByText(/我们的广告团队已经看到这几条/)).toBeInTheDocument()
    expect(screen.getByText('广告：Ad 1')).toBeInTheDocument()
    expect(screen.getByText('标题 3')).toBeInTheDocument()
    const body=screen.getByTestId('report-body')
    expect(cards.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('collapses cards beyond the first five into a details element',()=>{
    render(<ReportView analysis={{ ...base,report_markdown:'一、总体结果\n数据充足。',evidence:cardsEvidence(7) }} />)
    expect(screen.getByText('另外还有 2 条花费较少的，点开查看')).toBeInTheDocument()
    expect(screen.getByText('标题 6').closest('details')).not.toBeNull()
    expect(screen.getByText('标题 5').closest('details')).toBeNull()
  })

  it('shows the cards alongside the failure message',()=>{
    render(<ReportView analysis={{ ...base,status:'failed',report_markdown:null,error_code:'model_unavailable',evidence:cardsEvidence(3) }} />)
    expect(screen.getByTestId('rule-cards')).toBeInTheDocument()
    expect(screen.getByText('标题 1')).toBeInTheDocument()
    expect(screen.getByText(/AI 模型暂时无法响应/)).toBeInTheDocument()
  })

  it.each([
    ['missing',{}],
    ['null',{ rule_cards:null }],
    ['malformed',{ rule_cards:{ title:'t',intro:'i',promise:'p',bodyReplaced:true,cards:[{ adLabel:1 }] } }],
  ] as const)('renders no cards for %s rule_cards and still shows the report body',(_label,evidence)=>{
    render(<ReportView analysis={{ ...base,report_markdown:'一、总体结果\n数据充足。',evidence }} />)
    expect(screen.queryByTestId('rule-cards')).not.toBeInTheDocument()
    expect(screen.getByTestId('report-body')).toBeInTheDocument()
  })

  it('renders a script-like adLabel as literal text',()=>{
    const evidence={
      rule_cards:{
        title:'我们正在跟进的广告（1 条）',intro:'说明',promise:'承诺',bodyReplaced:true,
        cards:[{ adLabel:'<script>alert(1)</script>',headline:'标题',detail:'说明',action:'处理' }],
      },
    }
    const { container }=render(<ReportView analysis={{ ...base,report_markdown:'一、总体结果\n数据充足。',evidence }} />)
    expect(screen.getByText('广告：<script>alert(1)</script>')).toBeInTheDocument()
    expect(container.querySelector('script')).toBeNull()
  })
})

describe('值得你看一眼的广告（自助客户卡片）',()=>{
  const footer='不想每天自己盯？我们可以帮你看着，发现问题直接处理——发邮件到 hello@magicengine.cloud 跟我们聊聊。'

  it('renders the footer after the cards',()=>{
    const evidence={
      rule_cards:{
        title:'值得你看一眼的广告（1 条）',intro:'说明',promise:'',bodyReplaced:true,footer,
        cards:[{ adLabel:'Ad 1',headline:'标题 1',detail:'说明 1',action:'处理 1' }],
      },
    }
    render(<ReportView analysis={{ ...base,report_markdown:'一、总体结果\n数据充足。',evidence }} />)
    const cards=screen.getByTestId('rule-cards')
    const footerEl=screen.getByText(footer)
    expect(cards).toContainElement(footerEl)
    expect(screen.getByText('标题 1').compareDocumentPosition(footerEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders no empty promise paragraph when promise is empty',()=>{
    const evidence={
      rule_cards:{
        title:'值得你看一眼的广告（1 条）',intro:'说明',promise:'',bodyReplaced:true,footer,
        cards:[{ adLabel:'Ad 1',headline:'标题 1',detail:'说明 1',action:'处理 1' }],
      },
    }
    render(<ReportView analysis={{ ...base,report_markdown:'一、总体结果\n数据充足。',evidence }} />)
    const cards=screen.getByTestId('rule-cards')
    // intro + 1 card (4 <p>) + footer = 6 paragraphs; no empty promise paragraph
    expect(cards.querySelectorAll('p')).toHaveLength(6)
  })
})
