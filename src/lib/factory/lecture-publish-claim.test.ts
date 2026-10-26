import {beforeEach,describe,expect,it,vi} from 'vitest'
const state=vi.hoisted(()=>({filters:[] as [string,unknown][],rows:[] as {id:string}[],error:null as unknown,update:vi.fn()}))
vi.mock('@/lib/supabase',()=>({supabaseAdmin:{from:()=>({update:(value:unknown)=>{state.update(value);const chain={eq:(key:string,value:unknown)=>{state.filters.push([key,value]);return chain},select:async()=>({data:state.rows,error:state.error})};return chain}})}}))
import {claimLecturePublish} from './lecture-post'
beforeEach(()=>{state.filters=[];state.rows=[];state.error=null;state.update.mockClear()})
describe('atomic lecture publication claim',()=>{
  const snapshot={lecture_publish_request:{platform:'tiktok' as const,status:'pending' as const,requestedAt:'now'},unrelated:'preserved'}
  const request={...snapshot.lecture_publish_request,status:'sending' as const,startedAt:'now'}
  it('compares the short database revision and preserves other fields',async()=>{
    state.rows=[{id:'p'}]
    expect(await claimLecturePublish('c','p',snapshot,request,'revision')).toBe(true)
    expect(state.filters).toEqual([['client_id','c'],['id','p'],['updated_at','revision']])
    expect(state.update).toHaveBeenCalledWith({generation_context_snapshot:{...snapshot,lecture_publish_request:request}})
  })
  it('rejects absent revision before issuing a database update',async()=>{
    await expect(claimLecturePublish('c','p',snapshot,request,'')).rejects.toThrow('缺少发布版本')
    expect(state.update).not.toHaveBeenCalled()
  })
  it('does not overwrite an initialized task with a stale pending enqueue',async()=>{
    expect(await claimLecturePublish('c','p',snapshot,snapshot.lecture_publish_request,'stale-revision')).toBe(false)
    expect(state.filters).toContainEqual(['updated_at','stale-revision'])
  })
  it('returns false when another writer has already changed the snapshot',async()=>{
    expect(await claimLecturePublish('c','p',snapshot,request,'revision')).toBe(false)
  })
  it('does not treat database errors as successful claims',async()=>{
    state.error=new Error('database unavailable')
    await expect(claimLecturePublish('c','p',snapshot,request,'revision')).rejects.toThrow('database unavailable')
  })
})
