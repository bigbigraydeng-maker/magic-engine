import { beforeEach,describe,it,expect,vi } from 'vitest'
import { render,screen,waitFor,fireEvent,cleanup } from '@testing-library/react'
import MetaAdsScreen from '@/app/meta-ads-ai/[clientId]/screen'
const connection={ id:'conn-a',status:'active',token_expiry:'2099-01-01' }
const status={ pilot:{ invited:true,new_actions_allowed:true,sponsored_analysis_enabled:true,reason:'ready' },connections:[connection,{ ...connection,id:'conn-b' }],grants:[],keys:[],analyses:[] }
let discoveryCalls=0
beforeEach(()=>{
  cleanup();discoveryCalls=0
  vi.stubGlobal('fetch',vi.fn(async(_url:string,options?:RequestInit)=>{
    if(!options?.method) return new Response(JSON.stringify(status))
    const body=JSON.parse(String(options.body))
    if(body.action==='discover') {
      discoveryCalls++
      return discoveryCalls===1 ? new Response(JSON.stringify({ accounts:[{ id:'act_1234567890',name:'Test account',currency:'NZD' }],complete:true }))
        : new Response(JSON.stringify({ error:'provider_unavailable' }),{ status:502 })
    }
    return new Response('{}')
  }))
})
describe('nontechnical connection feedback',()=>{
  it('shows recoverable OAuth failure',async()=>{
    render(<MetaAdsScreen clientId="tenant" outcome="reconnect_required" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Facebook 授权已取消')
    await screen.findByRole('button',{ name:'查找广告账户（连接 1）' })
  })
  it('clears stale account options when another connection lookup fails',async()=>{
    render(<MetaAdsScreen clientId="tenant" />)
    const first=await screen.findByRole('button',{ name:'查找广告账户（连接 1）' })
    fireEvent.click(first);await screen.findByRole('combobox')
    fireEvent.click(screen.getByRole('button',{ name:'查找广告账户（连接 2）' }))
    await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('暂时无法连接 Meta'))
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByText(/没有找到可访问的广告账户/)).not.toBeInTheDocument()
  })
  it('does not expose internal developer keys in the customer journey',async()=>{
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ...status,connections:[],grants:[],keys:[{ id:'key',key_prefix:'me_live_demo',expires_at:'2099-01-01',last_used_at:'2026-09-01',account_id:null,access_active:false,last_successful_read:null }] })))
    render(<MetaAdsScreen clientId="tenant" />)
    await screen.findByRole('heading',{ name:'3. 生成广告分析' })
    expect(screen.queryByText(/me_live_demo/)).not.toBeInTheDocument()
    expect(screen.queryByText(/AI 访问密钥/)).not.toBeInTheDocument()
  })
  it('renders the invited-customer connector journey in Chinese',async()=>{
    render(<MetaAdsScreen clientId="tenant" />)
    expect(screen.getByRole('heading',{ name:'Meta 广告 → AI' })).toBeInTheDocument()
    expect(screen.getByRole('heading',{ name:'1. 连接 Facebook' })).toBeInTheDocument()
    expect(screen.getByRole('heading',{ name:'2. 选择广告账户' })).toBeInTheDocument()
    expect(screen.getByRole('heading',{ name:'3. 生成广告分析' })).toBeInTheDocument()
    expect(screen.queryByText('Connect Facebook')).not.toBeInTheDocument()
    expect(screen.queryByText(/MCP 服务器/)).not.toBeInTheDocument()
    expect((await screen.findAllByText(/只读授权有效期至/)).length).toBe(2)
    expect(screen.getAllByText('Facebook 已连接')).toHaveLength(2)
    expect(screen.queryByRole('button',{ name:'连接 Facebook' })).not.toBeInTheDocument()
  })
  it('keeps developer tool history out of the customer page',async()=>{
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ...status,connections:[],grants:[],keys:[{ id:'key',key_prefix:'me_live_demo',expires_at:'2099-01-01',last_used_at:'2026-09-01',account_id:'act_1234567890',access_active:true,last_successful_read:{ tool:'meta_get_insights',account_id:'act_1234567890',at:'2026-09-20T08:00:00Z' } }] })))
    render(<MetaAdsScreen clientId="tenant" />)
    await screen.findByRole('heading',{ name:'3. 生成广告分析' })
    expect(screen.queryByText(/meta_get_insights/)).not.toBeInTheDocument()
    expect(screen.getByRole('button',{ name:'刷新报告状态' })).toBeInTheDocument()
  })
  it('keeps disconnect controls available while the pilot is paused',async()=>{
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ...status,pilot:{ invited:true,new_actions_allowed:false,sponsored_analysis_enabled:false,reason:'service_paused' } })))
    render(<MetaAdsScreen clientId="tenant" />)
    expect(await screen.findByRole('status')).toHaveTextContent('测试服务目前已暂停')
    expect(screen.getAllByRole('button',{ name:'断开 Meta 连接' })[0]).toBeEnabled()
  })

  it('shows a Chinese hosted report without asking for an AI key',async()=>{
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ...status,connections:[],grants:[{ id:'grant',ad_account_id:'act_1234567890',connection_id:'missing' }],
      analyses:[{ id:'job',status:'completed',ad_account_id:'act_1234567890',window_since:'2026-09-13',window_until:'2026-09-19',
        report_markdown:'总体结果\n过去 7 天花费 NZD 100。',error_code:null,created_at:'2026-09-20',completed_at:'2026-09-20' }] })))
    render(<MetaAdsScreen clientId="tenant" />)
    expect(await screen.findByText(/过去 7 天花费 NZD 100/)).toBeInTheDocument()
    expect(screen.queryByText(/AI 访问密钥/)).not.toBeInTheDocument()
  })

  it('shows only the latest result for each advertising account',async()=>{
    const base={ ad_account_id:'act_1234567890',window_since:'2026-09-13',window_until:'2026-09-19',error_code:null,completed_at:'2026-09-20' }
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ...status,connections:[],grants:[],analyses:[
      { ...base,id:'latest',status:'completed',report_markdown:'最新中文报告',created_at:'2026-09-20T02:00:00Z' },
      { ...base,id:'older',status:'failed',report_markdown:null,created_at:'2026-09-20T01:00:00Z' },
    ] })))
    render(<MetaAdsScreen clientId="tenant" />)
    expect(await screen.findByText('最新中文报告')).toBeInTheDocument()
    expect(screen.queryByText(/本次分析没有完成/)).not.toBeInTheDocument()
  })

  it('shows a clear connected account state and hosted-model disclosure',async()=>{
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ...status,connections:[connection],grants:[{ id:'grant',ad_account_id:'act_1234567890',connection_id:connection.id }] })))
    render(<MetaAdsScreen clientId="tenant" />)
    expect(await screen.findByText('广告账户已连接')).toBeInTheDocument()
    expect(screen.queryByRole('button',{ name:'查找广告账户' })).not.toBeInTheDocument()
    expect(screen.getByRole('button',{ name:'生成近 7 天广告分析' })).toBeEnabled()
    expect(screen.getByText(/最小广告汇总数据/)).toHaveTextContent('分析费用由 Magic Engine 承担')
    expect(screen.queryByText(/Bearer|MCP/)).not.toBeInTheDocument()
  })

  it('keeps existing reports visible while hosted analysis is safely paused',async()=>{
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ...status,pilot:{ ...status.pilot,sponsored_analysis_enabled:false },connections:[connection],
      grants:[{ id:'grant',ad_account_id:'act_1234567890',connection_id:connection.id }],analyses:[{ id:'job',status:'completed',ad_account_id:'act_1234567890',window_since:'2026-09-13',window_until:'2026-09-19',report_markdown:'已生成的中文报告',error_code:null,created_at:'2026-09-20',completed_at:'2026-09-20' }] })))
    render(<MetaAdsScreen clientId="tenant" />)
    const generate=await screen.findByRole('button',{ name:'生成近 7 天广告分析' })
    expect(generate).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('安全暂停')
    expect(screen.getByText('已生成的中文报告')).toBeInTheDocument()
  })
})
