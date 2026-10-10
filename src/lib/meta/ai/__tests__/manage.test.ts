import { beforeEach,describe,expect,it,vi } from 'vitest'

const mocks=vi.hoisted(()=>({ from:vi.fn(),rpc:vi.fn(),pilotState:vi.fn(),requirePilotActive:vi.fn(),activeConnectionForPrincipal:vi.fn(),reserveRead:vi.fn(),requireDiscoveryAuthorization:vi.fn(),requireReleaseAuthorization:vi.fn() }))
vi.mock('@/lib/supabase',()=>({ supabaseAdmin:{ from:mocks.from,rpc:mocks.rpc } }))
vi.mock('@/lib/auth/api-key-access',()=>({ generateApiKey:vi.fn() }))
vi.mock('../entitlement',async(importOriginal)=>{
  const actual=await importOriginal<typeof import('../entitlement')>()
  return { pilotState:mocks.pilotState,requirePilotActive:mocks.requirePilotActive,
    isSelfServeClient:actual.isSelfServeClient,publicConnectOpen:actual.publicConnectOpen }
})
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
  mocks.requirePilotActive.mockResolvedValue({ revision:'ent-1',new_actions_allowed:true,source:'ops' })
  mocks.rpc.mockResolvedValue({ data:false,error:null })
  process.env.META_ADS_AI_GRAPH_VERSION='v21.0'
  delete process.env.META_ADS_AI_PUBLIC_CONNECT
})

/** `clients` is read by isSelfServeClient() inside status(); every other table keeps its own mock. */
function clientsQuery(source:string|null,error:unknown=null) {
  const result={ data:source===null ? null : { source },error }
  const chain:Record<string,unknown>={}
  for(const method of ['select','eq']) chain[method]=vi.fn(()=>chain)
  chain.maybeSingle=vi.fn(()=>Promise.resolve(result))
  return chain
}

