import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
vi.mock('@/lib/tiktok/video-proof',()=>({inspectTikTokVideo:vi.fn(async()=>({sha256:'a'.repeat(64),durationSeconds:12}))}))
vi.mock('@/lib/tiktok/token',async(importOriginal)=>({...(await importOriginal<typeof import('@/lib/tiktok/token')>()),getValidTikTokToken:vi.fn(async()=>({accessToken:'test-token',openId:'test-account'}))}))
vi.mock('@/lib/tiktok/publish-source',()=>({storedTikTokSourcePath:vi.fn(),snapshotReviewedTikTokVideo:vi.fn(async()=> 'https://storage.example.com/tiktok-publish/test/hash.mp4')}))
import {publishToTikTok,checkTikTokStatus} from '@/lib/factory/publish/tiktok-adapter'
import {getValidTikTokToken,TikTokAmbiguousConnectionError} from '@/lib/tiktok/token'
import {snapshotReviewedTikTokVideo} from './publish-source'
const creator={accountId:'test-account',creator_nickname:'Test',privacy_level_options:['SELF_ONLY'],comment_disabled:true,duet_disabled:false,stitch_disabled:false,max_video_post_duration_sec:30}
const review={accountId:'test-account',videoUrl:'https://example.com/video.mp4',videoSha256:'a'.repeat(64),privacy:'SELF_ONLY' as const,caption:'Test',allowComment:false,allowDuet:false,allowStitch:false,ownBrand:false,brandedContent:false,musicConsent:true,confirmed:true,durationSeconds:12}
beforeEach(()=>{vi.clearAllMocks();vi.mocked(snapshotReviewedTikTokVideo).mockResolvedValue('https://storage.example.com/tiktok-publish/test/hash.mp4')})
afterEach(()=>vi.unstubAllGlobals())
function provider(options=creator){return vi.fn(async(input: string | URL | Request,_init?:RequestInit)=>new Response(JSON.stringify({error:{code:'ok'},data:String(input).includes('creator_info')?options:{publish_id:'test-publish'}})))}
describe('TikTok pull execution guard',()=>{
  it('does not prepare media or initialize an unconfirmed job',async()=>{
    const fetcher=provider();vi.stubGlobal('fetch',fetcher)
    await expect(publishToTikTok({clientId:'test',videoUrl:review.videoUrl,caption:'Test',privacy:'SELF_ONLY'})).rejects.toThrow('确认')
    expect(fetcher).toHaveBeenCalledTimes(1);expect(snapshotReviewedTikTokVideo).not.toHaveBeenCalled()
  })
  it('blocks changed account privacy before preparing a pull source',async()=>{
    const fetcher=provider({...creator,privacy_level_options:[]});vi.stubGlobal('fetch',fetcher)
    await expect(publishToTikTok({clientId:'test',videoUrl:review.videoUrl,caption:'Test',privacy:'SELF_ONLY',review})).rejects.toThrow('可见范围')
    expect(fetcher).toHaveBeenCalledTimes(1);expect(snapshotReviewedTikTokVideo).not.toHaveBeenCalled()
  })
  it('pulls only the verified snapshot and persists the provider task without PUT',async()=>{
    const fetcher=provider();vi.stubGlobal('fetch',fetcher);const persist=vi.fn()
    expect(await publishToTikTok({clientId:'test',videoUrl:review.videoUrl,caption:'Test',privacy:'SELF_ONLY',review,onInitialized:persist})).toMatchObject({publishId:'test-publish'})
    const init=JSON.parse(String(fetcher.mock.calls[1][1]?.body))
    expect(init.source_info).toEqual({source:'PULL_FROM_URL',video_url:'https://storage.example.com/tiktok-publish/test/hash.mp4'})
    expect(snapshotReviewedTikTokVideo).toHaveBeenCalledWith(review.videoUrl,'test',review.videoSha256)
    expect(persist).toHaveBeenCalledWith('test-publish','test-account');expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('does not initialize if snapshot identity verification fails',async()=>{
    const fetcher=provider();vi.stubGlobal('fetch',fetcher);vi.mocked(snapshotReviewedTikTokVideo).mockRejectedValue(new Error('identity changed'))
    await expect(publishToTikTok({clientId:'test',videoUrl:review.videoUrl,caption:'Test',privacy:'SELF_ONLY',review})).rejects.toThrow('identity changed')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('does not initialize again after the provider receipt cannot be saved',async()=>{
    const fetcher=provider();vi.stubGlobal('fetch',fetcher);const log=vi.spyOn(console,'error').mockImplementation(()=>{})
    await expect(publishToTikTok({clientId:'test',videoUrl:review.videoUrl,caption:'Test',privacy:'SELF_ONLY',review,onInitialized:async()=>{throw new Error('database unavailable')}})).rejects.toThrow('database unavailable')
    expect(fetcher).toHaveBeenCalledTimes(2);expect(log).toHaveBeenCalledWith(expect.any(String),{clientId:'test',publishId:'test-publish'});log.mockRestore()
  })
})
describe('multiple TikTok authorisations through the real adapter',()=>{
  it('publish: the ambiguity error reaches the caller unchanged and nothing is sent to TikTok',async()=>{
    const fetcher=provider();vi.stubGlobal('fetch',fetcher)
    vi.mocked(getValidTikTokToken).mockRejectedValueOnce(new TikTokAmbiguousConnectionError())
    await expect(publishToTikTok({clientId:'test',videoUrl:review.videoUrl,caption:'Test',privacy:'SELF_ONLY',review})).rejects.toBeInstanceOf(TikTokAmbiguousConnectionError)
    expect(fetcher).not.toHaveBeenCalled();expect(snapshotReviewedTikTokVideo).not.toHaveBeenCalled()
  })
  it('status poll of an already-sent task asks for its original account; a fresh publish does not',async()=>{
    const fetcher=vi.fn(async()=>new Response(JSON.stringify({error:{code:'ok'},data:{status:'PUBLISH_COMPLETE'}})));vi.stubGlobal('fetch',fetcher)
    expect(await checkTikTokStatus('test','pid','test-account')).toEqual({status:'published'})
    expect(getValidTikTokToken).toHaveBeenLastCalledWith('test',{accountId:'test-account'})
    await checkTikTokStatus('test','pid')
    expect(getValidTikTokToken).toHaveBeenLastCalledWith('test',undefined)
  })
})

