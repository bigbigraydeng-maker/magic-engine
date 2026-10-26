export type Privacy = 'PUBLIC_TO_EVERYONE' | 'SELF_ONLY' | 'FOLLOWER_OF_CREATOR' | 'MUTUAL_FOLLOW_FRIENDS'
export interface CreatorInfo {
  videoProof?: { sha256:string;durationSeconds:number }
  accountId: string
  creator_nickname: string
  privacy_level_options: Privacy[]
  comment_disabled: boolean
  duet_disabled: boolean
  stitch_disabled: boolean
  max_video_post_duration_sec: number
}
export interface PostReview {
  accountId: string
  videoSha256: string
  videoUrl: string
  privacy: Privacy
  caption: string
  allowComment: boolean
  allowDuet: boolean
  allowStitch: boolean
  ownBrand: boolean
  brandedContent: boolean
  musicConsent: boolean
  confirmed: boolean
  durationSeconds: number
}
export function validateReview(value: unknown, creator: CreatorInfo, videoUrl?: string): PostReview {
  if (!value || typeof value !== 'object') throw new Error('请先确认 TikTok 发布设置')
  const v = value as PostReview
  if (!creator.accountId || v.accountId !== creator.accountId) throw new Error('目标账号已改变，请重新确认')
  if (typeof v.videoUrl !== 'string' || !v.videoUrl || (videoUrl !== undefined && v.videoUrl !== videoUrl)) throw new Error('成片已改变，请重新确认')
  if (!/^[a-f0-9]{64}$/.test(v.videoSha256) || !creator.videoProof || v.videoSha256 !== creator.videoProof.sha256) throw new Error('成片内容已改变，请重新预览确认')
  if (Math.abs(v.durationSeconds - creator.videoProof.durationSeconds) > 1) throw new Error('成片时长与核验记录不一致')
  if (!creator.privacy_level_options.includes(v.privacy)) throw new Error('请重新选择账号允许的可见范围')
  for (const key of ['allowComment','allowDuet','allowStitch','ownBrand','brandedContent','musicConsent','confirmed'] as const) {
    if (typeof v[key] !== 'boolean') throw new Error('发布设置不完整')
  }
  if (!v.musicConsent || !v.confirmed) throw new Error('请确认音乐使用条款和发布内容')
  if (typeof v.caption !== 'string' || v.caption.length > 2200) throw new Error('文案过长或格式不正确')
  if (!Number.isFinite(v.durationSeconds) || v.durationSeconds <= 0 || creator.videoProof.durationSeconds > creator.max_video_post_duration_sec) throw new Error('视频时长超出账号当前限制')
  if ((creator.comment_disabled && v.allowComment) || (creator.duet_disabled && v.allowDuet) || (creator.stitch_disabled && v.allowStitch)) throw new Error('账号已关闭所选互动功能')
  if (v.brandedContent && v.privacy === 'SELF_ONLY') throw new Error('品牌合作内容不能使用仅自己可见')
  return { videoSha256:v.videoSha256,accountId:v.accountId,videoUrl:v.videoUrl,privacy:v.privacy,caption:v.caption,allowComment:v.allowComment,allowDuet:v.allowDuet,allowStitch:v.allowStitch,ownBrand:v.ownBrand,brandedContent:v.brandedContent,musicConsent:true,confirmed:true,durationSeconds:creator.videoProof.durationSeconds }
}
