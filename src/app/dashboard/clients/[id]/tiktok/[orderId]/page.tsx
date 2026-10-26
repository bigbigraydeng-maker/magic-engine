'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { TikTokPostReview } from '@/components/tiktok/PostReview'
interface Asset {videoUrl:string;caption:string;title:string;submission:{status:string;privacy?:string;error?:string}|null}
export default function TikTokOrderPage() {
  const {id,orderId} = useParams<{id:string;orderId:string}>()
  const endpoint = `/api/clients/${id}/tiktok/orders/${orderId}`
  const [asset,setAsset] = useState<Asset|null>(null)
  const [error,setError] = useState('')
  const [refresh,setRefresh] = useState(0)
  useEffect(()=>{
    let active = true
    fetch(`${endpoint}?info_only=1`,{cache:'no-store'}).then(async r=>{const data=await r.json();if(!r.ok) throw new Error(data.error);if(active)setAsset(data)}).catch(e=>{if(active)setError(e.message)})
    return ()=>{active=false}
  },[endpoint,refresh])
  return <main className="mx-auto max-w-3xl p-6">
    <Link href={`/dashboard/clients/${id}`}>← 返回客户</Link>
    <h1 className="my-4 text-xl font-bold">发布成片到 TikTok</h1>
    {error && <p role="alert">{error}</p>}
    {asset?.submission ? <div><p role="status">{asset.submission.status==='published' ? (asset.submission.privacy==='SELF_ONLY' ? 'TikTok 已完成发布（仅自己可见）' : 'TikTok 已完成发布') : asset.submission.status==='failed' ? 'TikTok 处理失败，请核验原任务' : 'TikTok 任务尚未完成，请查询状态；不要重复上传'}</p><p>{asset.submission.error}</p><button onClick={()=>setRefresh(v=>v+1)}>查询状态</button><video src={asset.videoUrl} controls className="mt-4 w-full" /></div> : asset && <TikTokPostReview clientId={id} postId={orderId} videoUrl={asset.videoUrl} caption={asset.caption} creatorEndpoint={endpoint} onClose={()=>{window.location.href=`/dashboard/clients/${id}`}} onSubmit={async review=>{
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({review})})
      const data=await response.json();if(!response.ok) throw new Error(data.error)
      setRefresh(v=>v+1)
    }} />}
  </main>
}
