import { beforeEach,describe,expect,it,vi } from 'vitest'

const mocks=vi.hoisted(()=>({
  from:vi.fn(),rpc:vi.fn(),metaGraphGet:vi.fn(),callClaudeChat:vi.fn(),activeConnection:vi.fn(),reserveRead:vi.fn(),requirePilot:vi.fn(),
}))
vi.mock('@/lib/supabase',()=>({ supabaseAdmin:{ from:mocks.from,rpc:mocks.rpc } }))
vi.mock('@/lib/anthropic/client',()=>({ MODEL_SONNET:'claude-sonnet-test',callClaudeChat:mocks.callClaudeChat }))
vi.mock('../store',()=>({ activeConnectionForPrincipal:mocks.activeConnection,reserveRead:mocks.reserveRead }))
vi.mock('../entitlement',()=>({ requirePilotActive:mocks.requirePilot }))
vi.mock('../../graph-read',async()=>{
  const actual=await vi.importActual<typeof import('../../graph-read')>('../../graph-read')
  return { ...actual,metaGraphGet:mocks.metaGraphGet }
})

import { generateAnalysis,listAnalyses } from '../analysis'

const grant={ id:'10000000-0000-4000-8000-000000000001',connection_id:'20000000-0000-4000-8000-000000000001',
  ad_account_id:'act_1234567890',revision:'30000000-0000-4000-8000-000000000001',entitlement_revision:'40000000-0000-4000-8000-000000000001' }
let jobStatus='running'
let sponsoredEnabled=true

function query(table:string) {
  const chain:Record<string,unknown>={}
  for(const method of ['select','eq','is','order','limit']) chain[method]=vi.fn(()=>chain)
  chain.maybeSingle=vi.fn(async()=>({ data:table==='meta_ads_ai_sponsored_budgets' ? null : grant,error:null }))
  chain.single=vi.fn(async()=>({ data:table==='meta_ads_ai_pilot_entitlements'
    ? { sponsored_analysis_enabled:sponsoredEnabled,sponsored_monthly_cap_usd:1,sponsored_analysis_reserve_usd:0.12 }
    : { id:'job-1',status:jobStatus,ad_account_id:grant.ad_account_id,
    window_since:'2026-09-13',window_until:'2026-09-19',report_markdown:jobStatus==='completed' ? '中文报告' : null,
    error_code:null,created_at:'2026-09-20T00:00:00Z',completed_at:jobStatus==='running' ? null : '2026-09-20T00:01:00Z' },error:null }))
  return chain
}

beforeEach(()=>{
  vi.clearAllMocks();jobStatus='running';sponsoredEnabled=true
  mocks.from.mockImplementation((table:string)=>query(table))
  mocks.requirePilot.mockResolvedValue({ revision:grant.entitlement_revision,new_actions_allowed:true })
  mocks.activeConnection.mockResolvedValue({ token:'encrypted-token-never-logged',version:'v1',entitlementRevision:grant.entitlement_revision })
  mocks.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
    if(name==='meta_ads_reserve_sponsored_analysis') return { data:{ reserved:true,idempotent:false,job_id:'job-1',reserve_usd:0.12 },error:null }
    if(name==='meta_ads_authorize_sponsored_analysis') return { data:true,error:null }
    if(name==='meta_ads_finish_sponsored_analysis') { jobStatus=String(args.final_status);return { data:true,error:null } }
    return { data:null,error:{ message:'unexpected rpc' } }
  })
})

