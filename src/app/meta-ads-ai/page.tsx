import Link from 'next/link'
export default function MetaAdsRecovery() {
  return <main className="mx-auto max-w-xl space-y-4 p-8"><h1 className="text-2xl font-semibold">Facebook 连接没有完成</h1>
    <p>授权可能已过期、被取消，或在另一个浏览器中打开。你现有的广告没有被修改。</p>
    <p>请回到 Facebook 广告体检页面，在同一个浏览器里重新连接。</p>
    <Link className="underline" href="/meta-ads-ai/mine">回到广告体检</Link></main>
}