describe('撤销连接',()=>{
  it('零行更新不能被当成撤销成功',async()=>{
    mocks.from.mockReturnValue(updateQuery([]))
    await expect(revoke('client','principal','connection','00000000-0000-4000-8000-000000000001')).rejects.toThrow('disconnect_not_found')
  })

  it('连接撤销同时校验客户、用途和 OAuth 发起人，并在同一条 UPDATE 清空 owner',async()=>{
    const query=updateQuery([{ id:'connection' }]);mocks.from.mockReturnValue(query)
    await expect(revoke('client','principal','connection','connection')).resolves.toBeUndefined()
    expect(query.eq).toHaveBeenCalledWith('client_id','client')
    expect(query.eq).toHaveBeenCalledWith('purpose','meta_ads_read')
    expect(query.eq).toHaveBeenCalledWith('authorizing_principal_id','principal')
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({
      status:'revoked',authorizing_principal_id:null,
    }))
  })

  it('断开是单次原子 UPDATE，不先撤销 grants 再删连接',async()=>{
    const query=updateQuery([{ id:'connection' }]);mocks.from.mockReturnValue(query)
    await revoke('client','principal','connection','connection')
    expect(mocks.from).toHaveBeenCalledTimes(1)
    expect(mocks.from).toHaveBeenCalledWith('platform_oauth_connections')
  })

  it('断开写入失败时报 disconnect_failed',async()=>{
    mocks.from.mockReturnValue(updateQuery(null,{ message:'boom' }))
    await expect(revoke('client','principal','connection','connection')).rejects.toThrow('disconnect_failed')
  })

  it('非 owner 断开得到零行，报 disconnect_not_found',async()=>{
    mocks.from.mockReturnValue(updateQuery([]))
    await expect(revoke('client','principal','connection','connection')).rejects.toThrow('disconnect_not_found')
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
      if(table==='clients') return clientsQuery('fde')
      throw new Error(`unexpected table ${table}`)
    })
    const result=await status('client','principal')
    expect(result.keys).toEqual([expect.objectContaining({ id:'key',access_active:false,last_successful_read:null })])
    expect(result.grants).toEqual([])
    expect(result.self_serve).toBe(false)
    expect(result.public_connect).toBe(false)
  })

  it('原 owner 断开后（owner 已清空）仍能看到自己的旧 key，但 access_active 为 false',async()=>{
    mocks.pilotState.mockResolvedValue({ invited:true,new_actions_allowed:true,reason:'ready',revision:'ent-1' })
    mocks.from.mockImplementation((table:string)=>{
      if(table==='platform_oauth_connections') return selectQuery([{ id:'connection',status:'revoked',token_expiry:'2099-01-01',authorizing_principal_id:null,entitlement_revision:'ent-1' }])
      if(table==='meta_ads_read_grants') return selectQuery([{ id:'grant',ad_account_id:'act_1234567890',connection_id:'connection',revision:'r1',principal_id:'principal',revoked_at:'2026-09-23',entitlement_revision:'ent-1' }])
      if(table==='client_api_keys') return selectQuery([{ id:'key',key_prefix:'me_live_demo',expires_at:'2099-01-01',last_used_at:null,metadata:{ meta_ads_grant_id:'grant',meta_ads_grant_revision:'r1',meta_ads_principal_id:'principal',meta_ads_entitlement_revision:'ent-1' } }])
      if(table==='mcp_access_log') return selectQuery(null)
      if(table==='clients') return clientsQuery('fde')
      throw new Error(`unexpected table ${table}`)
    })
    const result=await status('client','principal')
    expect(result.keys).toEqual([expect.objectContaining({ id:'key',access_active:false })])
  })

  it('接手后 owner 变为新成员，原 owner 看不到该连接卡片，新 owner 看得到',async()=>{
    mocks.pilotState.mockResolvedValue({ invited:true,new_actions_allowed:true,reason:'ready',revision:'ent-1' })
    mocks.from.mockImplementation((table:string)=>{
      if(table==='platform_oauth_connections') return selectQuery([{ id:'connection',status:'active',token_expiry:'2099-01-01',authorizing_principal_id:'new-principal',entitlement_revision:'ent-1' }])
      if(table==='meta_ads_read_grants') return selectQuery([{ id:'grant',ad_account_id:'act_1234567890',connection_id:'connection',revision:'r2',principal_id:'new-principal',revoked_at:null,entitlement_revision:'ent-1' }])
      if(table==='client_api_keys') return selectQuery([])
      if(table==='mcp_access_log') return selectQuery(null)
      if(table==='clients') return clientsQuery('fde')
      throw new Error(`unexpected table ${table}`)
    })
    const previousOwner=await status('client','principal')
    expect(previousOwner.connections).toEqual([])
    expect(previousOwner.grants).toEqual([])
    const newOwner=await status('client','new-principal')
    expect(newOwner.connections).toEqual([expect.objectContaining({ id:'connection',status:'active' })])
    expect(newOwner.grants).toEqual([expect.objectContaining({ id:'grant',ad_account_id:'act_1234567890' })])
  })

  it('不会把明确属于其他发行人的密钥显示给当前用户',async()=>{
    mocks.pilotState.mockResolvedValue({ invited:true,new_actions_allowed:true,reason:'ready',revision:'ent-1' })
    mocks.from.mockImplementation((table:string)=>{
      if(table==='platform_oauth_connections') return selectQuery([{ id:'connection',status:'active',token_expiry:'2099-01-01',authorizing_principal_id:'principal',entitlement_revision:'ent-1' }])
      if(table==='meta_ads_read_grants') return selectQuery([{ id:'grant',ad_account_id:'act_1234567890',connection_id:'connection',revision:'r1',principal_id:'principal',revoked_at:null,entitlement_revision:'ent-1' }])
      if(table==='client_api_keys') return selectQuery([{ id:'key',key_prefix:'me_live_demo',expires_at:'2099-01-01',last_used_at:null,metadata:{ meta_ads_grant_id:'grant',meta_ads_grant_revision:'r1',meta_ads_principal_id:'other',meta_ads_entitlement_revision:'ent-1' } }])
      if(table==='clients') return clientsQuery('fde')
      throw new Error(`unexpected table ${table}`)
    })
    expect((await status('client','principal')).keys).toEqual([])
  })

  it('默认返回 self_serve:false 与 public_connect:false',async()=>{
    mocks.pilotState.mockResolvedValue({ invited:true,new_actions_allowed:true,reason:'ready',revision:'ent-1',source:'ops' })
    mocks.from.mockImplementation((table:string)=>{
      if(table==='platform_oauth_connections') return selectQuery([])
      if(table==='meta_ads_read_grants') return selectQuery([])
      if(table==='client_api_keys') return selectQuery([])
      if(table==='clients') return clientsQuery('fde')
      throw new Error(`unexpected table ${table}`)
    })
    const result=await status('client','principal')
    expect(result.self_serve).toBe(false)
    expect(result.public_connect).toBe(false)
  })

  it('自助客户返回 self_serve:true，且 META_ADS_AI_PUBLIC_CONNECT=true 时 public_connect:true',async()=>{
    process.env.META_ADS_AI_PUBLIC_CONNECT='true'
    mocks.pilotState.mockResolvedValue({ invited:true,new_actions_allowed:true,reason:'ready',revision:'ent-1',source:'self_serve' })
    mocks.from.mockImplementation((table:string)=>{
      if(table==='platform_oauth_connections') return selectQuery([])
      if(table==='meta_ads_read_grants') return selectQuery([])
      if(table==='client_api_keys') return selectQuery([])
      if(table==='clients') return clientsQuery('self_serve')
      throw new Error(`unexpected table ${table}`)
    })
    const result=await status('client','principal')
    expect(result.self_serve).toBe(true)
    expect(result.public_connect).toBe(true)
  })
})

