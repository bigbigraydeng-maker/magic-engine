import { beforeEach,describe,expect,it,vi } from 'vitest'

const mocks=vi.hoisted(()=>({ from:vi.fn() }))
vi.mock('@/lib/supabase',()=>({ supabaseAdmin:{ from:mocks.from } }))

import { pilotState,requirePilotActive,requirePilotLifecycleAccess } from '../entitlement'

function query(result:{ data:unknown;error:unknown } | (()=>{ data:unknown;error:unknown })) {
  const chain:Record<string,unknown>={}
  for(const method of ['select','eq','contains','limit']) chain[method]=vi.fn(()=>chain)
  chain.maybeSingle=vi.fn(()=>Promise.resolve(typeof result==='function' ? result() : result))
  chain.then=(resolve:(value:unknown)=>unknown)=>Promise.resolve(typeof result==='function' ? result() : result).then(resolve)
  return chain
}

beforeEach(()=>{
  vi.clearAllMocks()
  process.env.META_ADS_AI_ENABLED='true'
})

describe('邀请测试资格',()=>{
  it('只有生效且未过期的邀请允许创建连接和读取',async()=>{
    mocks.from.mockReturnValue(query({ data:{ status:'active',starts_at:'2026-09-01T00:00:00Z',expires_at:'2099-01-01T00:00:00Z',revision:'ent-1' },error:null }))
    await expect(requirePilotActive('client')).resolves.toMatchObject({ reason:'ready',new_actions_allowed:true })
  })

  it('总开关关闭时阻止新连接和读取',async()=>{
    process.env.META_ADS_AI_ENABLED='false'
    mocks.from.mockReturnValue(query({ data:{ status:'active',starts_at:'2026-09-01T00:00:00Z',expires_at:'2099-01-01T00:00:00Z',revision:'ent-1' },error:null }))
    await expect(requirePilotActive('client')).rejects.toThrow('service_paused')
  })

  it('暂停后仍允许已有客户进入页面撤销连接',async()=>{
    process.env.META_ADS_AI_ENABLED='false'
    mocks.from.mockImplementation((table:string)=>table==='meta_ads_ai_pilot_entitlements'
      ? query({ data:{ status:'paused',starts_at:'2026-09-01T00:00:00Z',expires_at:null,revision:'ent-1' },error:null })
      : query({ data:[],error:null }))
    await expect(requirePilotLifecycleAccess('client')).resolves.toMatchObject({ new_actions_allowed:false })
  })

  it('没有邀请也没有历史连接时隐藏入口',async()=>{
    mocks.from.mockImplementation((table:string)=>table==='meta_ads_ai_pilot_entitlements'
      ? query({ data:null,error:null })
      : query({ data:[],error:null }))
    await expect(requirePilotLifecycleAccess('client')).rejects.toThrow('pilot_required')
    await expect(pilotState('client')).resolves.toMatchObject({ invited:false,reason:'invitation_required' })
  })
})
