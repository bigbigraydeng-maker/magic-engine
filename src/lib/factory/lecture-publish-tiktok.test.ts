import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('./lecture-post', () => ({loadLecturePost:vi.fn(), claimLecturePublish:vi.fn(), recordPublished:vi.fn(),setPublishRequest:vi.fn()}))
vi.mock('./publish/tiktok-adapter', () => ({publishToTikTok:vi.fn(),checkTikTokStatus:vi.fn(),humanTikTokError:(v:string)=>v}))
import { loadLecturePost,claimLecturePublish,recordPublished,setPublishRequest } from './lecture-post'
import { publishToTikTok,checkTikTokStatus } from './publish/tiktok-adapter'
import {runOneLecturePublish,selectPendingPublishes} from './lecture-publish'
import {TikTokAmbiguousConnectionError} from '@/lib/tiktok/token'
const request={platform:'tiktok' as const,status:'pending' as const,requestedAt:'2026-10-13',tiktokReview:{privacy:'SELF_ONLY'}}
function load(req:unknown=request,published:unknown[]=[]) {
  vi.mocked(loadLecturePost).mockResolvedValue({post:{updated_at:'revision',source_video_url:'https://example.com/video.mp4',generation_context_snapshot:{lecture_publish_request:req}},lecture:{title:'Test'},publishRequest:req,published} as never)
}
beforeEach(()=>{vi.clearAllMocks();load();vi.mocked(claimLecturePublish).mockResolvedValue(true);vi.mocked(setPublishRequest).mockResolvedValue(undefined);vi.mocked(recordPublished).mockResolvedValue(undefined)})
afterEach(()=>vi.unstubAllEnvs())
describe('TikTok durable publish task',()=>{
  it('persists init before upload returns and keeps processing pending',async()=>{
    vi.mocked(publishToTikTok).mockImplementation(async p=>{await p.onInitialized!('provider-id','account');expect(setPublishRequest).toHaveBeenCalledWith(expect.objectContaining({request:expect.objectContaining({tiktokPublishId:'provider-id',tiktokAccountId:'account'})}));return{publishId:'provider-id',privacy:'SELF_ONLY'}})
    vi.mocked(checkTikTokStatus).mockResolvedValue({status:'processing'})
    expect(await runOneLecturePublish({clientId:'c',postId:'p'})).toMatchObject({processing:true,ok:false})
    expect(recordPublished).not.toHaveBeenCalled()
    expect(vi.mocked(setPublishRequest).mock.lastCall?.[0].request).toMatchObject({status:'processing',tiktokPublishId:'provider-id'})
  })
  it('recovers a saved task by querying status without another upload',async()=>{
    load({...request,status:'processing',tiktokPublishId:'existing',tiktokAccountId:'account'})
    vi.mocked(checkTikTokStatus).mockResolvedValue({status:'published'})
    expect(await runOneLecturePublish({clientId:'c',postId:'p'})).toMatchObject({ok:true,draft:true})
    expect(publishToTikTok).not.toHaveBeenCalled()
    expect(checkTikTokStatus).toHaveBeenCalledWith('c','existing','account')
  })
  it('keeps the original task when provider status lookup fails',async()=>{
    load({...request,status:'processing',tiktokPublishId:'existing'})
    vi.mocked(checkTikTokStatus).mockRejectedValue(new Error('network'))
    await runOneLecturePublish({clientId:'c',postId:'p'})
    expect(vi.mocked(setPublishRequest).mock.lastCall?.[0].request).toMatchObject({status:'processing',tiktokPublishId:'existing'})
    expect(publishToTikTok).not.toHaveBeenCalled()
  })
  it('does not send when another worker wins the atomic claim',async()=>{
    vi.mocked(claimLecturePublish).mockResolvedValue(false)
    expect(await runOneLecturePublish({clientId:'c',postId:'p'})).toMatchObject({ok:false})
    expect(publishToTikTok).not.toHaveBeenCalled()
  })
  it('private TikTok receipts remain idempotent with Facebook live enabled',async()=>{
    vi.stubEnv('FACTORY_PUBLISH_LIVE','true');load(request,[{platform:'tiktok',draft:true}])
    expect(await runOneLecturePublish({clientId:'c',postId:'p'})).toMatchObject({alreadyPublished:true})
    expect(publishToTikTok).not.toHaveBeenCalled()
  })
  it('multiple TikTok authorisations: records the explicit reason, not "result unconfirmed" (nothing was ever initialised)',async()=>{
    vi.mocked(publishToTikTok).mockRejectedValue(new TikTokAmbiguousConnectionError())
    const message='存在多个 TikTok 授权,已暂停发布,请联系团队核实'
    expect(await runOneLecturePublish({clientId:'c',postId:'p'})).toMatchObject({ok:false,error:message})
    expect(vi.mocked(setPublishRequest).mock.lastCall?.[0].request).toMatchObject({status:'failed',error:message})
    expect(checkTikTokStatus).not.toHaveBeenCalled()
  })
  it('an already-sent task keeps processing (never failed, never re-sent) if authorisations become ambiguous mid-flight',async()=>{
    load({...request,status:'processing',tiktokPublishId:'existing',tiktokAccountId:'account'})
    vi.mocked(checkTikTokStatus).mockRejectedValue(new TikTokAmbiguousConnectionError())
    expect(await runOneLecturePublish({clientId:'c',postId:'p'})).toMatchObject({ok:false})
    expect(vi.mocked(setPublishRequest).mock.lastCall?.[0].request).toMatchObject({status:'processing',tiktokPublishId:'existing'})
    expect(publishToTikTok).not.toHaveBeenCalled();expect(recordPublished).not.toHaveBeenCalled()
  })
  it('does not automatically repeat an uncertain initialization',()=>{
    const rows=[{id:'p',client_id:'c',generation_context_snapshot:{lecture_publish_request:{platform:'tiktok',status:'sending',startedAt:'2026-01-01'}}}]
    expect(selectPendingPublishes(rows,Date.now(),1)).toEqual([])
  })
})
