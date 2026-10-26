import { supabaseAdmin } from '@/lib/supabase'
import { inspectTikTokVideo } from './video-proof'

const BUCKET = 'content-factory'
const PUBLIC_PREFIX = '/storage/v1/object/public/content-factory/'

/** Only the client's own server-rendered videos can become a public pull source. */
export function storedTikTokSourcePath(videoUrl: string, clientId: string): string {
  const url = new URL(videoUrl)
  const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin
  if (videoUrl.includes('\\') || !/^[a-zA-Z0-9-]+$/.test(clientId) || url.protocol !== 'https:' || url.origin !== origin || url.username || url.password || url.search || url.hash || !url.pathname.startsWith(PUBLIC_PREFIX)) throw new Error('TikTok 仅支持此客户已入库的成片')
  const path = url.pathname.slice(PUBLIC_PREFIX.length)
  if (/%|\\/.test(path) || path.split('/').some(p => !p || p === '.' || p === '..') || !path.endsWith('.mp4') || (!path.startsWith(`renders/${clientId}/`) && !path.startsWith(`${clientId}/render/`))) throw new Error('成片存储路径不属于此客户')
  return path
}

/** Freeze reviewed bytes under a content-addressed, non-overwriting object before init. */
export async function snapshotReviewedTikTokVideo(videoUrl: string, clientId: string, sha256: string): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('成片核验记录无效')
  const source = storedTikTokSourcePath(videoUrl, clientId)
  const path = `tiktok-publish/${clientId}/${sha256}.mp4`
  const storage = supabaseAdmin.storage.from(BUCKET)
  const { error } = await storage.copy(source, path)
  // copy never overwrites; an existing hash object is acceptable only after reinspection.
  if (error && String((error as { statusCode?: string | number }).statusCode) !== '409') throw new Error('无法准备 TikTok 发布副本')
  const url = storage.getPublicUrl(path).data.publicUrl
  const expected = `${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin}${PUBLIC_PREFIX}${path}`
  if (url !== expected) throw new Error('发布地址不属于已验证的存储前缀')
  const proof = await inspectTikTokVideo(url)
  if (proof.sha256 !== sha256) throw new Error('发布副本与已确认视频不一致，发布已停止')
  return url
}
