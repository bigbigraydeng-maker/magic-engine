import { createHash } from 'node:crypto'
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'

const mocks=vi.hoisted(()=>({ from:vi.fn(),rpc:vi.fn() }))
vi.mock('@/lib/supabase',()=>({ supabaseAdmin:{ from:mocks.from,rpc:mocks.rpc } }))

import { isSelfServeClient,publicConnectOpen,requireConnectAllowed,selfServeActivate,pilotEntryVisible } from '../entitlement'
import { facebookUserKey,isBlocked,requireNotBlocked } from '../blocklist'
import { MetaReadError } from '../../graph-read'

function clientsQuery(data:unknown,error:unknown=null) {
  const result={ data,error }
  const chain:Record<string,unknown>={}
  for(const method of ['select','eq']) chain[method]=vi.fn(()=>chain)
  chain.maybeSingle=vi.fn(()=>Promise.resolve(result))
  return chain
}

function entitlementQuery(data:unknown,error:unknown=null) {
  const result={ data,error }
  const chain:Record<string,unknown>={}
  for(const method of ['select','eq']) chain[method]=vi.fn(()=>chain)
  chain.maybeSingle=vi.fn(()=>Promise.resolve(result))
  return chain
}

beforeEach(()=>{
  vi.clearAllMocks()
  mocks.rpc.mockResolvedValue({ data:false,error:null })
  delete process.env.META_ADS_AI_PUBLIC_CONNECT
})

afterEach(()=>{
  delete process.env.META_ADS_AI_PUBLIC_CONNECT
})

describe('isSelfServeClient',()=>{
  it('clients.source === "self_serve" 时为 true',async()=>{
    mocks.from.mockReturnValue(clientsQuery({ source:'self_serve' }))
    await expect(isSelfServeClient('tenant')).resolves.toBe(true)
    expect(mocks.from).toHaveBeenCalledWith('clients')
  })

  it('其他 source 或缺失行时为 false',async()=>{
    mocks.from.mockReturnValueOnce(clientsQuery({ source:'fde' }))
    await expect(isSelfServeClient('tenant')).resolves.toBe(false)
    mocks.from.mockReturnValueOnce(clientsQuery(null))
    await expect(isSelfServeClient('tenant')).resolves.toBe(false)
  })

  it('查询失败时报 authorization_unavailable 503',async()=>{
    mocks.from.mockReturnValue(clientsQuery(null,{ message:'boom' }))
    await expect(isSelfServeClient('tenant')).rejects.toMatchObject({ code:'authorization_unavailable',status:503 })
  })
})

describe('publicConnectOpen',()=>{
  it('只有 META_ADS_AI_PUBLIC_CONNECT === "true" 时为 true',()=>{
    expect(publicConnectOpen()).toBe(false)
    process.env.META_ADS_AI_PUBLIC_CONNECT='true'
    expect(publicConnectOpen()).toBe(true)
    process.env.META_ADS_AI_PUBLIC_CONNECT='1'
    expect(publicConnectOpen()).toBe(false)
  })
})

describe('requireConnectAllowed',()=>{
  const base={ invited:true,new_actions_allowed:true,reason:'ready' as const,revision:'ent-1',sponsored_analysis_enabled:false }

  it('ops 客户在开关关闭时也允许连接',()=>{
    expect(()=>requireConnectAllowed({ ...base,source:'ops' })).not.toThrow()
  })

  it('自助客户在开关关闭时报 connect_waiting_review 403',()=>{
    expect(()=>requireConnectAllowed({ ...base,source:'self_serve' })).toThrow(MetaReadError)
    try { requireConnectAllowed({ ...base,source:'self_serve' }) } catch(error) {
      expect(error).toMatchObject({ code:'connect_waiting_review',status:403 })
    }
  })

  it('自助客户在开关打开时允许连接',()=>{
    process.env.META_ADS_AI_PUBLIC_CONNECT='true'
    expect(()=>requireConnectAllowed({ ...base,source:'self_serve' })).not.toThrow()
  })

  it('source 为 null 且开关关闭时报 connect_waiting_review',()=>{
    expect(()=>requireConnectAllowed({ ...base,source:null })).toThrow('connect_waiting_review')
  })
})

