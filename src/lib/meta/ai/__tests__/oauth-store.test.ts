import { beforeEach,describe,it,expect,vi } from 'vitest'
const mocks=vi.hoisted(()=>({ from:vi.fn(),rpc:vi.fn(),insertAudit:vi.fn(),finishAudit:vi.fn(),requirePilotActive:vi.fn(),requirePilotRevision:vi.fn() }))
vi.mock('@/lib/supabase',()=>({ supabaseAdmin:{ from:mocks.from,rpc:mocks.rpc } }))
vi.mock('@/lib/clients/binding-audit',()=>({ insertBindingAudit:mocks.insertAudit,finishBindingAudit:mocks.finishAudit }))
vi.mock('@/lib/platform-oauth/vocabulary',()=>({ decryptToken:vi.fn(()=> 'private') }))
vi.mock('../entitlement',()=>({ requirePilotActive:mocks.requirePilotActive,requirePilotRevision:mocks.requirePilotRevision }))
import { readGrant,activeConnection,activeConnectionForPrincipal,requireMetaScope,requireReleaseAuthorization,requireDiscoveryAuthorization } from '../store'
import { auditedControl } from '../audit'
import { consumeAdsState,startAdsConsent } from '@/lib/meta-oauth/ads-read'
const p={ kind:'client' as const,keyId:'key',clientId:'tenant',scopes:['meta:ads:read'] }
const grant={ id:'grant',client_id:'tenant',ad_account_id:'act_1234567890',revision:'r1',entitlement_revision:'ent-1' }
function chain(data:unknown,error:unknown=null){ const result={ data,error };const c:Record<string,unknown>={ then:(resolve:(v:unknown)=>unknown)=>Promise.resolve(result).then(resolve) };for(const method of ['select','insert','delete','eq','is','gt','lt','contains','maybeSingle']) c[method]=vi.fn(()=>c);return c }
function key(metadata:unknown={ meta_ads_grant_id:'grant',meta_ads_grant_revision:'r1',meta_ads_entitlement_revision:'ent-1' }) { return { metadata,scopes:p.scopes,expires_at:new Date(Date.now()+100000).toISOString() } }
beforeEach(()=>{ vi.resetAllMocks();process.env.META_ADS_AI_ENABLED='true';mocks.rpc.mockResolvedValue({ data:false,error:null });mocks.insertAudit.mockResolvedValue({ id:'audit' });mocks.finishAudit.mockResolvedValue(true)
  mocks.requirePilotActive.mockResolvedValue({ revision:'ent-1',new_actions_allowed:true });mocks.requirePilotRevision.mockResolvedValue({ revision:'ent-1',new_actions_allowed:true }) })