describe('换人接手绑定',()=>{
  it('新 owner 绑定同一账户时插入新 grant，不复活旧 grant',async()=>{
    const insertChain={ select:vi.fn(()=>insertChain),single:vi.fn(()=>Promise.resolve({ data:{ id:'new-grant',ad_account_id:'act_1234567890' },error:null })) }
    mocks.from.mockReturnValue({ insert:vi.fn(()=>insertChain) })
    mocks.activeConnectionForPrincipal.mockResolvedValue({ token:'private',version:'v1',entitlementRevision:'ent-1' })
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({ id:'act_1234567890' }),{ status:200 })))
    await expect(bind('client','principal','connection','act_1234567890')).resolves.toEqual({ id:'new-grant',ad_account_id:'act_1234567890' })
  })

  it('重复 bind 只有在身份字段全部匹配同一 active grant 时才幂等返回',async()=>{
    const insertChain={ select:vi.fn(()=>insertChain),single:vi.fn(()=>Promise.resolve({ data:null,error:{ code:'23505',message:'duplicate key' } })) }
    const readChain=selectQuery({ id:'existing-grant',ad_account_id:'act_1234567890' })
    mocks.from.mockImplementation((table:string)=>{
      if(table==='meta_ads_read_grants') return { insert:vi.fn(()=>insertChain),select:readChain.select }
      throw new Error(`unexpected table ${table}`)
    })
    mocks.activeConnectionForPrincipal.mockResolvedValue({ token:'private',version:'v1',entitlementRevision:'ent-1' })
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({ id:'act_1234567890' }),{ status:200 })))
    await expect(bind('client','principal','connection','act_1234567890')).resolves.toEqual({ id:'existing-grant',ad_account_id:'act_1234567890' })
    expect(readChain.eq).toHaveBeenCalledWith('principal_id','principal')
    expect(readChain.eq).toHaveBeenCalledWith('connection_id','connection')
    expect(readChain.eq).toHaveBeenCalledWith('entitlement_revision','ent-1')
    expect(readChain.is).toHaveBeenCalledWith('revoked_at',null)
  })

  it('广告账户被拉黑时 bind 直接报 blocked，且不调用 Graph',async()=>{
    mocks.rpc.mockResolvedValueOnce({ data:true,error:null })
    const fetchMock=vi.fn()
    vi.stubGlobal('fetch',fetchMock)
    await expect(bind('client','principal','connection','act_1234567890')).rejects.toThrow('blocked')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('唯一冲突但身份不匹配时报 account_unavailable，不把他人 grant 当自己的',async()=>{
    const insertChain={ select:vi.fn(()=>insertChain),single:vi.fn(()=>Promise.resolve({ data:null,error:{ code:'23505',message:'duplicate key' } })) }
    const readChain=selectQuery(null)
    mocks.from.mockImplementation((table:string)=>{
      if(table==='meta_ads_read_grants') return { insert:vi.fn(()=>insertChain),select:readChain.select }
      throw new Error(`unexpected table ${table}`)
    })
    mocks.activeConnectionForPrincipal.mockResolvedValue({ token:'private',version:'v1',entitlementRevision:'ent-1' })
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({ id:'act_1234567890' }),{ status:200 })))
    await expect(bind('client','principal','connection','act_1234567890')).rejects.toThrow('account_unavailable')
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
    const insertChain={ select:vi.fn(()=>insertChain),single:vi.fn(()=>Promise.resolve({ data:null,error:{ code:'23505',message:'duplicate key value violates unique constraint "meta_ads_exclusive_active_account"',details:'Key (ad_account_id)=(act_1234567890) already exists.',hint:null } })) }
    const readChain=selectQuery(null)
    mocks.from.mockImplementation((table:string)=>{
      if(table==='meta_ads_read_grants') return { insert:vi.fn(()=>insertChain),select:readChain.select }
      throw new Error(`unexpected table ${table}`)
    })
    mocks.activeConnectionForPrincipal.mockResolvedValue({ token:'private',version:'v1',entitlementRevision:'ent-1' })
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({ id:'act_1234567890' }),{ status:200 })))
    await expect(bind('client','principal','connection','act_1234567890')).rejects.toThrow('account_unavailable')
    expect(warn).toHaveBeenCalledWith('[meta-ads-ai] grant insert failed',expect.objectContaining({
      clientId:'client',code:'23505',message:expect.stringContaining('meta_ads_exclusive_active_account'),
    }))
  })


  it('自助客户不能签发外部 API key，报 not_available 且不写入凭据',async()=>{
    mocks.from.mockImplementation((table:string)=>{
      if(table==='meta_ads_read_grants') return selectQuery({ connection_id:'connection',revision:'grant-r1',principal_id:'principal',entitlement_revision:'ent-1' })
      throw new Error(`unexpected table ${table}`)
    })
    mocks.activeConnectionForPrincipal.mockResolvedValue({ token:'private',version:'v1',entitlementRevision:'ent-1' })
    mocks.requirePilotActive.mockResolvedValueOnce({ revision:'ent-1',new_actions_allowed:true,source:'self_serve' })
    await expect(issueKey('client','principal','grant','person@example.test')).rejects.toThrow('not_available')
    expect(mocks.from).toHaveBeenCalledTimes(1)
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
