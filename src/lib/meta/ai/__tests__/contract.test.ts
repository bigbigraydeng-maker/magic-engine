import { describe,it,expect } from 'vitest'
import { schemas,metaManifest,toolNames } from '../contract'
import { normaliseInsight,resolveWindow,previousWindow,compareMetrics } from '../metrics'
describe('Meta read-only contract',()=>{
  it('exposes exactly eight tools and rejects model-controlled tenant/token/fields',()=>{
    expect(metaManifest().map(t=>t.name)).toEqual([...toolNames])
    for(const name of toolNames) {
      const minimal=name==='meta_list_accounts' ? {} : { account_id:'act_1234567890' }
      expect(schemas[name].safeParse(minimal).success).toBe(true)
      for(const key of ['client_id','access_token','url','fields','write','entity_id']) expect(schemas[name].safeParse({ ...minimal,[key]:'attacker' }).success).toBe(false)
    }
  })
  it('validates account, pagination and breakdown allowlist',()=>{
    expect(schemas.meta_get_insights.safeParse({ account_id:'act_0123456789' }).success).toBe(false)
    expect(schemas.meta_get_insights.safeParse({ account_id:'act_1234567890',limit:501 }).success).toBe(false)
    expect(schemas.meta_get_breakdowns.safeParse({ account_id:'act_1234567890',breakdown:'country,age,gender' }).success).toBe(false)
  })
  it('uses seven completed account-local days across daylight saving',()=>{
    expect(resolveWindow(undefined,'Pacific/Auckland',new Date('2026-09-28T01:00:00Z'))).toEqual({ since:'2026-09-21',until:'2026-09-27' })
    expect(previousWindow({ since:'2026-03-01',until:'2026-03-07' })).toEqual({ since:'2026-02-22',until:'2026-02-28' })
  })
  it.each([{ since:'2026-02-30',until:'2026-03-01' },{ since:'2026-01-01',until:'2026-08-01' },{ since:'2026-09-19',until:'2026-09-20' },{ since:'2026-09-18',until:'2026-09-17' }])('rejects invalid, oversized or incomplete dates %j',range=>{
    expect(()=>resolveWindow(range,'UTC',new Date('2026-09-20T10:00:00Z'))).toThrow('invalid_date_range')
  })
  it('preserves missing vs zero and fractional attributed actions',()=>{
    const result=normaliseInsight({ spend:'20',impressions:'1000',clicks:'10',reach:'800',frequency:'1.25',actions:[{ action_type:'lead',value:'2.5' }] },'lead')
    expect(result).toMatchObject({ cpl:8,conversions:2.5,ctr:.01,cpc:2,cpm:20,reach:800,frequency:1.25 })
    expect(normaliseInsight({},'lead')).toMatchObject({ spend:null,leads:null,ctr:null })
    expect(normaliseInsight({ spend:'0',impressions:'0',actions:[{ action_type:'lead',value:'0' }] },'lead')).toMatchObject({ spend:0,leads:0,ctr:null,cpl:null })
  })
  it('uses video starts as quartile denominator and does not fabricate retention',()=>{
    expect(normaliseInsight({ video_play_actions:[{ action_type:'video_view',value:'100' }],video_p25_watched_actions:[{ action_type:'video_view',value:'60' }] },'lead',true)).toMatchObject({ video_p25_watched_actions:60,video_p25_watched_actions_retention:.6 })
    expect(normaliseInsight({ video_p25_watched_actions:[{ action_type:'video_view',value:'60' }] },'lead',true)).toMatchObject({ video_p25_watched_actions_retention:null })
  })
  it('distinguishes unrequested video from provider omissions and numeric zero',()=>{
    expect(normaliseInsight({},'lead').availability.video).toBe('not_requested')
    expect(normaliseInsight({},'lead',true).availability.video).toBe('not_reported_may_be_inapplicable_or_suppressed')
    expect(normaliseInsight({ spend:'0' },'lead').availability.metrics.spend).toBe('available')
    expect(normaliseInsight({},'lead').availability.metrics.spend).toBe('not_reported_or_undefined')
  })
  it('comparison leaves previous zero percent undefined',()=>{
    expect(compareMetrics({ spend:10,ctr:.02 },{ spend:0,ctr:.01 })).toMatchObject({ spend:{ delta:10,percent_change:null },ctr:{ delta:.01,percent_change:100 } })
  })
})