describe('grant, token and control audit guards',()=>{
  it('requires explicit Meta scope, never inherits read:all',()=>{ expect(()=>requireMetaScope({ ...p,scopes:['read:all'] })).toThrow('scope_required') })
  it('denies revoked, expired and revision-stale keys',async()=>{
    for(const value of [null,{ ...key(),expires_at:'2020-01-01' },{ ...key(),metadata:{} }]) {
      mocks.from.mockReturnValueOnce(chain(value));await expect(readGrant(p)).rejects.toThrow()
    }
    mocks.from.mockReturnValueOnce(chain(key())).mockReturnValueOnce(chain({ ...grant,revision:'r2' }))
    await expect(readGrant(p)).rejects.toThrow('grant_changed')
  })
  it('rejects conflict and DB lookup failure',async()=>{
    mocks.from.mockReturnValueOnce(chain(key())).mockReturnValueOnce(chain(grant));mocks.rpc.mockResolvedValueOnce({ data:true,error:null })
    await expect(readGrant(p)).rejects.toThrow('account_unavailable')
    mocks.from.mockReturnValueOnce(chain(null,{ message:'sensitive db error' }))
    await expect(readGrant(p)).rejects.toThrow('authorization_unavailable')
  })
  it('does not reactivate an old key after a terminal invitation is renewed',async()=>{
    mocks.requirePilotActive.mockResolvedValueOnce({ revision:'ent-2',new_actions_allowed:true })
    mocks.from.mockReturnValueOnce(chain(key())).mockReturnValueOnce(chain(grant))
    await expect(readGrant(p)).rejects.toThrow('invitation_changed')
  })
  it('scopes token lookup by tenant/purpose/provider/status/scope/expiry',async()=>{
    const q=chain({ id:'connection',access_token_enc:'cipher',updated_at:'v1',entitlement_revision:'ent-1' });mocks.from.mockReturnValue(q)
    expect(await activeConnection('tenant','connection')).toMatchObject({ token:'private' })
    for(const pair of [['client_id','tenant'],['id','connection'],['provider','meta'],['purpose','meta_ads_read'],['status','active']]) expect(q.eq).toHaveBeenCalledWith(...pair)
    expect(q.contains).toHaveBeenCalledWith('scopes',['ads_read']);expect(q.gt).toHaveBeenCalledWith('token_expiry',expect.any(String))
  })
  it('scopes dashboard discovery to the user who completed OAuth',async()=>{
    const q=chain({ id:'connection',access_token_enc:'cipher',updated_at:'v1',entitlement_revision:'ent-1' });mocks.from.mockReturnValue(q)
    await activeConnectionForPrincipal('tenant','connection','principal-a')
    expect(q.eq).toHaveBeenCalledWith('authorizing_principal_id','principal-a')
  })
  it('uses one database decision for the final key, grant, connection and invitation check',async()=>{
    mocks.rpc.mockResolvedValueOnce({ data:true,error:null })
    await expect(requireReleaseAuthorization(p,'act_1234567890')).resolves.toBeUndefined()
    expect(mocks.rpc).toHaveBeenCalledWith('meta_ads_authorization_current',{ tenant:'tenant',key_id:'key',account:'act_1234567890' })
    mocks.rpc.mockResolvedValueOnce({ data:false,error:null })
    await expect(requireReleaseAuthorization(p,'act_1234567890')).rejects.toThrow('authorization_changed')
  })
  it('uses one database decision before releasing discovered accounts',async()=>{
    mocks.rpc.mockResolvedValueOnce({ data:true,error:null })
    await expect(requireDiscoveryAuthorization('tenant','connection','principal','v1')).resolves.toBeUndefined()
    expect(mocks.rpc).toHaveBeenCalledWith('meta_ads_discovery_current',{ tenant:'tenant',conn_id:'connection',principal:'principal',expected_version:'v1' })
    mocks.rpc.mockResolvedValueOnce({ data:false,error:null })
    await expect(requireDiscoveryAuthorization('tenant','connection','principal','v1')).rejects.toThrow('authorization_changed')
  })
  it('does not mutate when audit is unavailable',async()=>{
    const write=vi.fn();mocks.insertAudit.mockResolvedValueOnce({ error:'unavailable' })
    await expect(auditedControl('tenant','person@example.test','bind','act_1234567890',write)).rejects.toThrow('audit_unavailable')
    expect(write).not.toHaveBeenCalled()
  })
  it('records failed operations using safe categories and refuses false success',async()=>{
    await expect(auditedControl('tenant','person@example.test','bind',null,async()=>{ throw new Error('secret database details') })).rejects.toThrow()
    expect(mocks.finishAudit).toHaveBeenCalledWith('audit','write_failed','bind:request_failed')
    mocks.finishAudit.mockClear().mockResolvedValue(false)
    await expect(auditedControl('tenant','person@example.test','bind',null,async()=>({ ok:true }))).rejects.toThrow('audit_completion_failed')
    expect(mocks.finishAudit).toHaveBeenCalledTimes(1)
    expect(mocks.finishAudit).toHaveBeenCalledWith('audit','applied','bind')
  })
})
describe('OAuth state principal and browser binding',()=>{
  it('atomically consumes with all identity constraints and TTL',async()=>{
    const q=chain({ client_id:'tenant',entitlement_revision:'ent-1' });mocks.from.mockReturnValue(q)
    await expect(consumeAdsState('s'.repeat(43),'b'.repeat(43),'principal')).resolves.toEqual({ clientId:'tenant',entitlementRevision:'ent-1' })
    expect(q.delete).toHaveBeenCalled();expect(q.eq).toHaveBeenCalledWith('principal_id','principal');expect(q.eq).toHaveBeenCalledWith('browser_hash',expect.not.stringContaining('bbbb'))
    expect(q.gt).toHaveBeenCalledWith('expires_at',expect.any(String))
  })
  it('refuses missing browser binding, replay and lookup failure',async()=>{
    await expect(consumeAdsState('s'.repeat(43),'','principal')).rejects.toThrow('invalid_oauth_state')
    expect(mocks.from).not.toHaveBeenCalled();mocks.from.mockReturnValue(chain(null))
    await expect(consumeAdsState('s'.repeat(43),'b'.repeat(43),'principal')).rejects.toThrow('invalid_oauth_state')
  })
  it('requests only ads_read and stores hashes, not state/cookie plaintext',async()=>{
    process.env.FACEBOOK_APP_ID='test';process.env.FACEBOOK_APP_SECRET='test';process.env.NEXT_PUBLIC_APP_URL='https://app.example';process.env.META_ADS_AI_GRAPH_VERSION='v21.0'
    const q=chain(null);mocks.from.mockReturnValue(q)
    const result=await startAdsConsent('tenant','principal')
    expect(new URL(result.url).searchParams.get('scope')).toBe('ads_read')
    expect(new URL(result.url).searchParams.get('locale')).toBe('zh_CN')
    const stored=vi.mocked(q.insert as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(stored.state_hash).not.toBe(new URL(result.url).searchParams.get('state'));expect(stored.browser_hash).not.toBe(result.browser)
    expect(stored.entitlement_revision).toBe('ent-1')
  })
})