describe('托管 Meta 广告分析',()=>{
  it('未开通赞助额度时不会请求 Meta 或付费模型',async()=>{
    sponsoredEnabled=false
    await expect(generateAnalysis('a1000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',grant.id))
      .rejects.toThrow('sponsored_analysis_unavailable')
    expect(mocks.reserveRead).not.toHaveBeenCalled()
    expect(mocks.metaGraphGet).not.toHaveBeenCalled()
    expect(mocks.callClaudeChat).not.toHaveBeenCalled()
  })

  it('没有广告数据时不调用付费模型',async()=>{
    mocks.metaGraphGet.mockImplementation(async(path:string)=>path===grant.ad_account_id
      ? { id:grant.ad_account_id,currency:'NZD',timezone_name:'Pacific/Auckland' }
      : { data:[] })
    const result=await generateAnalysis('a1000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',grant.id)
    expect(result.status).toBe('no_data')
    expect(mocks.callClaudeChat).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenCalledWith('meta_ads_finish_sponsored_analysis',expect.objectContaining({ final_status:'no_data',charged_usd:0 }))
  })

  it('固定模型单次调用，并在完成前再次检查授权',async()=>{
    mocks.metaGraphGet.mockImplementation(async(path:string,_token:string,params:Record<string,string>)=>{
      if(path===grant.ad_account_id) return { id:grant.ad_account_id,currency:'NZD',timezone_name:'Pacific/Auckland' }
      if(params.level==='account') return { data:[{ spend:'100',impressions:'1000',clicks:'20',reach:'800',frequency:'1.25',actions:[{ action_type:'lead',value:'4' }] }] }
      return { data:[] }
    })
    mocks.callClaudeChat.mockResolvedValue({ text:'中文报告',input_tokens:500,output_tokens:200,cost_usd:0.0045,stop_reason:'end_turn' })
    const result=await generateAnalysis('a1000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',grant.id)
    expect(result.status).toBe('completed')
    expect(mocks.callClaudeChat).toHaveBeenCalledWith(expect.objectContaining({ model:'claude-sonnet-test',singleAttempt:true,maxOutputTokens:4000 }))
    expect(mocks.activeConnection).toHaveBeenCalledTimes(4)
    expect(mocks.rpc).toHaveBeenCalledWith('meta_ads_authorize_sponsored_analysis',{
      tenant:'a1000000-0000-4000-8000-000000000001',principal:'50000000-0000-4000-8000-000000000001',job:'job-1',
    })
    expect(mocks.rpc).toHaveBeenCalledWith('meta_ads_finish_sponsored_analysis',expect.objectContaining({ final_status:'completed',charged_usd:0.0045 }))
  })

  it('模型外发原子授权门拒绝时不发送证据',async()=>{
    mocks.metaGraphGet.mockImplementation(async(path:string,_token:string,params:Record<string,string>)=>{
      if(path===grant.ad_account_id) return { id:grant.ad_account_id,currency:'NZD',timezone_name:'Pacific/Auckland' }
      if(params.level==='account') return { data:[{ spend:'100',impressions:'1000',clicks:'20' }] }
      return { data:[] }
    })
    mocks.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
      if(name==='meta_ads_reserve_sponsored_analysis') return { data:{ reserved:true,idempotent:false,job_id:'job-1',reserve_usd:0.12 },error:null }
      if(name==='meta_ads_authorize_sponsored_analysis') return { data:false,error:null }
      if(name==='meta_ads_finish_sponsored_analysis') { jobStatus=String(args.final_status);return { data:true,error:null } }
      return { data:null,error:{ message:'unexpected rpc' } }
    })
    await expect(generateAnalysis('a1000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',grant.id))
      .rejects.toThrow('authorization_changed')
    expect(mocks.callClaudeChat).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenCalledWith('meta_ads_finish_sponsored_analysis',expect.objectContaining({ final_status:'failed',charged_usd:0 }))
  })

  it('按 UTF-8 字节限制多语言证据，超限时不会调用付费模型',async()=>{
    mocks.metaGraphGet.mockImplementation(async(path:string,_token:string,params:Record<string,string>)=>{
      if(path===grant.ad_account_id) return { id:grant.ad_account_id,currency:'元'.repeat(12_000),timezone_name:'Pacific/Auckland' }
      if(params.level==='account') return { data:[{ spend:'100',impressions:'1000',clicks:'20' }] }
      return { data:[] }
    })
    await expect(generateAnalysis('a1000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',grant.id))
      .rejects.toThrow('analysis_too_large')
    expect(mocks.callClaudeChat).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenCalledWith('meta_ads_finish_sponsored_analysis',expect.objectContaining({ final_status:'failed',charged_usd:0 }))
  })
})

describe('listAnalyses 只把图表用得到的证据字段发给浏览器',()=>{
  it('透传图表需要的 7 个字段，裁掉 video_ads/fatigue_candidates 等逐条广告 ID',async()=>{
    const fullEvidence={
      campaigns:[{ campaign_name:'A',spend:1 }],
      comparison:{ spend:{ current:1,previous:2,percent_change:-50 } },
      daily_campaigns:[{ date_start:'2026-09-15',spend:10 }],
      placements:[{ publisher_platform:'facebook',spend:5 }],
      age_gender:[{ age:'18-24',gender:'male',spend:3 }],
      devices:[{ device_platform:'mobile',spend:8 }],
      regions:[{ country:'NZ',spend:6 }],
      video_ads:[{ ad_id:'x' }],fatigue_candidates:[{ ad_id:'y' }],
    }
    const chain:Record<string,unknown>={}
    for(const method of ['select','eq','order','limit']) chain[method]=vi.fn(()=>chain)
    chain.then=(resolve:(value:unknown)=>unknown)=>Promise.resolve({ data:[{ id:'job-1',status:'completed',ad_account_id:'act_1',
      window_since:'2026-09-15',window_until:'2026-09-21',report_markdown:'x',error_code:null,created_at:'t',completed_at:'t',
      evidence:fullEvidence }],error:null }).then(resolve)
    mocks.from.mockReturnValue(chain)
    const [result]=await listAnalyses('client','principal')
    expect(result.evidence).toEqual({
      campaigns:fullEvidence.campaigns,comparison:fullEvidence.comparison,
      daily_campaigns:fullEvidence.daily_campaigns,placements:fullEvidence.placements,
      age_gender:fullEvidence.age_gender,devices:fullEvidence.devices,regions:fullEvidence.regions,
    })
    expect(result.evidence).not.toHaveProperty('video_ads')
    expect(result.evidence).not.toHaveProperty('fatigue_candidates')
  })

  it('evidence 为 null 时不报错，直接透传 null',async()=>{
    const chain:Record<string,unknown>={}
    for(const method of ['select','eq','order','limit']) chain[method]=vi.fn(()=>chain)
    chain.then=(resolve:(value:unknown)=>unknown)=>Promise.resolve({ data:[{ id:'job-1',status:'failed',ad_account_id:'act_1',
      window_since:'2026-09-15',window_until:'2026-09-21',report_markdown:null,error_code:'analysis_too_large',created_at:'t',completed_at:'t',
      evidence:null }],error:null }).then(resolve)
    mocks.from.mockReturnValue(chain)
    const [result]=await listAnalyses('client','principal')
    expect(result.evidence).toBeNull()
  })
})
