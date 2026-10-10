// @vitest-environment node
import { beforeEach,describe,expect,it,vi } from 'vitest'

const mocks=vi.hoisted(()=>({
  body:vi.fn(),pilotDashboardAccess:vi.fn(),activeDashboardAccess:vi.fn(),status:vi.fn(),discover:vi.fn(),bind:vi.fn(),issueKey:vi.fn(),revoke:vi.fn(),generateAnalysis:vi.fn(),
}))
vi.mock('../http',()=>({
  checkOrigin:vi.fn(),boundedBody:mocks.body,pilotDashboardAccess:mocks.pilotDashboardAccess,activeDashboardAccess:mocks.activeDashboardAccess,
  json:(data:unknown,status=200)=>Response.json(data,{ status }),
  failure:(error:unknown)=>Response.json({ error:error instanceof Error ? error.message : 'request_failed' },{ status:(error as { status?:number })?.status ?? 500 }),
}))
vi.mock('../manage',()=>({ status:mocks.status,discover:mocks.discover,bind:mocks.bind,issueKey:mocks.issueKey,revoke:mocks.revoke }))
vi.mock('../analysis',()=>({ generateAnalysis:mocks.generateAnalysis }))
vi.mock('../audit',()=>({ auditedControl:vi.fn(async(_client:string,_email:string,_event:string,_target:string|null,run:()=>Promise<unknown>)=>run()) }))

import { GET,POST } from '@/app/api/clients/[id]/meta-ads-ai/route'
import { MetaReadError } from '../../graph-read'

const context={ params:{ id:'a1000000-0000-4000-8000-000000000001' } }
const request=new Request('https://app.example/api/clients/a1000000-0000-4000-8000-000000000001/meta-ads-ai',{ method:'POST' })

beforeEach(()=>{
  vi.clearAllMocks()
  mocks.pilotDashboardAccess.mockResolvedValue({ user:{ id:'principal',email:'person@example.test' } })
  mocks.activeDashboardAccess.mockResolvedValue({ user:{ id:'principal',email:'person@example.test' } })
  mocks.status.mockResolvedValue({ pilot:{ new_actions_allowed:true },connections:[],grants:[],keys:[] })
  mocks.revoke.mockResolvedValue(undefined)
  mocks.generateAnalysis.mockResolvedValue({ id:'job-1',status:'completed' })
})

describe('邀请测试管理接口',()=>{
  it('暂停时仍允许查看状态和撤销已有连接',async()=>{
    mocks.activeDashboardAccess.mockRejectedValue(new MetaReadError('service_paused',404))
    expect((await GET(request,context)).status).toBe(200)
    mocks.body.mockResolvedValue({ action:'revoke',type:'connection',id:'00000000-0000-4000-8000-000000000001' })
    expect((await POST(request,context)).status).toBe(200)
    expect(mocks.revoke).toHaveBeenCalledWith(context.params.id,'principal','connection','00000000-0000-4000-8000-000000000001')
    expect(mocks.activeDashboardAccess).not.toHaveBeenCalled()
  })

  it('暂停时阻止发现账户和创建新的读取能力',async()=>{
    mocks.activeDashboardAccess.mockRejectedValue(new MetaReadError('service_paused',404))
    mocks.body.mockResolvedValue({ action:'discover',connection_id:'00000000-0000-4000-8000-000000000001' })
    const response=await POST(request,context)
    expect(response.status).toBe(404)
    expect(mocks.discover).not.toHaveBeenCalled()
  })

  it('用当前登录人的客户权限生成托管分析',async()=>{
    const grantId='00000000-0000-4000-8000-000000000002'
    mocks.body.mockResolvedValue({ action:'generate_analysis',grant_id:grantId })
    const response=await POST(request,context)
    expect(response.status).toBe(200)
    expect(mocks.activeDashboardAccess).toHaveBeenCalledWith(context.params.id)
    expect(mocks.generateAnalysis).toHaveBeenCalledWith(context.params.id,'principal',grantId)
  })
})
