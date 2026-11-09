import { beforeEach,describe,expect,it,vi } from 'vitest'

const pilotDashboardAccess=vi.fn()
const selfServeActivate=vi.fn()
const publicConnectOpen=vi.fn()

vi.mock('@/lib/meta/ai/http',async()=>{
  const actual=await vi.importActual<typeof import('@/lib/meta/ai/http')>('@/lib/meta/ai/http')
  return { ...actual,pilotDashboardAccess:(...args:unknown[])=>pilotDashboardAccess(...args) }
})
vi.mock('@/lib/meta/ai/entitlement',async()=>{
  const actual=await vi.importActual<typeof import('@/lib/meta/ai/entitlement')>('@/lib/meta/ai/entitlement')
  return { ...actual,selfServeActivate:(...args:unknown[])=>selfServeActivate(...args),publicConnectOpen:(...args:unknown[])=>publicConnectOpen(...args) }
})
vi.mock('@/lib/meta/ai/audit',()=>({
  auditedControl:async(_clientId:string,_email:string,_event:string,_target:string|null,run:()=>Promise<unknown>)=>run(),
}))

import { POST } from '@/app/api/clients/[id]/meta-ads-ai/route'

const clientId='11111111-1111-1111-1111-111111111111'

function activateRequest() {
  return new Request(`https://app.example.test/api/clients/${clientId}/meta-ads-ai`,{
    method:'POST',
    headers:{ 'Content-Type':'application/json',origin:'https://app.example.test' },
    body:JSON.stringify({ action:'activate' }),
  })
}

beforeEach(()=>{
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_APP_URL='https://app.example.test'
  selfServeActivate.mockResolvedValue('activated')
})

describe('POST activate',()=>{
  it('refuses a paid client with activation_not_allowed',async()=>{
    pilotDashboardAccess.mockResolvedValue({ user:{ id:'u',email:'a@x.test' },tier:'paid_client' })
    const response=await POST(activateRequest(),{ params:{ id:clientId } })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error:'activation_not_allowed' })
    expect(selfServeActivate).not.toHaveBeenCalled()
  })

  it('refuses a self-serve client while public connect is closed',async()=>{
    pilotDashboardAccess.mockResolvedValue({ user:{ id:'u',email:'a@x.test' },tier:'self_serve' })
    publicConnectOpen.mockReturnValue(false)
    const response=await POST(activateRequest(),{ params:{ id:clientId } })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error:'connect_waiting_review' })
    expect(selfServeActivate).not.toHaveBeenCalled()
  })

  it('activates a self-serve client once public connect is open',async()=>{
    pilotDashboardAccess.mockResolvedValue({ user:{ id:'u',email:'a@x.test' },tier:'self_serve' })
    publicConnectOpen.mockReturnValue(true)
    const response=await POST(activateRequest(),{ params:{ id:clientId } })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok:true,result:'activated' })
    expect(selfServeActivate).toHaveBeenCalledWith(clientId,'a@x.test')
  })
})
