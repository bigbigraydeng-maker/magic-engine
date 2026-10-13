// @vitest-environment node
import {beforeEach,describe,it,expect,vi} from 'vitest'
const m=vi.hoisted(()=>({access:vi.fn(),single:vi.fn(),publish:vi.fn(),creator:vi.fn(),proof:vi.fn(),eq:vi.fn(),updated:vi.fn()}))
vi.mock('@/lib/auth/client-access',()=>({requireDashboardClientAccess:m.access}))
vi.mock('@/lib/supabase',()=>{const q={select:()=>q,eq:(...args:unknown[])=>{m.eq(...args);return q},is:()=>q,update:()=>q,single:m.single,then:(resolve:(x:unknown)=>unknown)=>Promise.resolve(m.updated()).then(resolve)};return {supabaseAdmin:{from:()=>q}}})
vi.mock('@/lib/tiktok/video-proof',()=>({inspectTikTokVideo:m.proof}))
vi.mock('@/lib/factory/publish/tiktok-adapter',()=>({publishToTikTok:m.publish,getTikTokCreatorInfo:m.creator,checkTikTokStatus:vi.fn(),humanTikTokError:()=> 'Unavailable'}))
import {POST} from '../route'
const context={params:{id:'cts',orderId:'order'}}
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://example.com');m.access.mockResolvedValue({ok:true})})
describe('ordinary completed video TikTok publishing gate',()=>{
 it('does not send if the approval changed before atomic claim',async()=>{
  m.single.mockResolvedValue({data:{id:'order',client_id:'cts',status:'approved',output:{video_path:'renders/video.mp4'}}})
  m.creator.mockResolvedValue({accountId:'account',creator_nickname:'CTS',privacy_level_options:['SELF_ONLY'],comment_disabled:false,duet_disabled:false,stitch_disabled:false,max_video_post_duration_sec:30})
  m.proof.mockResolvedValue({sha256:'a'.repeat(64),durationSeconds:12})
  m.updated.mockReturnValue({data:[],error:null})
  const review={accountId:'account',videoUrl:'https://example.com/storage/v1/object/public/content-factory/renders/video.mp4',videoSha256:'a'.repeat(64),privacy:'SELF_ONLY',caption:'Test',allowComment:false,allowDuet:false,allowStitch:false,ownBrand:false,brandedContent:false,musicConsent:true,confirmed:true,durationSeconds:12}
  const result=await POST(new Request('https://test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({review})}),context)
  expect(result.status).toBe(400)
  expect(m.eq).toHaveBeenCalledWith('status','approved')
  expect(m.publish).not.toHaveBeenCalled()
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
