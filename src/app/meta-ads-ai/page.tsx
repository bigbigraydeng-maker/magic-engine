import Link from 'next/link'
export default function MetaAdsRecovery() {
  return <main className="mx-auto max-w-xl space-y-4 p-8"><h1 className="text-2xl font-semibold">Facebook 连接没有完成</h1>
    <p>授权可能已过期、被取消，或在另一个浏览器中打开。你现有的广告没有被修改。</p>
    <p>请登录 Magic Engine，进入对应客户工作区，点击“Meta 广告 AI 分析（只读测试）”，并在同一浏览器中重新连接。</p>
    <Link className="underline" href="/dashboard">返回工作台</Link></main>
}
