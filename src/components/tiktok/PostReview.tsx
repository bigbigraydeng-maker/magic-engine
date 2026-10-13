'use client'
import { useEffect, useState } from 'react'
import { validateReview, type CreatorInfo, type PostReview, type Privacy } from '@/lib/tiktok/post-review'
export function TikTokPostReview({ clientId, postId, videoUrl, caption, creatorEndpoint, onSubmit, onClose }: {
  clientId: string; postId: string; videoUrl: string; caption: string; creatorEndpoint?: string
  onSubmit: (review: PostReview) => Promise<void>; onClose: () => void
}) {
  const [creator, setCreator] = useState<CreatorInfo | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [disclose, setDisclose] = useState(false)
  const [review, setReview] = useState<PostReview>({ accountId:'',videoSha256:'',videoUrl,privacy: '' as Privacy, caption, allowComment:false, allowDuet:false, allowStitch:false, ownBrand:false, brandedContent:false, musicConsent:false, confirmed:false, durationSeconds:0 })
  useEffect(() => {
    let active = true
    fetch(creatorEndpoint ?? `/api/clients/${clientId}/tiktok/creator?post_id=${encodeURIComponent(postId)}`, { cache:'no-store' }).then(async r => {
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || '无法读取 TikTok 账号')
      if (active) { setCreator(data); setReview(v => ({ ...v, accountId:data.accountId,videoSha256:data.videoProof?.sha256 ?? '' })) }
    }).catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [clientId, postId, creatorEndpoint])
  function set(key: keyof PostReview, value: boolean | number | string) { setReview(v => ({ ...v, [key]: value })) }
  async function submit() {
    if (!creator) return
    try {
      if (disclose && !review.ownBrand && !review.brandedContent) throw new Error('请选择推广类型')
      const checked = validateReview(review, creator, videoUrl)
      setBusy(true); setError(''); await onSubmit(checked); onClose()
    } catch (e) { setError(e instanceof Error ? e.message : '发布请求失败') }
    finally { setBusy(false) }
  }
  return <div role="dialog" aria-modal="true" aria-label="TikTok 发布确认" className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-6">
    <div className="mx-auto max-w-xl rounded-xl bg-white p-6 space-y-4">
      <h2 className="font-semibold text-lg">TikTok 发布确认</h2>
      <p>目标账号：{creator?.creator_nickname || '读取中…'}</p>
      <video controls src={videoUrl} className="max-h-64 w-full" onLoadedMetadata={e => set('durationSeconds', e.currentTarget.duration)} />
      <label className="block">视频文案<textarea className="block w-full border p-2" value={review.caption} maxLength={2200} onChange={e => set('caption', e.target.value)} /></label>
      <label className="block">谁可以看<select className="block border p-2" value={review.privacy} onChange={e => set('privacy', e.target.value)}>
        <option value="" disabled>请选择可见范围</option>
        {creator?.privacy_level_options.map(p => <option key={p} value={p}>{({PUBLIC_TO_EVERYONE:'所有人',SELF_ONLY:'仅自己',FOLLOWER_OF_CREATOR:'关注者',MUTUAL_FOLLOW_FRIENDS:'互相关注的朋友'})[p]}</option>)}
      </select></label>
      {(['allowComment','allowDuet','allowStitch'] as const).map((key, i) => <label className="block" key={key}>
        <input type="checkbox" checked={review[key]} disabled={!creator || [creator.comment_disabled,creator.duet_disabled,creator.stitch_disabled][i]} onChange={e => set(key,e.target.checked)} /> {['允许评论','允许合拍','允许拼接'][i]}
      </label>)}
      <label className="block"><input type="checkbox" checked={disclose} onChange={e => { setDisclose(e.target.checked); if (!e.target.checked) setReview(v => ({...v,ownBrand:false,brandedContent:false})) }} /> 此视频推广品牌、产品或服务</label>
      {disclose && <div>
        <label className="block"><input type="checkbox" checked={review.ownBrand} onChange={e => set('ownBrand',e.target.checked)} /> 自己的品牌（视频将标记为推广内容）</label>
        <label className="block"><input type="checkbox" checked={review.brandedContent} onChange={e => set('brandedContent',e.target.checked)} /> 品牌合作（视频将标记为付费合作）</label>
        {review.brandedContent && <p>品牌合作内容不能设置为仅自己可见。发布同时同意 TikTok <a href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noreferrer">Branded Content Policy</a>。</p>}
      </div>}
      <label className="block"><input type="checkbox" checked={review.musicConsent} onChange={e => set('musicConsent',e.target.checked)} /> 发布即表示同意 TikTok <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noreferrer">Music Usage Confirmation</a></label>
      <label className="block"><input type="checkbox" checked={review.confirmed} onChange={e => set('confirmed',e.target.checked)} /> 我已检查视频及以上设置，并确认发送至此账号</label>
      <p>发送后视频处理可能需要几分钟，处理结果将显示在工作台。</p>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <button disabled={busy} onClick={onClose} className="border px-4 py-2">取消</button>
      <button disabled={busy || !creator} onClick={submit} className="border px-4 py-2">{busy ? '提交中…' : '确认发布到 TikTok'}</button>
    </div>
  </div>
}
