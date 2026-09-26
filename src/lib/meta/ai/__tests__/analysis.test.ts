import { beforeEach,describe,expect,it,vi } from 'vitest'
import { APIConnectionError, APIConnectionTimeoutError } from '@anthropic-ai/sdk'

const mocks=vi.hoisted(()=>({
  from:vi.fn(),rpc:vi.fn(),metaGraphGet:vi.fn(),callClaudeChat:vi.fn(),activeConnection:vi.fn(),reserveRead:vi.fn(),requirePilot:vi.fn(),
}))
vi.mock('@/lib/supabase',()=>({ supabaseAdmin:{ from:mocks.from,rpc:mocks.rpc } }))
vi.mock('@/lib/anthropic/client',()=>({ MODEL_HAIKU:'claude-haiku-test',callClaudeChat:mocks.callClaudeChat }))
vi.mock('../store',()=>({ activeConnectionForPrincipal:mocks.activeConnection,reserveRead:mocks.reserveRead }))
vi.mock('../entitlement',()=>({ requirePilotActive:mocks.requirePilot }))
vi.mock('../../graph-read',async()=>{
  const actual=await vi.importActual<typeof import('../../graph-read')>('../../graph-read')
  return { ...actual,metaGraphGet:mocks.metaGraphGet }
})

