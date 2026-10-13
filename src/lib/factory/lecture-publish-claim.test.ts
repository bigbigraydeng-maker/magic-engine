import {beforeEach,describe,expect,it,vi} from 'vitest'
const state=vi.hoisted(()=>({filters:[] as [string,unknown][],rows:[] as {id:string}[],error:null as unknown,update:vi.fn()}))
vi.mock('@/lib/supabase',()=>({supabaseAdmin:{from:()=>({update:(value:unknown)=>{state.update(value);const chain={eq:(key:string,value:unknown)=>{state.filters.push([key,value]);return chain},select:async()=>({data:state.rows,error:state.error})};return chain}})}}))
import {claimLecturePublish} from './lecture-post'
beforeEach(()=>{state.filters=[];state.rows=[];state.error=null;state.update.mockClear()})
describe('atomic lecture publication claim',()=>{
  const snapshot={lecture_publish_request:{platform:'tiktok' as const,status:'pending' as const,requestedAt:'now'},unrelated:'preserved'}
  const request={...snapshot.lecture_publish_request,status:'sending' as const,startedAt:'now'}
  it('compares the whole previous JSON snapshot and preserves other fields',async()=>{
    state.rows=[{id:'p'}]
    expect(await claimLecturePublish('c','p',snapshot,request)).toBe(true)
    expect(state.filters).toEqual([['client_id','c'],['id','p'],['generation_context_snapshot',JSON.stringify(snapshot)]])
    expect(state.update).toHaveBeenCalledWith({generation_context_snapshot:{...snapshot,lecture_publish_request:request}})
  })
  it('returns false when another writer has already changed the snapshot',async()=>{
    expect(await claimLecturePublish('c','p',snapshot,request)).toBe(false)
  })
  it('does not treat database errors as successful claims',async()=>{
    state.error=new Error('database unavailable')
    await expect(claimLecturePublish('c','p',snapshot,request)).rejects.toThrow('database unavailable')
  })
})
