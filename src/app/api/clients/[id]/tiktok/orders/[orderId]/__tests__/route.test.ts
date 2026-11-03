// @vitest-environment node
import {beforeEach,describe,it,expect,vi} from 'vitest'
const m=vi.hoisted(()=>({access:vi.fn(),single:vi.fn(),publish:vi.fn(),creator:vi.fn(),proof:vi.fn(),eq:vi.fn(),updated:vi.fn(),update:vi.fn()}))
vi.mock('@/lib/auth/client-access',()=>({requireDashboardClientAccess:m.access}))
vi.mock('@/lib/supabase',()=>{const q={select:()=>q,eq:(...args:unknown[])=>{m.eq(...args);return q},is:()=>q,update:(value:unknown)=>{m.update(value);return q},single:m.single,then:(resolve:(x:unknown)=>unknown)=>Promise.resolve(m.updated()).then(resolve)};return {supabaseAdmin:{from:()=>q}}})
vi.mock('@/lib/tiktok/video-proof',()=>({inspectTikTokVideo:m.proof}))
vi.mock('@/lib/factory/publish/tiktok-adapter',()=>({publishToTikTok:m.publish,getTikTokCreatorInfo:m.creator,checkTikTokStatus:vi.fn(),humanTikTokError:()=> 'Unavailable'}))
import {POST} from '../route'
const context={params:{id:'cts',orderId:'order'}}
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://example.com');m.access.mockResolvedValue({ok:true})})
describe('ordinary completed video TikTok publishing gate',()=>{
 it('does not send if the approval changed before atomic claim',async()=>{
  m.single.mockResolvedValue({data:{id:'order',client_id:'cts',status:'approved',updated_at:'2026-10-13T00:00:00.000Z',output:{video_path:'renders/video.mp4'}}})
  m.creator.mockResolvedValue({accountId:'account',creator_nickname:'CTS',privacy_level_options:['SELF_ONLY'],comment_disabled:false,duet_disabled:false,stitch_disabled:false,max_video_post_duration_sec:30})
  m.proof.mockResolvedValue({sha256:'a'.repeat(64),durationSeconds:12})
  m.updated.mockReturnValue({data:[],error:null})
  const review={accountId:'account',videoUrl:'https://example.com/storage/v1/object/public/content-factory/renders/video.mp4',videoSha256:'a'.repeat(64),privacy:'SELF_ONLY',caption:'Test',allowComment:false,allowDuet:false,allowStitch:false,ownBrand:false,brandedContent:false,musicConsent:true,confirmed:true,durationSeconds:12}
  const result=await POST(new Request('https://test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({review})}),context)
  expect(result.status).toBe(400)
  expect(m.eq).toHaveBeenCalledWith('status','approved')
  expect(m.publish).not.toHaveBeenCalled()
 })

 it('uses a short version CAS while preserving large unrelated output',async()=>{
  const output={video_path:'renders/video.mp4',metadata:'中文素材'.repeat(20000)}
  m.single.mockResolvedValue({data:{id:'order',client_id:'cts',status:'approved',updated_at:'2026-10-13T00:00:00.000Z',output}})
  m.creator.mockResolvedValue({accountId:'account',creator_nickname:'CTS',privacy_level_options:['SELF_ONLY'],comment_disabled:false,duet_disabled:false,stitch_disabled:false,max_video_post_duration_sec:30})
  m.proof.mockResolvedValue({sha256:'a'.repeat(64),durationSeconds:12})
  m.updated.mockImplementation(()=>({data:[{id:'order',updated_at:m.update.mock.lastCall?.[0].updated_at}],error:null}))
  m.publish.mockImplementation(async params=>{await params.onInitialized('provider-id','account');return{publishId:'provider-id',privacy:'SELF_ONLY'}})
  const review={accountId:'account',videoUrl:'https://example.com/storage/v1/object/public/content-factory/renders/video.mp4',videoSha256:'a'.repeat(64),privacy:'SELF_ONLY',caption:'Test',allowComment:false,allowDuet:false,allowStitch:false,ownBrand:false,brandedContent:false,musicConsent:true,confirmed:true,durationSeconds:12}
  const result=await POST(new Request('https://test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({review})}),context)
  expect(result.status).toBe(202)
  expect(m.eq).toHaveBeenCalledWith('updated_at','2026-10-13T00:00:00.000Z')
  expect(m.eq.mock.calls.every(([key,value])=>key!=='output' && String(value).length<200)).toBe(true)
  expect(m.update.mock.calls.every(([value])=>value.output.metadata===output.metadata)).toBe(true)
  const versions=m.update.mock.calls.map(([value])=>value.updated_at)
  expect(new Set(versions).size).toBe(versions.length)
 })
 it('refuses upload if another output writer wins the version CAS',async()=>{
  m.single.mockResolvedValue({data:{id:'order',client_id:'cts',status:'approved',updated_at:'2026-10-13T00:00:00.000Z',output:{video_path:'renders/video.mp4'}}})
  m.creator.mockResolvedValue({accountId:'account',creator_nickname:'CTS',privacy_level_options:['SELF_ONLY'],comment_disabled:false,duet_disabled:false,stitch_disabled:false,max_video_post_duration_sec:30})
  m.proof.mockResolvedValue({sha256:'a'.repeat(64),durationSeconds:12})
  m.updated.mockReturnValue({data:[],error:null})
  const review={accountId:'account',videoUrl:'https://example.com/storage/v1/object/public/content-factory/renders/video.mp4',videoSha256:'a'.repeat(64),privacy:'SELF_ONLY',caption:'Test',allowComment:false,allowDuet:false,allowStitch:false,ownBrand:false,brandedContent:false,musicConsent:true,confirmed:true,durationSeconds:12}
  expect((await POST(new Request('https://test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({review})}),context)).status).toBe(400)
  expect(m.publish).not.toHaveBeenCalled()
  expect(m.eq).toHaveBeenCalledWith('updated_at','2026-10-13T00:00:00.000Z')
 })

 it('claims before provider init and blocks retry when every receipt write fails',async()=>{
  const order={id:'order',client_id:'cts',status:'approved',updated_at:'2026-10-13T00:00:00.000Z',output:{video_path:'renders/video.mp4'} as Record<string,unknown>}
  m.single.mockImplementation(async()=>({data:{...order,output:{...order.output}}}))
  m.creator.mockResolvedValue({accountId:'account',creator_nickname:'CTS',privacy_level_options:['SELF_ONLY'],comment_disabled:false,duet_disabled:false,stitch_disabled:false,max_video_post_duration_sec:30})
  m.proof.mockResolvedValue({sha256:'a'.repeat(64),durationSeconds:12})
  let writes=0
  m.updated.mockImplementation(()=>{writes++;if(writes>1)return{data:[],error:new Error('storage unavailable')};const value=m.update.mock.lastCall![0];order.output=value.output;order.updated_at=value.updated_at;return{data:[{id:'order',updated_at:order.updated_at}],error:null}})
  m.publish.mockImplementation(async params=>{expect(order.output.tiktok_publish).toMatchObject({status:'sending'});await params.onInitialized('provider-id','account');throw new Error('unreachable')})
  const review={accountId:'account',videoUrl:'https://example.com/storage/v1/object/public/content-factory/renders/video.mp4',videoSha256:'a'.repeat(64),privacy:'SELF_ONLY',caption:'Test',allowComment:false,allowDuet:false,allowStitch:false,ownBrand:false,brandedContent:false,musicConsent:true,confirmed:true,durationSeconds:12}
  const request=()=>new Request('https://test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({review})})
  expect((await POST(request(),context)).status).toBe(400)
  expect((await POST(request(),context)).status).toBe(409)
  expect(m.publish).toHaveBeenCalledTimes(1)
 })

 it('rejects unauthorized client before reading video or contacting TikTok',async()=>{
  m.access.mockResolvedValue({ok:false,status:403,error:'Forbidden'})
  expect((await POST(new Request('https://test',{method:'POST'}),context)).status).toBe(403)
  expect(m.single).not.toHaveBeenCalled();expect(m.publish).not.toHaveBeenCalled()
 })
 it('rejects unreviewed video without uploading',async()=>{
  m.single.mockResolvedValue({data:{id:'order',client_id:'cts',status:'in_review',output:{video_path:'renders/video.mp4'}}})
  expect((await POST(new Request('https://test',{method:'POST'}),context)).status).toBe(409)
  expect(m.creator).not.toHaveBeenCalled();expect(m.publish).not.toHaveBeenCalled()
 })
 it('refuses a new upload when an earlier task exists, including unknown outcomes',async()=>{
  m.single.mockResolvedValue({data:{id:'order',client_id:'cts',status:'published',output:{video_path:'renders/video.mp4',tiktok_publish:{status:'sending'}}}})
  expect((await POST(new Request('https://test',{method:'POST'}),context)).status).toBe(409)
  expect(m.publish).not.toHaveBeenCalled()
 })
})
