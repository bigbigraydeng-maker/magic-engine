// @vitest-environment node
import { beforeEach,describe,it,expect,vi } from 'vitest'
const mocks=vi.hoisted(()=>({ verifyApiKey:vi.fn(),readGrant:vi.fn(),activeConnection:vi.fn(),reserveRead:vi.fn(),invokeMetaTool:vi.fn() }))
vi.mock('@/lib/auth/api-key-access',async original=>({ ...await original<typeof import('@/lib/auth/api-key-access')>(),verifyApiKey:mocks.verifyApiKey }))
vi.mock('../store',()=>({ ...mocks,requireMetaScope:vi.fn() }))
vi.mock('../read',()=>({ invokeMetaTool:mocks.invokeMetaTool }))
import { POST as mcp } from '@/app/api/mcp/[transport]/route'
import { POST as invoke } from '@/app/api/ai-tools/meta/invoke/route'
import { toolNames } from '../contract'
import { MetaReadError } from '../../graph-read'
const principal={ kind:'client',keyId:'key',clientId:'tenant',scopes:['meta:ads:read'] }
function req(body:unknown,endpoint='mcp/mcp') { return new Request(`https://app.example/api/${endpoint}`,{ method:'POST',headers:{ Authorization:'Bearer me_live_test',Accept:'application/json, text/event-stream','Content-Type':'application/json' },body:JSON.stringify(body) }) }
async function rpcBody(response:Response) {
  const text=await response.text()
  return JSON.parse(text.startsWith('event:') ? text.split('\n').find(line=>line.startsWith('data:'))!.slice(5) : text)
}
beforeEach(()=>{
  vi.clearAllMocks();process.env.META_ADS_AI_ENABLED='true'
  mocks.verifyApiKey.mockResolvedValue({ ok:true,auth:principal });mocks.readGrant.mockResolvedValue({ connection_id:'connection' });mocks.activeConnection.mockResolvedValue({ token:'secret' })
})
describe('real MCP adapter catalogue and HTTP boundaries',()=>{
  it('public key lists only the eight Meta tools',async()=>{
    const response=await mcp(req({ jsonrpc:'2.0',id:1,method:'tools/list',params:{} }))
    expect(response.status).toBe(200)
    const body=await rpcBody(response)
    expect(body.result.tools.map((t:{ name:string })=>t.name)).toEqual([...toolNames])
  })
  it('legacy key never discovers new Meta tools',async()=>{
    mocks.verifyApiKey.mockResolvedValue({ ok:true,auth:{ ...principal,scopes:['read:all'] } })
    const response=await mcp(req({ jsonrpc:'2.0',id:1,method:'tools/list',params:{} }))
    const body=await rpcBody(response)
    expect(body.result.tools.map((t:{ name:string })=>t.name)).toContain('me_ping')
    expect(body.result.tools.some((t:{ name:string })=>t.name.startsWith('meta_'))).toBe(false)
  })
  it('public key cannot call a paid tool by guessing its name',async()=>{
    const response=await mcp(req({ jsonrpc:'2.0',id:1,method:'tools/call',params:{ name:'me_get_overview',arguments:{} } }))
    const body=await rpcBody(response)
    expect(body.error ?? body.result?.isError).toBeTruthy()
    expect(mocks.invokeMetaTool).not.toHaveBeenCalled()
  })
  it('does not cache one client tool catalogue for another client',async()=>{
    await mcp(req({ jsonrpc:'2.0',id:1,method:'tools/list',params:{} }))
    mocks.verifyApiKey.mockResolvedValue({ ok:true,auth:{ ...principal,clientId:'tenant-b',keyId:'key-b',scopes:['read:all'] } })
    const body=await rpcBody(await mcp(req({ jsonrpc:'2.0',id:2,method:'tools/list',params:{} })))
    expect(body.result.tools.map((t:{ name:string })=>t.name)).not.toContain('meta_list_accounts')
  })
  it.each([['mcp',mcp],['http',invoke]] as const)('%s rejects oversized JSON before tool execution',async(_name,handler)=>{
    const result=await handler(req({ tool:'meta_list_accounts',arguments:{ huge:'x'.repeat(25000) } }))
    expect(result.status).toBe(413);expect(mocks.invokeMetaTool).not.toHaveBeenCalled()
  })
  it('both adapters reject disabled features and invalid auth',async()=>{
    process.env.META_ADS_AI_ENABLED='false'
    expect((await mcp(req({}))).status).toBe(404);expect((await invoke(req({}))).status).toBe(404)
    process.env.META_ADS_AI_ENABLED='true';mocks.verifyApiKey.mockResolvedValue({ ok:false })
    expect((await mcp(req({}))).status).toBe(401);expect((await invoke(req({}))).status).toBe(401)
  })
  it('HTTP maps rate limits without leaking exception details',async()=>{
    mocks.invokeMetaTool.mockRejectedValueOnce(new MetaReadError('rate_limited',429))
    const response=await invoke(req({ tool:'meta_list_accounts',arguments:{} }))
    expect(response.status).toBe(429);expect(await rpcBody(response)).toEqual({ error:'rate_limited' })
  })
})