describe('selfServeActivate',()=>{
  it.each(['activated','renewed','already_active'])('透传 %s',async(result)=>{
    mocks.rpc.mockResolvedValueOnce({ data:{ ok:true,result },error:null })
    await expect(selfServeActivate('tenant','person@example.test')).resolves.toBe(result)
    expect(mocks.rpc).toHaveBeenCalledWith('meta_ads_self_serve_activate',{ tenant:'tenant',member_email:'person@example.test' })
  })

  it('ok:false 时报 activation_not_allowed 403',async()=>{
    mocks.rpc.mockResolvedValueOnce({ data:{ ok:false },error:null })
    await expect(selfServeActivate('tenant','person@example.test')).rejects.toMatchObject({ code:'activation_not_allowed',status:403 })
  })

  it('rpc 报错时报 authorization_unavailable 503',async()=>{
    mocks.rpc.mockResolvedValueOnce({ data:null,error:{ message:'boom' } })
    await expect(selfServeActivate('tenant','person@example.test')).rejects.toMatchObject({ code:'authorization_unavailable',status:503 })
  })

  it('未知 result 时报 authorization_unavailable 503',async()=>{
    mocks.rpc.mockResolvedValueOnce({ data:{ ok:true,result:'something_else' },error:null })
    await expect(selfServeActivate('tenant','person@example.test')).rejects.toMatchObject({ code:'authorization_unavailable',status:503 })
  })
})

describe('pilotEntryVisible',()=>{
  it('自助客户即使没有 entitlement 也可见',async()=>{
    mocks.from.mockImplementation((table:string)=>{
      if(table==='meta_ads_ai_pilot_entitlements') return entitlementQuery(null)
      if(table==='platform_oauth_connections') return entitlementQuery([])
      if(table==='meta_ads_read_grants') return entitlementQuery([])
      if(table==='client_api_keys') return entitlementQuery([])
      if(table==='clients') return clientsQuery({ source:'self_serve' })
      throw new Error(`unexpected table ${table}`)
    })
    await expect(pilotEntryVisible('tenant')).resolves.toBe(true)
  })

  it('非自助客户且没有 entitlement 时不可见',async()=>{
    mocks.from.mockImplementation((table:string)=>{
      if(table==='meta_ads_ai_pilot_entitlements') return entitlementQuery(null)
      if(table==='platform_oauth_connections') return entitlementQuery([])
      if(table==='meta_ads_read_grants') return entitlementQuery([])
      if(table==='client_api_keys') return entitlementQuery([])
      if(table==='clients') return clientsQuery({ source:'fde' })
      throw new Error(`unexpected table ${table}`)
    })
    await expect(pilotEntryVisible('tenant')).resolves.toBe(false)
  })
})

describe('blocklist',()=>{
  it('facebookUserKey 等于 sha256("meta-ads-user:" + accountId) 的十六进制，且为 64 位',()=>{
    const expected=createHash('sha256').update('meta-ads-user:ads_user:111').digest('hex')
    const actual=facebookUserKey('ads_user:111')
    expect(actual).toBe(expected)
    expect(actual).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rpc 返回 true 时 requireNotBlocked 报 blocked 403',async()=>{
    mocks.rpc.mockResolvedValueOnce({ data:true,error:null })
    await expect(requireNotBlocked('facebook_user','key')).rejects.toMatchObject({ code:'blocked',status:403 })
    expect(mocks.rpc).toHaveBeenCalledWith('meta_ads_is_blocked',{ p_kind:'facebook_user',p_key:'key' })
  })

  it('rpc 返回 false 时 requireNotBlocked 通过',async()=>{
    mocks.rpc.mockResolvedValueOnce({ data:false,error:null })
    await expect(requireNotBlocked('ad_account','key')).resolves.toBeUndefined()
  })

  it('rpc 报错时报 authorization_unavailable 503',async()=>{
    mocks.rpc.mockResolvedValueOnce({ data:null,error:{ message:'boom' } })
    await expect(isBlocked('facebook_user','key')).rejects.toMatchObject({ code:'authorization_unavailable',status:503 })
  })
})
