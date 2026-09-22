import { notFound,redirect } from 'next/navigation'
import { pilotDashboardAccess } from '@/lib/meta/ai/http'
import { MetaReadError } from '@/lib/meta/graph-read'
import MetaAdsScreen from './screen'
export default async function Page({ params,searchParams }: { params:{ clientId:string };searchParams:{ outcome?:string } }) {
  try { await pilotDashboardAccess(params.clientId) }
  catch(error) {
    if(error instanceof MetaReadError && error.status===401) redirect(`/login?next=${encodeURIComponent(`/meta-ads-ai/${params.clientId}`)}`)
    if(error instanceof MetaReadError && (error.status===403 || error.status===404)) notFound()
    return <main className="mx-auto max-w-2xl space-y-4 p-6"><h1 className="text-2xl font-semibold">暂时无法打开 Meta 广告 AI</h1>
      <p>连接状态暂时无法读取，请稍后刷新页面。你的 Facebook 授权和广告不会因此被修改。</p>
      <a className="underline" href={`/meta-ads-ai/${params.clientId}`}>重新检查</a></main>
  }
  return <MetaAdsScreen clientId={params.clientId} outcome={searchParams.outcome} />
}
export const dynamic='force-dynamic'
