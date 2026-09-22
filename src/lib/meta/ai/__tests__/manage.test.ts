import { beforeEach,describe,expect,it,vi } from 'vitest'

const mocks=vi.hoisted(()=>({ from:vi.fn(),pilotState:vi.fn(),requirePilotActive:vi.fn(),activeConnectionForPrincipal:vi.fn(),reserveRead:vi.fn(),requireDiscoveryAuthorization:vi.fn(),requireReleaseAuthorization:vi.fn() }))
vi.mock('@/lib/supabase',()=>({ supabaseAdmin:{ from:mocks.from } }))
vi.mock('@/lib/auth/api-key-access',()=>({ generateApiKey:vi.fn() }))
vi.mock('../entitlement',()=>({ pilotState:mocks.pilotState,requirePilotActive:mocks.requirePilotActive }))
vi.mock('../store',()=>({ activeConnectionForPrincipal:mocks.activeConnectionForPrincipal,reserveRead:mocks.reserveRead,
  requireDiscoveryAuthorization:mocks.requireDiscoveryAuthorization,requireReleaseAuthorization:mocks.requireReleaseAuthorization }))
vi.mock('../analysis',()=>({ listAnalyses:vi.fn(async()=>[]) }))

import { bind,discover,issueKey,revoke,status } from '../manage'
import { MetaReadError } from '../../graph-read'

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

beforeEach(()=>{
  vi.clearAllMocks()
  mocks.activeConnectionForPrincipal.mockReset()
  mocks.requireDiscoveryAuthorization.mockReset().mockResolvedValue(undefined)
  mocks.requireReleaseAuthorization.mockReset().mockResolvedValue(undefined)
  mocks.reserveRead.mockResolvedValue(undefined)
  mocks.requirePilotActive.mockResolvedValue({ revision:'ent-1',new_actions_allowed:true })
  process.env.META_ADS_AI_GRAPH_VERSION='v21.0'
})

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
    mocks.pilotState.mockResolvedValue({ invited:true,new_actions_allowed:false,reason:'invitation_inactive',revision:'ent-1' })
    mocks.from.mockImplementation((table:string)=>{
      if(table==='platform_oauth_connections') return selectQuery([{ id:'connection',status:'revoked',token_expiry:'2099-01-01',authorizing_principal_id:'principal',entitlement_revision:'ent-1' }])
      if(table==='meta_ads_read_grants') return selectQuery([{ id:'grant',ad_account_id:'act_1234567890',connection_id:'connection',revision:'new-revision',principal_id:'principal',revoked_at:'2026-09-20',entitlement_revision:'ent-1' }])
      if(table==='client_api_keys') return selectQuery([{ id:'key',key_prefix:'me_live_demo',expires_at:'2099-01-01',last_used_at:null,metadata:{ meta_ads_grant_id:'grant',meta_ads_grant_revision:'old-revision',meta_ads_principal_id:'principal',meta_ads_entitlement_revision:'ent-1' } }])
      if(table==='mcp_access_log') return selectQuery(null)
      throw new Error(`unexpected table ${table}`)
    })
    const result=await status('client','principal')
    expect(result.keys).toEqual([expect.objectContaining({ id:'key',access_active:false,last_successful_read:null })])
    expect(result.grants).toEqual([])
  })

  it('不会把明确属于其他发行人的密钥显示给当前用户',async()=>{
    mocks.pilotState.mockResolvedValue({ invited:true,new_actions_allowed:true,reason:'ready',revision:'ent-1' })
    mocks.from.mockImplementation((table:string)=>{
      if(table==='platform_oauth_connections') return selectQuery([{ id:'connection',status:'active',token_expiry:'2099-01-01',authorizing_principal_id:'principal',entitlement_revision:'ent-1' }])
      if(table==='meta_ads_read_grants') return selectQuery([{ id:'grant',ad_account_id:'act_1234567890',connection_id:'connection',revision:'r1',principal_id:'principal',revoked_at:null,entitlement_revision:'ent-1' }])
      if(table==='client_api_keys') return selectQuery([{ id:'key',key_prefix:'me_live_demo',expires_at:'2099-01-01',last_used_at:null,metadata:{ meta_ads_grant_id:'grant',meta_ads_grant_revision:'r1',meta_ads_principal_id:'other',meta_ads_entitlement_revision:'ent-1' } }])
      throw new Error(`unexpected table ${table}`)
    })
    expect((await status('client','principal')).keys).toEqual([])
  })
})

