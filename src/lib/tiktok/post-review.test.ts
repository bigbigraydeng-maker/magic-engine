import { describe, expect, it } from 'vitest'
import { validateReview, type CreatorInfo, type PostReview } from './post-review'
const creator: CreatorInfo = { videoProof:{sha256:'a'.repeat(64),durationSeconds:12},accountId:'test-account',creator_nickname:'Test',privacy_level_options:['SELF_ONLY'],comment_disabled:true,duet_disabled:false,stitch_disabled:false,max_video_post_duration_sec:30 }
const review: PostReview = { accountId:'test-account',videoUrl:'https://example.com/video.mp4',videoSha256:'a'.repeat(64),privacy:'SELF_ONLY',caption:'Original video',allowComment:false,allowDuet:false,allowStitch:false,ownBrand:false,brandedContent:false,musicConsent:true,confirmed:true,durationSeconds:12 }
describe('TikTok post confirmation', () => {
  it('rejects changed media bytes at unchanged URL',()=>expect(()=>validateReview({...review,videoSha256:'b'.repeat(64)},creator,review.videoUrl)).toThrow('内容已改变'))
  it('uses server duration despite harmless browser rounding',()=>expect(validateReview({...review,durationSeconds:12.8},creator).durationSeconds).toBe(12))
  it('rejects authoritative server duration beyond account limit',()=>expect(()=>validateReview(review,{...creator,videoProof:{sha256:review.videoSha256,durationSeconds:31}})).toThrow('时长'))
  it('rejects browser duration inconsistent with server inspection',()=>expect(()=>validateReview({...review,durationSeconds:4},creator)).toThrow('时长'))
  it('rejects changed account',()=>expect(()=>validateReview({...review,accountId:'other-account'},creator)).toThrow('账号已改变'))
  it('rejects changed video before queuing or sending',()=>expect(()=>validateReview(review,creator,'https://example.com/replacement.mp4')).toThrow('成片已改变'))
  it('rejects old jobs without confirmation',()=>expect(()=>validateReview(undefined,creator)).toThrow())
  it('rejects unavailable public privacy',()=>expect(()=>validateReview({...review,privacy:'PUBLIC_TO_EVERYONE'},creator)).toThrow())
  it('rejects an interaction disabled by the account',()=>expect(()=>validateReview({...review,allowComment:true},creator)).toThrow())
  it('requires explicit music consent',()=>expect(()=>validateReview({...review,musicConsent:false},creator)).toThrow())
  it('requires final user confirmation',()=>expect(()=>validateReview({...review,confirmed:false},creator)).toThrow())
  it('rejects duration outside creator limit',()=>expect(()=>validateReview({...review,durationSeconds:31},creator)).toThrow())
  it('rejects branded content with private visibility',()=>expect(()=>validateReview({...review,brandedContent:true},creator)).toThrow())
  it('accepts reviewed original brand promotion with disabled interactions',()=>expect(validateReview({...review,ownBrand:true},creator).ownBrand).toBe(true))
  it('rejects missing booleans instead of silently enabling interactions',()=>expect(()=>validateReview({...review,allowDuet:undefined},creator)).toThrow())
})
