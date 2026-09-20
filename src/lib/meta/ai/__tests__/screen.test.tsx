import { beforeEach,describe,it,expect,vi } from 'vitest'
import { render,screen,waitFor,fireEvent,cleanup } from '@testing-library/react'
import MetaAdsScreen from '@/app/meta-ads-ai/[clientId]/screen'
const connection={ id:'conn-a',status:'active',token_expiry:'2099-01-01' }
const status={ connections:[connection,{ ...connection,id:'conn-b' }],grants:[],keys:[] }
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
  it('never calls inactive key a working AI connection',async()=>{
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ connections:[],grants:[],keys:[{ id:'key',key_prefix:'me_live_demo',expires_at:'2099-01-01',last_used_at:'2026-09-01',account_id:null,access_active:false }] })))
    render(<MetaAdsScreen clientId="tenant" />)
    expect(await screen.findByText(/广告账户授权已失效/)).toBeInTheDocument()
    expect(screen.queryByText(/正在等待 AI 应用连接/)).not.toBeInTheDocument()
  })
  it('renders the invited-customer connector journey in Chinese',async()=>{
    render(<MetaAdsScreen clientId="tenant" />)
    expect(screen.getByRole('heading',{ name:'Meta 广告 → AI' })).toBeInTheDocument()
    expect(screen.getByRole('heading',{ name:'1. 连接 Facebook' })).toBeInTheDocument()
    expect(screen.getByRole('heading',{ name:'2. 选择广告账户' })).toBeInTheDocument()
    expect(screen.getByRole('heading',{ name:'3. 连接你的 AI' })).toBeInTheDocument()
    expect(screen.queryByText('Connect Facebook')).not.toBeInTheDocument()
    expect((await screen.findAllByText(/授权有效期至/)).length).toBe(2)
  })
})
