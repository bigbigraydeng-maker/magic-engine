vi.mock('@/lib/tiktok/video-proof',()=>({inspectTikTokVideo:vi.fn(async()=>({sha256:'a'.repeat(64),durationSeconds:12}))}))
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/tiktok/token',()=>({getValidTikTokToken:vi.fn(async()=>({accessToken:'test-token',openId:'test-account'}))}))
import { publishToTikTok } from '@/lib/factory/publish/tiktok-adapter'
const creator = {videoProof:{sha256:'a'.repeat(64),durationSeconds:12},accountId:'test-account',creator_nickname:'Test',privacy_level_options:['SELF_ONLY'],comment_disabled:true,duet_disabled:false,stitch_disabled:false,max_video_post_duration_sec:30}
afterEach(()=>vi.unstubAllGlobals())
describe('TikTok execution guard',()=>{
  it('does not fetch media or initialize upload for an old unconfirmed job',async()=>{
    const fetcher=vi.fn(async(_input: string | URL | Request, _init?: RequestInit)=>new Response(JSON.stringify({error:{code:'ok'},data:creator})))
    vi.stubGlobal('fetch',fetcher)
    await expect(publishToTikTok({clientId:'test',videoUrl:'https://example.com/video.mp4',caption:'Test',privacy:'SELF_ONLY'})).rejects.toThrow('确认')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][0]).toContain('creator_info')
  })
  it('blocks changed account privacy before any media upload',async()=>{
    const fetcher=vi.fn(async(_input: string | URL | Request, _init?: RequestInit)=>new Response(JSON.stringify({error:{code:'ok'},data:{...creator,privacy_level_options:[]}})))
    vi.stubGlobal('fetch',fetcher)
    await expect(publishToTikTok({clientId:'test',videoUrl:'https://example.com/video.mp4',caption:'Test',privacy:'SELF_ONLY',review:{accountId:'test-account',videoUrl:'https://example.com/video.mp4',videoSha256:'a'.repeat(64),privacy:'SELF_ONLY',caption:'Test',allowComment:false,allowDuet:false,allowStitch:false,ownBrand:false,brandedContent:false,musicConsent:true,confirmed:true,durationSeconds:12}})).rejects.toThrow('可见范围')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

it('does not deliver the final chunk when file contents changed during upload',async()=>{
  const calls: string[]=[]
  vi.stubGlobal('fetch',vi.fn(async(input: string | URL | Request,init?: RequestInit)=>{
    const url=String(input);calls.push(`${init?.method ?? 'GET'} ${url}`)
    if(url.includes('creator_info'))return new Response(JSON.stringify({error:{code:'ok'},data:creator}))
    if(init?.method==='HEAD')return new Response(null,{headers:{'content-length':'3'}})
    if(url.includes('/video/init/'))return new Response(JSON.stringify({error:{code:'ok'},data:{publish_id:'test-publish',upload_url:'https://upload.example.com/test'}}))
    if(url==='https://example.com/video.mp4')return new Response('abc')
    throw new Error('Unexpected upload')
  }))
  await expect(publishToTikTok({clientId:'test',videoUrl:'https://example.com/video.mp4',caption:'Test',privacy:'SELF_ONLY',review:{accountId:'test-account',videoUrl:'https://example.com/video.mp4',videoSha256:'a'.repeat(64),privacy:'SELF_ONLY',caption:'Test',allowComment:false,allowDuet:false,allowStitch:false,ownBrand:false,brandedContent:false,musicConsent:true,confirmed:true,durationSeconds:12}})).rejects.toThrow('上传时成片内容已改变')
  expect(calls.some(c=>c.startsWith('PUT'))).toBe(false)
})
