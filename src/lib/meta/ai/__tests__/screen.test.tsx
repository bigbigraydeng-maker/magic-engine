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
    expect(screen.getByRole('alert')).toHaveTextContent('authorisation was cancelled')
    await screen.findByRole('button',{ name:'Find accounts (1)' })
  })
  it('clears stale account options when another connection lookup fails',async()=>{
    render(<MetaAdsScreen clientId="tenant" />)
    const first=await screen.findByRole('button',{ name:'Find accounts (1)' })
    fireEvent.click(first);await screen.findByRole('combobox')
    fireEvent.click(screen.getByRole('button',{ name:'Find accounts (2)' }))
    await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Meta could not be reached'))
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByText(/No accessible ad accounts/)).not.toBeInTheDocument()
  })
  it('never calls inactive key a working AI connection',async()=>{
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ connections:[],grants:[],keys:[{ id:'key',key_prefix:'me_live_demo',expires_at:'2099-01-01',last_used_at:'2026-09-01',account_id:null,access_active:false }] })))
    render(<MetaAdsScreen clientId="tenant" />)
    expect(await screen.findByText(/Account access is no longer active/)).toBeInTheDocument()
    expect(screen.queryByText(/Waiting for your AI app/)).not.toBeInTheDocument()
  })
})