describe('账户发现返回边界',()=>{
  it.each([
    ['邀请在 Meta 等待期间被暂停',new MetaReadError('service_paused',404)],
    ['Meta 连接在等待期间被断开',new MetaReadError('reconnect_required',403)],
  ])('%s时不释放账户列表',async(_label,finalError)=>{
    mocks.activeConnectionForPrincipal.mockResolvedValueOnce({ token:'private',version:'v1',entitlementRevision:'ent-1' })
    mocks.requireDiscoveryAuthorization.mockRejectedValueOnce(finalError)
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({ data:[{ id:'act_1234567890',name:'Example' }] }),{ status:200 })))
    await expect(discover('client','principal','connection')).rejects.toThrow(finalError.code)
    expect(mocks.activeConnectionForPrincipal).toHaveBeenCalledTimes(1)
    expect(mocks.requireDiscoveryAuthorization).toHaveBeenCalledWith('client','connection','principal','v1')
  })
})

describe('持久授权写入边界',()=>{
  it('绑定账户时若邀请在 Meta 等待期间暂停则不写 grant',async()=>{
    mocks.activeConnectionForPrincipal.mockResolvedValueOnce({ token:'private',version:'v1',entitlementRevision:'ent-1' })
      .mockRejectedValueOnce(new MetaReadError('service_paused',404))
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({ id:'act_1234567890' }),{ status:200 })))
    await expect(bind('client','principal','connection','act_1234567890')).rejects.toThrow('service_paused')
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('grant 写入被 Postgres 拒绝时，记下真实错误再报 account_unavailable — 2026-09-22 生产实测这条报错信息经常文不对题（该客户尚未获得测试资格/已绑定其他客户），不记下真错误就永远查不出来',async()=>{
    const warn=vi.spyOn(console,'warn').mockImplementation(()=>{})
    const upsertChain={ select:vi.fn(()=>upsertChain),single:vi.fn(()=>Promise.resolve({ data:null,error:{ code:'23505',message:'duplicate key value violates unique constraint "meta_ads_exclusive_active_account"',details:'Key (ad_account_id)=(act_1234567890) already exists.',hint:null } })) }
    mocks.from.mockReturnValue({ upsert:vi.fn(()=>upsertChain) })
    mocks.activeConnectionForPrincipal.mockResolvedValue({ token:'private',version:'v1',entitlementRevision:'ent-1' })
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({ id:'act_1234567890' }),{ status:200 })))
    await expect(bind('client','principal','connection','act_1234567890')).rejects.toThrow('account_unavailable')
    expect(warn).toHaveBeenCalledWith('[meta-ads-ai] grant upsert failed',expect.objectContaining({
      clientId:'client',code:'23505',message:expect.stringContaining('meta_ads_exclusive_active_account'),
    }))
  })

  it('创建 key 前若邀请暂停则不写入凭据',async()=>{
    mocks.from.mockImplementation((table:string)=>{
      if(table==='meta_ads_read_grants') return selectQuery({ connection_id:'connection',revision:'grant-r1',principal_id:'principal',entitlement_revision:'ent-1' })
      throw new Error(`unexpected table ${table}`)
    })
    mocks.activeConnectionForPrincipal.mockResolvedValueOnce({ token:'private',version:'v1',entitlementRevision:'ent-1' })
    mocks.requirePilotActive.mockRejectedValueOnce(new MetaReadError('service_paused',404))
    await expect(issueKey('client','principal','grant','person@example.test')).rejects.toThrow('service_paused')
    expect(mocks.from).toHaveBeenCalledTimes(1)
  })
})