import { generateAnalysis,listAnalyses,normaliseHeadings,placeRuleSection,safeCharge,stripFatigueSentences } from '../analysis'

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
    expect(mocks.callClaudeChat).toHaveBeenCalledWith(expect.objectContaining({ model:'claude-haiku-test',singleAttempt:true,maxOutputTokens:4000 }))
    expect(mocks.callClaudeChat.mock.calls[0]?.[0].systemPrompt).toContain('这一部分由系统另外写好')
    expect(mocks.activeConnection).toHaveBeenCalledTimes(4)
    expect(mocks.rpc).toHaveBeenCalledWith('meta_ads_authorize_sponsored_analysis',{
      tenant:'a1000000-0000-4000-8000-000000000001',principal:'50000000-0000-4000-8000-000000000001',job:'job-1',
    })
    expect(mocks.rpc).toHaveBeenCalledWith('meta_ads_finish_sponsored_analysis',expect.objectContaining({ final_status:'completed',charged_usd:0.0045 }))
  })

  it('真实 max_tokens 停止原因按截断失败处理，绝不保存或展示半份报告',async()=>{
    mocks.metaGraphGet.mockImplementation(async(path:string,_token:string,params:Record<string,string>)=>{
      if(path===grant.ad_account_id) return { id:grant.ad_account_id,currency:'NZD',timezone_name:'Pacific/Auckland' }
      if(params.level==='account') return { data:[{ spend:'100',impressions:'1000',clicks:'20' }] }
      return { data:[] }
    })
    const log=vi.spyOn(console,'error').mockImplementation(()=>undefined)
    mocks.callClaudeChat.mockResolvedValue({ text:'只有前半份的报告',input_tokens:500,output_tokens:2000,cost_usd:0.02,stop_reason:'max_tokens' })

    await expect(generateAnalysis('a1000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',grant.id))
      .rejects.toThrow('analysis_incomplete')

    expect(mocks.callClaudeChat).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith('[meta-ads-ai] hosted model response incomplete',{
      category:'output_truncated',model:'claude-haiku-test',
    })
    expect(mocks.rpc).toHaveBeenCalledWith('meta_ads_finish_sponsored_analysis',expect.objectContaining({
      final_status:'failed',charged_usd:0.02,report_body:null,failure_code:'analysis_incomplete',
    }))
  })

  it('报告被截断时按 analysis_incomplete 失败，且不保存半份报告',async()=>{
    mocks.metaGraphGet.mockImplementation(async(path:string,_token:string,params:Record<string,string>)=>{
      if(path===grant.ad_account_id) return { id:grant.ad_account_id,currency:'NZD',timezone_name:'Pacific/Auckland' }
      if(params.level==='account') return { data:[{ spend:'100',impressions:'1000',clicks:'20' }] }
      return { data:[] }
    })
    const log=vi.spyOn(console,'error').mockImplementation(()=>undefined)
    mocks.callClaudeChat.mockResolvedValue({ text:'前半份报告',input_tokens:500,output_tokens:2000,cost_usd:0.02,stop_reason:'max_tokens' })
    await expect(generateAnalysis('a1000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',grant.id))
      .rejects.toThrow('analysis_incomplete')
    expect(log).toHaveBeenCalledWith('[meta-ads-ai] hosted model response incomplete',{
      category:'output_truncated',model:'claude-haiku-test',
    })
    expect(mocks.rpc).toHaveBeenCalledWith('meta_ads_finish_sponsored_analysis',expect.objectContaining({
      final_status:'failed',report_body:null,failure_code:'analysis_incomplete',
    }))
  })

  it('模型失败只记录非敏感错误类别和模型名',async()=>{
    mocks.metaGraphGet.mockImplementation(async(path:string,_token:string,params:Record<string,string>)=>{
      if(path===grant.ad_account_id) return { id:grant.ad_account_id,currency:'NZD',timezone_name:'Pacific/Auckland' }
      if(params.level==='account') return { data:[{ spend:'100',impressions:'1000',clicks:'20' }] }
      return { data:[] }
    })
    const log=vi.spyOn(console,'error').mockImplementation(()=>undefined)
    mocks.callClaudeChat.mockRejectedValue({ status:403,error:{ type:'permission_error',message:'secret upstream detail' } })
    await expect(generateAnalysis('a1000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',grant.id))
      .rejects.toThrow('model_unavailable')
    expect(log).toHaveBeenCalledWith('[meta-ads-ai] hosted model call failed',{
      category:'permission',model:'claude-haiku-test',
    })
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret upstream detail')
  })

  it.each([
    ['network',new APIConnectionError({ message:'secret connection detail' })],
    ['timeout',new APIConnectionTimeoutError({ message:'secret timeout detail' })],
  ])('按真实 Anthropic SDK 实例识别 %s 错误',async(category,error)=>{
    mocks.metaGraphGet.mockImplementation(async(path:string,_token:string,params:Record<string,string>)=>{
      if(path===grant.ad_account_id) return { id:grant.ad_account_id,currency:'NZD',timezone_name:'Pacific/Auckland' }
      if(params.level==='account') return { data:[{ spend:'100',impressions:'1000',clicks:'20' }] }
      return { data:[] }
    })
    const log=vi.spyOn(console,'error').mockImplementation(()=>undefined)
    mocks.callClaudeChat.mockRejectedValue(error)
    await expect(generateAnalysis('a1000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',grant.id))
      .rejects.toThrow('model_unavailable')
    expect(log).toHaveBeenCalledWith('[meta-ads-ai] hosted model call failed',{
      category,model:'claude-haiku-test',
    })
    expect(JSON.stringify(log.mock.calls)).not.toContain(error.message)
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

describe('失败时的扣费',()=>{
  it('safeCharge 只在拿到正常正数用量时按真实成本扣，并截到预留以内',()=>{
    expect(safeCharge(0.02,0.12)).toBe(0.02)
    expect(safeCharge(0.5,0.12)).toBe(0.12)
    expect(safeCharge(Number.NaN,0.12)).toBe(0.12)
    expect(safeCharge(-1,0.12)).toBe(0.12)
    expect(safeCharge(0,0.12)).toBe(0.12)
    expect(safeCharge(null,0.12)).toBe(0.12)
    expect(safeCharge(undefined,0.12)).toBe(0.12)
  })

  it('成功但用量缺失（NaN）时按预留扣，不把 NaN 写进额度表（NaN 发到库里会变成空值，把已花额度加成空）',async()=>{
    mocks.metaGraphGet.mockImplementation(async(path:string,_token:string,params:Record<string,string>)=>{
      if(path===grant.ad_account_id) return { id:grant.ad_account_id,currency:'NZD',timezone_name:'Pacific/Auckland' }
      if(params.level==='account') return { data:[{ spend:'100',impressions:'1000',clicks:'20' }] }
      return { data:[] }
    })
    mocks.callClaudeChat.mockResolvedValue({ text:'中文报告',input_tokens:500,output_tokens:200,cost_usd:Number.NaN,stop_reason:'end_turn' })
    const result=await generateAnalysis('a1000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',grant.id)
    expect(result.status).toBe('completed')
    expect(mocks.rpc).toHaveBeenCalledWith('meta_ads_finish_sponsored_analysis',expect.objectContaining({ final_status:'completed',charged_usd:0.12 }))
  })

  it('截断且用量为 NaN 时按预留扣，不把 NaN 写进额度表',async()=>{
    mocks.metaGraphGet.mockImplementation(async(path:string,_token:string,params:Record<string,string>)=>{
      if(path===grant.ad_account_id) return { id:grant.ad_account_id,currency:'NZD',timezone_name:'Pacific/Auckland' }
      if(params.level==='account') return { data:[{ spend:'100',impressions:'1000',clicks:'20' }] }
      return { data:[] }
    })
    const log=vi.spyOn(console,'error').mockImplementation(()=>undefined)
    mocks.callClaudeChat.mockResolvedValue({ text:'前半份报告',input_tokens:500,output_tokens:4000,cost_usd:Number.NaN,stop_reason:'max_tokens' })
    await expect(generateAnalysis('a1000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',grant.id))
      .rejects.toThrow('analysis_incomplete')
    expect(log).toHaveBeenCalledWith('[meta-ads-ai] hosted model response incomplete',{
      category:'output_truncated',model:'claude-haiku-test',
    })
    expect(mocks.rpc).toHaveBeenCalledWith('meta_ads_finish_sponsored_analysis',expect.objectContaining({
      final_status:'failed',charged_usd:0.12,report_body:null,failure_code:'analysis_incomplete',
    }))
  })

  it('空文本失败时按真实成本扣，并按 4000 输出上限调用模型',async()=>{
    mocks.metaGraphGet.mockImplementation(async(path:string,_token:string,params:Record<string,string>)=>{
      if(path===grant.ad_account_id) return { id:grant.ad_account_id,currency:'NZD',timezone_name:'Pacific/Auckland' }
      if(params.level==='account') return { data:[{ spend:'100',impressions:'1000',clicks:'20' }] }
      return { data:[] }
    })
    const log=vi.spyOn(console,'error').mockImplementation(()=>undefined)
    mocks.callClaudeChat.mockResolvedValue({ text:'   ',input_tokens:500,output_tokens:10,cost_usd:0.013,stop_reason:'end_turn' })
    await expect(generateAnalysis('a1000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',grant.id))
      .rejects.toThrow('analysis_incomplete')
    expect(mocks.callClaudeChat).toHaveBeenCalledWith(expect.objectContaining({ maxOutputTokens:4000 }))
    expect(log).toHaveBeenCalledWith('[meta-ads-ai] hosted model response incomplete',{
      category:'empty_response',model:'claude-haiku-test',
    })
    expect(mocks.rpc).toHaveBeenCalledWith('meta_ads_finish_sponsored_analysis',expect.objectContaining({
      final_status:'failed',charged_usd:0.013,report_body:null,failure_code:'analysis_incomplete',
    }))
  })

  it('模型调用本身抛错时拿不到用量，按预留扣',async()=>{
    mocks.metaGraphGet.mockImplementation(async(path:string,_token:string,params:Record<string,string>)=>{
      if(path===grant.ad_account_id) return { id:grant.ad_account_id,currency:'NZD',timezone_name:'Pacific/Auckland' }
      if(params.level==='account') return { data:[{ spend:'100',impressions:'1000',clicks:'20' }] }
      return { data:[] }
    })
    const log=vi.spyOn(console,'error').mockImplementation(()=>undefined)
    mocks.callClaudeChat.mockRejectedValue(new Error('boom'))
    await expect(generateAnalysis('a1000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',grant.id))
      .rejects.toThrow('model_unavailable')
    expect(log).toHaveBeenCalledWith('[meta-ads-ai] hosted model call failed',{
      category:'upstream',model:'claude-haiku-test',
    })
    expect(mocks.rpc).toHaveBeenCalledWith('meta_ads_finish_sponsored_analysis',expect.objectContaining({
      final_status:'failed',charged_usd:0.12,report_body:null,failure_code:'model_unavailable',
    }))
  })
})

describe('报告口径与第三部分',()=>{
  it('stripFatigueSentences 删掉 AI 自己下的疲劳判断，其余文字原样保留',()=>{
    const cleaned=stripFatigueSentences('花费稳定。这条广告素材疲劳了。点击率上升。')
    expect(cleaned.text).toBe('花费稳定。点击率上升。')
    expect(cleaned.removed).toBe(1)

    const untouched=stripFatigueSentences('花费稳定。点击率上升。')
    expect(untouched.text).toBe('花费稳定。点击率上升。')
    expect(untouched.removed).toBe(0)
  })

  it('placeRuleSection 整段替换 AI 自己写的第三部分，并保留后面的部分',()=>{
    const replaced=placeRuleSection('一、总体\n内容\n三、素材\nAI 自己写的\n四、版位\n内容','SECTION')
    expect(replaced).toContain('SECTION')
    expect(replaced).not.toContain('AI 自己写的')
    expect(replaced.indexOf('SECTION')).toBeLessThan(replaced.indexOf('四、版位'))

    const inserted=placeRuleSection('一、总体\n内容\n四、版位\nx','SECTION')
    expect(inserted.indexOf('SECTION')).toBeLessThan(inserted.indexOf('四、版位'))

    const appended=placeRuleSection('只有一段','SECTION')
    expect(appended.endsWith('SECTION')).toBe(true)
  })

  it('placeRuleSection 认加粗标题',()=>{
    const out=placeRuleSection('一、总体\n内容\n**三、素材疲劳诊断**\n广告A点击率降了。\n**四、版位**\n内容四','S')
    expect(out).toContain('S')
    expect(out).not.toContain('广告A')
    expect(out).toContain('四、版位')
    expect(out).toContain('内容四')
  })

  it('placeRuleSection 认数字编号标题',()=>{
    const out=placeRuleSection('一、总体\n内容\n3. 素材\n广告A降了\n4. 版位\n内容四','S')
    expect(out).toContain('S')
    expect(out).not.toContain('广告A')
    expect(out).toContain('内容四')
  })

  it('placeRuleSection 没有下一个标题时不截断到文末',()=>{
    const out=placeRuleSection('一、总体\n内容\n三、素材\n广告A降了。\n\n后面还有很多内容','S')
    expect(out).toContain('后面还有很多内容')
    expect(out).not.toContain('广告A降了')
  })

  it('stripFatigueSentences 保留标题行，只删疲劳句',()=>{
    const cleaned=stripFatigueSentences('一、总体结果：花费 100，受众可能饱和。\n二、排行')
    expect(cleaned.text.startsWith('一、总体结果')).toBe(true)
    expect(cleaned.text).not.toContain('饱和')
    expect(stripFatigueSentences('新鲜感下降了。花费稳定。').text).toBe('花费稳定。')
  })

  it('normaliseHeadings 去掉 # 与 ** 前缀',()=>{
    expect(normaliseHeadings('## 三、素材\n**四、版位**')).toBe('三、素材\n四、版位')
  })

  it('按广告组去向算结果口径，并把系统第三部分放进报告',async()=>{
    mocks.metaGraphGet.mockImplementation(async(path:string,_token:string,params:Record<string,string>)=>{
      if(path===grant.ad_account_id) return { id:grant.ad_account_id,currency:'NZD',timezone_name:'Pacific/Auckland' }
      if(path===`${grant.ad_account_id}/adsets`) return { data:[
        { id:'as-msg',destination_type:'MESSENGER',optimization_goal:'CONVERSATIONS' },
        { id:'as-lead',destination_type:'ON_AD',optimization_goal:'LEAD_GENERATION' },
        { id:'as-video',destination_type:'ON_VIDEO',optimization_goal:'THRUPLAY' },
      ] }
      if(params.level==='adset') return { data:[
        { campaign_id:'c1',adset_id:'as-msg',spend:'60',actions:[
          { action_type:'onsite_conversion.messaging_conversation_started_7d',value:'6' },
          { action_type:'lead',value:'5' },
        ] },
        { campaign_id:'c2',adset_id:'as-lead',spend:'40',actions:[
          { action_type:'lead',value:'4' },
          { action_type:'onsite_conversion.messaging_conversation_started_7d',value:'3' },
        ] },
        { campaign_id:'c3',adset_id:'as-video',spend:'10',actions:[] },
      ] }
      if(params.level==='account') return { data:[{ spend:'110',impressions:'5000',clicks:'100' }] }
      if(params.level==='campaign') return { data:[
        { campaign_id:'c1',campaign_name:'私信',spend:'60',impressions:'3000',clicks:'60' },
        { campaign_id:'c2',campaign_name:'表单',spend:'40',impressions:'1500',clicks:'30' },
      ] }
      return { data:[] }
    })
    mocks.callClaudeChat.mockResolvedValue({ text:'一、总体结果\n花费 110。\n四、版位\n数据不足。',
      input_tokens:500,output_tokens:200,cost_usd:0.004,stop_reason:'end_turn' })

    const result=await generateAnalysis('a1000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',grant.id)
    expect(result.status).toBe('completed')

    const raw=String(mocks.callClaudeChat.mock.calls[0]?.[0].messages[0].content)
    const modelInput=JSON.parse(raw.replace('以下是只读汇总证据：\n','')) as {
      totals:Record<string,unknown>
      campaigns:Record<string,unknown>[]
      comparison:Record<string,unknown>
    }
    expect(modelInput.totals.core_metric).toBe('mixed')
    expect(modelInput.totals.leads).toBe(4)
    expect(modelInput.totals.leads).not.toBe(9)
    expect(modelInput.totals.conversations).toBe(6)
    expect(modelInput.totals.other_goal_spend).toBe(10)

    const c1=modelInput.campaigns.find(row=>row.campaign_id==='c1')
    expect(c1?.core_metric).toBe('messaging_started')
    expect(c1?.results).toBe(6)
    expect(c1?.cost_per_result).toBe(10)

    const c2=modelInput.campaigns.find(row=>row.campaign_id==='c2')
    expect(c2?.core_metric).toBe('lead')
    expect(c2?.results).toBe(4)
    expect(c2?.cost_per_result).toBe(10)

    expect(modelInput).not.toHaveProperty('fatigue_candidates')
    expect(modelInput).not.toHaveProperty('rule_section')
    expect(modelInput.comparison.leads).toBeUndefined()

    const finishCall=mocks.rpc.mock.calls.find(call=>call[0]==='meta_ads_finish_sponsored_analysis')
    const reportBody=String((finishCall?.[1] as Record<string,unknown>).report_body)
    expect(reportBody).toContain('三、需要留意的广告')
    expect(reportBody).toContain('这个广告账户这次没有做单条广告检查')
    expect(reportBody.indexOf('三、需要留意的广告')).toBeLessThan(reportBody.indexOf('四、版位'))
  })

  it('广告组数据读不到时降级：结果口径留备注，报告照常生成',async()=>{
    mocks.metaGraphGet.mockImplementation(async(path:string,_token:string,params:Record<string,string>)=>{
      if(path===grant.ad_account_id) return { id:grant.ad_account_id,currency:'NZD',timezone_name:'Pacific/Auckland' }
      if(path===`${grant.ad_account_id}/adsets`) return { data:[] }
      if(params.level==='adset') throw new Error('boom')
      if(params.level==='account') return { data:[{ spend:'110',impressions:'5000',clicks:'100' }] }
      if(params.level==='campaign') return { data:[
        { campaign_id:'c1',campaign_name:'私信',spend:'60',impressions:'3000',clicks:'60' },
      ] }
      return { data:[] }
    })
    mocks.callClaudeChat.mockResolvedValue({ text:'一、总体结果\n花费 110。\n四、版位\n数据不足。',
      input_tokens:500,output_tokens:200,cost_usd:0.004,stop_reason:'end_turn' })

    const result=await generateAnalysis('a1000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',grant.id)
    expect(result.status).toBe('completed')

    const raw=String(mocks.callClaudeChat.mock.calls[0]?.[0].messages[0].content)
    const modelInput=JSON.parse(raw.replace('以下是只读汇总证据：\n','')) as {
      totals:Record<string,unknown>
      coverage:Record<string,unknown>
    }
    expect(typeof modelInput.coverage.core_results_note).toBe('string')
    expect(String(modelInput.coverage.core_results_note).length).toBeGreaterThan(0)
    expect(modelInput.totals.core_metric).toBe('unavailable')
  })

  it('AI 自己写的疲劳句被删掉，报告其余内容保留',async()=>{
    mocks.metaGraphGet.mockImplementation(async(path:string,_token:string,params:Record<string,string>)=>{
      if(path===grant.ad_account_id) return { id:grant.ad_account_id,currency:'NZD',timezone_name:'Pacific/Auckland' }
      if(path===`${grant.ad_account_id}/adsets`) return { data:[] }
      if(params.level==='adset') return { data:[] }
      if(params.level==='account') return { data:[{ spend:'110',impressions:'5000',clicks:'100' }] }
      if(params.level==='campaign') return { data:[
        { campaign_id:'c1',campaign_name:'私信',spend:'60',impressions:'3000',clicks:'60' },
      ] }
      return { data:[] }
    })
    mocks.callClaudeChat.mockResolvedValue({ text:'一、总体结果\n这条广告受众饱和了。花费 110。\n四、版位\n数据不足。',
      input_tokens:500,output_tokens:200,cost_usd:0.004,stop_reason:'end_turn' })

    const result=await generateAnalysis('a1000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',grant.id)
    expect(result.status).toBe('completed')

    const finishCall=mocks.rpc.mock.calls.find(call=>call[0]==='meta_ads_finish_sponsored_analysis')
    const reportBody=String((finishCall?.[1] as Record<string,unknown>).report_body)
    expect(reportBody).not.toContain('饱和')
    expect(reportBody).toContain('花费 110。')
  })

  it('广告组去向读不到时降级，报告照样生成',async()=>{
    mocks.metaGraphGet.mockImplementation(async(path:string,_token:string,params:Record<string,string>)=>{
      if(path===grant.ad_account_id) return { id:grant.ad_account_id,currency:'NZD',timezone_name:'Pacific/Auckland' }
      if(path===`${grant.ad_account_id}/adsets`) throw new Error('boom')
      if(params.level==='adset') return { data:[
        { campaign_id:'c1',adset_id:'as-msg',spend:'60',actions:[
          { action_type:'onsite_conversion.messaging_conversation_started_7d',value:'6' },
          { action_type:'lead',value:'5' },
        ] },
        { campaign_id:'c2',adset_id:'as-lead',spend:'40',actions:[
          { action_type:'lead',value:'4' },
          { action_type:'onsite_conversion.messaging_conversation_started_7d',value:'3' },
        ] },
        { campaign_id:'c3',adset_id:'as-video',spend:'10',actions:[] },
      ] }
      if(params.level==='account') return { data:[{ spend:'110',impressions:'5000',clicks:'100' }] }
      if(params.level==='campaign') return { data:[
        { campaign_id:'c1',campaign_name:'私信',spend:'60',impressions:'3000',clicks:'60' },
        { campaign_id:'c2',campaign_name:'表单',spend:'40',impressions:'1500',clicks:'30' },
      ] }
      return { data:[] }
    })
    mocks.callClaudeChat.mockResolvedValue({ text:'一、总体结果\n花费 110。\n四、版位\n数据不足。',
      input_tokens:500,output_tokens:200,cost_usd:0.004,stop_reason:'end_turn' })

    const result=await generateAnalysis('a1000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',grant.id)
    expect(result.status).toBe('completed')

    const raw=String(mocks.callClaudeChat.mock.calls[0]?.[0].messages[0].content)
    const modelInput=JSON.parse(raw.replace('以下是只读汇总证据：\n','')) as {
      totals:Record<string,unknown>
      coverage:Record<string,unknown>
    }
    expect(typeof modelInput.coverage.core_results_note).toBe('string')
    expect(String(modelInput.coverage.core_results_note).length).toBeGreaterThan(0)
    expect(modelInput.totals.core_metric).toBe('unavailable')
  })

  it('有巡检结论时，第三部分由程序按模板写进报告',async()=>{
    const d=(n:number)=>new Date(Date.now()-n*86_400_000).toISOString().slice(0,10)
    const row=(date:string)=>({
      client_id:'a1000000-0000-4000-8000-000000000001',date,
      payload:{
        dataCompleteness:'complete',
        adLevelCoverage:[{ adAccountId:grant.ad_account_id,ran:true,reason:'ok',adsChecked:3 }],
        problems:[{
          code:'D10',status:'hit',title:'内部标题',clientVisible:true,
          units:[{ level:'ad',id:'ad1',name:'广告A',adAccountId:grant.ad_account_id }],
          reasons:['止损：内部'],
          evidence:{ core_metric:'lead',baseline_source:'own_history',base_rate:0.16,recent_rate:0.04,
            base_cost_per_result:7,recent_cost_per_result:30,recent_spend:90 },
        }],
      },
    })
    const rows=[row(d(1)),row(d(2))]
    const growthChain:Record<string,unknown>={}
    growthChain.select=vi.fn(()=>growthChain)
    growthChain.eq=vi.fn(()=>growthChain)
    growthChain.gte=vi.fn(()=>growthChain)
    growthChain.order=vi.fn(async()=>({ data:rows,error:null }))
    mocks.from.mockImplementation((table:string)=>table==='ads_growth_states' ? growthChain : query(table))

    mocks.metaGraphGet.mockImplementation(async(path:string,_token:string,params:Record<string,string>)=>{
      if(path===grant.ad_account_id) return { id:grant.ad_account_id,currency:'NZD',timezone_name:'Pacific/Auckland' }
      if(path===`${grant.ad_account_id}/adsets`) return { data:[
        { id:'as-msg',destination_type:'MESSENGER',optimization_goal:'CONVERSATIONS' },
        { id:'as-lead',destination_type:'ON_AD',optimization_goal:'LEAD_GENERATION' },
        { id:'as-video',destination_type:'ON_VIDEO',optimization_goal:'THRUPLAY' },
      ] }
      if(params.level==='adset') return { data:[
        { campaign_id:'c1',adset_id:'as-msg',spend:'60',actions:[
          { action_type:'onsite_conversion.messaging_conversation_started_7d',value:'6' },
          { action_type:'lead',value:'5' },
        ] },
        { campaign_id:'c2',adset_id:'as-lead',spend:'40',actions:[
          { action_type:'lead',value:'4' },
          { action_type:'onsite_conversion.messaging_conversation_started_7d',value:'3' },
        ] },
        { campaign_id:'c3',adset_id:'as-video',spend:'10',actions:[] },
      ] }
      if(params.level==='account') return { data:[{ spend:'110',impressions:'5000',clicks:'100' }] }
      if(params.level==='campaign') return { data:[
        { campaign_id:'c1',campaign_name:'私信',spend:'60',impressions:'3000',clicks:'60' },
        { campaign_id:'c2',campaign_name:'表单',spend:'40',impressions:'1500',clicks:'30' },
      ] }
      if(params.level==='ad') return { data:[
        { ad_id:'ad1',ad_name:'广告A',spend:'50',impressions:'1000',clicks:'20' },
      ] }
      return { data:[] }
    })
    mocks.callClaudeChat.mockResolvedValue({ text:'一、总体结果\n花费 110。\n四、版位\n数据不足。',
      input_tokens:500,output_tokens:200,cost_usd:0.004,stop_reason:'end_turn' })

    const result=await generateAnalysis('a1000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',grant.id)
    expect(result.status).toBe('completed')

    const finishCall=mocks.rpc.mock.calls.find(call=>call[0]==='meta_ads_finish_sponsored_analysis')
    const reportBody=String((finishCall?.[1] as Record<string,unknown>).report_body)
    expect(reportBody).toContain('「广告A」最近 3 天，点进来的人里留下联系方式的比例从之前两周的 16.0% 降到了 4.0%')
    expect(reportBody).toContain('你不用动手')
    expect(reportBody).not.toContain('内部标题')
    expect(reportBody).not.toContain('止损：内部')

    const raw=String(mocks.callClaudeChat.mock.calls[0]?.[0].messages[0].content)
    const modelInput=JSON.parse(raw.replace('以下是只读汇总证据：\n','')) as Record<string,unknown>
    expect(JSON.stringify(modelInput)).not.toContain('降到了')
  })

  it('AI 自己写的第三部分被整段替换，且不残留广告名',async()=>{
    mocks.metaGraphGet.mockImplementation(async(path:string,_token:string,params:Record<string,string>)=>{
      if(path===grant.ad_account_id) return { id:grant.ad_account_id,currency:'NZD',timezone_name:'Pacific/Auckland' }
      if(path===`${grant.ad_account_id}/adsets`) return { data:[
        { id:'as-msg',destination_type:'MESSENGER',optimization_goal:'CONVERSATIONS' },
        { id:'as-lead',destination_type:'ON_AD',optimization_goal:'LEAD_GENERATION' },
        { id:'as-video',destination_type:'ON_VIDEO',optimization_goal:'THRUPLAY' },
      ] }
      if(params.level==='adset') return { data:[
        { campaign_id:'c1',adset_id:'as-msg',spend:'60',actions:[
          { action_type:'onsite_conversion.messaging_conversation_started_7d',value:'6' },
          { action_type:'lead',value:'5' },
        ] },
        { campaign_id:'c2',adset_id:'as-lead',spend:'40',actions:[
          { action_type:'lead',value:'4' },
          { action_type:'onsite_conversion.messaging_conversation_started_7d',value:'3' },
        ] },
        { campaign_id:'c3',adset_id:'as-video',spend:'10',actions:[] },
      ] }
      if(params.level==='account') return { data:[{ spend:'110',impressions:'5000',clicks:'100' }] }
      if(params.level==='campaign') return { data:[
        { campaign_id:'c1',campaign_name:'私信',spend:'60',impressions:'3000',clicks:'60' },
        { campaign_id:'c2',campaign_name:'表单',spend:'40',impressions:'1500',clicks:'30' },
      ] }
      return { data:[] }
    })
    mocks.callClaudeChat.mockResolvedValue({ text:'一、总体结果\n花费 110。\n三、素材疲劳诊断\n广告A点击率降了40%，建议换素材。\n四、版位\n数据不足。',
      input_tokens:500,output_tokens:200,cost_usd:0.004,stop_reason:'end_turn' })

    const result=await generateAnalysis('a1000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',grant.id)
    expect(result.status).toBe('completed')

    const finishCall=mocks.rpc.mock.calls.find(call=>call[0]==='meta_ads_finish_sponsored_analysis')
    const reportBody=String((finishCall?.[1] as Record<string,unknown>).report_body)
    expect(reportBody).toContain('三、需要留意的广告')
    expect(reportBody).not.toContain('广告A')
    expect(reportBody).toContain('四、版位')
  })

  it('有 D2 巡检结论时，系统文案不会被疲劳词清洗删掉',async()=>{
    const d=(n:number)=>new Date(Date.now()-n*86_400_000).toISOString().slice(0,10)
    const row=(date:string)=>({
      client_id:'a1000000-0000-4000-8000-000000000001',date,
      payload:{
        dataCompleteness:'complete',
        adLevelCoverage:[{ adAccountId:grant.ad_account_id,ran:true,reason:'ok',adsChecked:3 }],
        problems:[{
          code:'D2',status:'hit',title:'内部标题',clientVisible:true,
          units:[{ level:'ad',id:'ad1',name:'广告A',adAccountId:grant.ad_account_id }],
          reasons:['止损：内部'],
          evidence:{ baseline_source:'own_history',base_rate:0.04,recent_rate:0.02,
            frequency_7d:1.7,fatigue_kind:'creative',recent_spend:90,campaign_id:'c1' },
        }],
      },
    })
    const rows=[row(d(1)),row(d(2))]
    const growthChain:Record<string,unknown>={}
    growthChain.select=vi.fn(()=>growthChain)
    growthChain.eq=vi.fn(()=>growthChain)
    growthChain.gte=vi.fn(()=>growthChain)
    growthChain.order=vi.fn(async()=>({ data:rows,error:null }))
    mocks.from.mockImplementation((table:string)=>table==='ads_growth_states' ? growthChain : query(table))

    mocks.metaGraphGet.mockImplementation(async(path:string,_token:string,params:Record<string,string>)=>{
      if(path===grant.ad_account_id) return { id:grant.ad_account_id,currency:'NZD',timezone_name:'Pacific/Auckland' }
      if(path===`${grant.ad_account_id}/adsets`) return { data:[
        { id:'as-msg',destination_type:'MESSENGER',optimization_goal:'CONVERSATIONS' },
        { id:'as-lead',destination_type:'ON_AD',optimization_goal:'LEAD_GENERATION' },
        { id:'as-video',destination_type:'ON_VIDEO',optimization_goal:'THRUPLAY' },
      ] }
      if(params.level==='adset') return { data:[
        { campaign_id:'c1',adset_id:'as-msg',spend:'60',actions:[
          { action_type:'onsite_conversion.messaging_conversation_started_7d',value:'6' },
          { action_type:'lead',value:'5' },
        ] },
        { campaign_id:'c2',adset_id:'as-lead',spend:'40',actions:[
          { action_type:'lead',value:'4' },
          { action_type:'onsite_conversion.messaging_conversation_started_7d',value:'3' },
        ] },
        { campaign_id:'c3',adset_id:'as-video',spend:'10',actions:[] },
      ] }
      if(params.level==='account') return { data:[{ spend:'110',impressions:'5000',clicks:'100' }] }
      if(params.level==='campaign') return { data:[
        { campaign_id:'c1',campaign_name:'私信',spend:'60',impressions:'3000',clicks:'60' },
        { campaign_id:'c2',campaign_name:'表单',spend:'40',impressions:'1500',clicks:'30' },
      ] }
      if(params.level==='ad') return { data:[
        { ad_id:'ad1',ad_name:'广告A',spend:'50',impressions:'1000',clicks:'20' },
      ] }
      return { data:[] }
    })
    mocks.callClaudeChat.mockResolvedValue({ text:'一、总体结果\n花费 110。\n四、版位\n数据不足。',
      input_tokens:500,output_tokens:200,cost_usd:0.004,stop_reason:'end_turn' })

    const result=await generateAnalysis('a1000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',grant.id)
    expect(result.status).toBe('completed')

    const finishCall=mocks.rpc.mock.calls.find(call=>call[0]==='meta_ads_finish_sponsored_analysis')
    const reportBody=String((finishCall?.[1] as Record<string,unknown>).report_body)
    expect(reportBody).toContain('应该不是大家看腻了')
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

describe('历史报告隔离',()=>{
  it('listAnalyses 同时按 client_id 与 principal_id 过滤，新 owner 查不到原 owner 的报告',async()=>{
    const chain:Record<string,unknown>={}
    for(const method of ['select','eq','order','limit']) chain[method]=vi.fn(()=>chain)
    chain.then=(resolve:(value:unknown)=>unknown)=>Promise.resolve({ data:[],error:null }).then(resolve)
    mocks.from.mockReturnValue(chain)
    await listAnalyses('client','new-principal')
    expect(mocks.from).toHaveBeenCalledWith('meta_ads_ai_analysis_jobs')
    expect(chain.eq).toHaveBeenCalledWith('client_id','client')
    expect(chain.eq).toHaveBeenCalledWith('principal_id','new-principal')
    expect(chain.order).toHaveBeenCalledWith('created_at',{ ascending:false })
    expect(chain.limit).toHaveBeenCalledWith(10)
  })

  it('listAnalyses 返回原 owner 自己的报告',async()=>{
    const chain:Record<string,unknown>={}
    for(const method of ['select','eq','order','limit']) chain[method]=vi.fn(()=>chain)
    chain.then=(resolve:(value:unknown)=>unknown)=>Promise.resolve({ data:[{ id:'job-1',status:'completed',ad_account_id:'act_1',
      window_since:'2026-09-15',window_until:'2026-09-21',report_markdown:'报告',error_code:null,created_at:'t',completed_at:'t',
      evidence:null }],error:null }).then(resolve)
    mocks.from.mockReturnValue(chain)
    const result=await listAnalyses('client','principal')
    expect(result).toEqual([expect.objectContaining({ id:'job-1',report_markdown:'报告' })])
  })
})
