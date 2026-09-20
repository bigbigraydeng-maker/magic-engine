import { describe,expect,it,vi } from 'vitest'

const mocks=vi.hoisted(()=>({ from:vi.fn(),pilotState:vi.fn() }))
vi.mock('@/lib/supabase',()=>({ supabaseAdmin:{ from:mocks.from } }))
vi.mock('@/lib/auth/api-key-access',()=>({ generateApiKey:vi.fn() }))
vi.mock('../entitlement',()=>({ pilotState:mocks.pilotState }))

import { revoke,status } from '../manage'

function updateQuery(data:unknown,error:unknown=null) {
  const result={ data,error }
  const chain:Record<string,unknown>={}
  for(const method of ['update','eq','contains','is']) chain[method]=vi.fn(()=>chain)
  chain.select=vi.fn(()=>Promise.resolve(result))
  return chain
}

function selectQuery(data:unknown,error:unknown=null) {
  const result={ data,error }
  const query=Promise.resolve(result) as Promise<typeof result> & Record<string,ReturnType<typeof vi.fn>>
  for(const method of ['select','eq','contains','is','in','order','limit']) query[method]=vi.fn(()=>query)
  query.maybeSingle=vi.fn(()=>Promise.resolve(result))
  return query
}

describe('撤销连接',()=>{
  it('零行更新不能被当成撤销成功',async()=>{
    mocks.from.mockReturnValue(updateQuery([]))
    await expect(revoke('client','principal','connection','00000000-0000-4000-8000-000000000001')).rejects.toThrow('disconnect_not_found')
  })

  it('连接撤销同时校验客户、用途和 OAuth 发起人',async()=>{
    const query=updateQuery([{ id:'connection' }]);mocks.from.mockReturnValue(query)
    await expect(revoke('client','principal','connection','connection')).resolves.toBeUndefined()
    expect(query.eq).toHaveBeenCalledWith('client_id','client')
    expect(query.eq).toHaveBeenCalledWith('purpose','meta_ads_read')
    expect(query.eq).toHaveBeenCalledWith('authorizing_principal_id','principal')
  })
})

describe('连接状态',()=>{
  it('账户撤销并变更 revision 后仍显示原发行人的历史密钥',async()=>{
    mocks.pilotState.mockResolvedValue({ invited:true,new_actions_allowed:false,reason:'invitation_inactive' })
    mocks.from.mockImplementation((table:string)=>{
      if(table==='platform_oauth_connections') return selectQuery([{ id:'connection',status:'revoked',token_expiry:'2099-01-01',authorizing_principal_id:'principal' }])
      if(table==='meta_ads_read_grants') return selectQuery([{ id:'grant',ad_account_id:'act_1234567890',connection_id:'connection',revision:'new-revision',principal_id:'principal',revoked_at:'2026-09-20' }])
      if(table==='client_api_keys') return selectQuery([{ id:'key',key_prefix:'me_live_demo',expires_at:'2099-01-01',last_used_at:null,metadata:{ meta_ads_grant_id:'grant',meta_ads_grant_revision:'old-revision',meta_ads_principal_id:'principal' } }])
      if(table==='mcp_access_log') return selectQuery(null)
      throw new Error(`unexpected table ${table}`)
    })
    const result=await status('client','principal')
    expect(result.keys).toEqual([expect.objectContaining({ id:'key',access_active:false,last_successful_read:null })])
    expect(result.grants).toEqual([])
  })

  it('不会把明确属于其他发行人的密钥显示给当前用户',async()=>{
    mocks.pilotState.mockResolvedValue({ invited:true,new_actions_allowed:true,reason:'ready' })
    mocks.from.mockImplementation((table:string)=>{
      if(table==='platform_oauth_connections') return selectQuery([{ id:'connection',status:'active',token_expiry:'2099-01-01',authorizing_principal_id:'principal' }])
      if(table==='meta_ads_read_grants') return selectQuery([{ id:'grant',ad_account_id:'act_1234567890',connection_id:'connection',revision:'r1',principal_id:'principal',revoked_at:null }])
      if(table==='client_api_keys') return selectQuery([{ id:'key',key_prefix:'me_live_demo',expires_at:'2099-01-01',last_used_at:null,metadata:{ meta_ads_grant_id:'grant',meta_ads_grant_revision:'r1',meta_ads_principal_id:'other' } }])
      throw new Error(`unexpected table ${table}`)
    })
    expect((await status('client','principal')).keys).toEqual([])
  })
})
