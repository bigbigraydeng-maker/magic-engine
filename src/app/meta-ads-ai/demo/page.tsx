import type { Metadata } from 'next'
import ReportView from '../[clientId]/ReportView'
import { demoAnalysis } from './sample'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '示例报告 · Magic Bridge',
  robots: { index: false, follow: false },
}

export default function DemoPage() {
  // 按新西兰日期算「今天」：主要看演示的人在澳新，按 UTC 算会差一天
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date())
  const analysis = demoAnalysis(today)
  return <main className="mx-auto max-w-3xl space-y-6 p-6">
    <p role="note" className="sticky top-0 z-10 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
      以下数字全部是虚构的样例。报告的格式和检查方法，跟签约客户看到的一模一样。
    </p>
    <header className="space-y-2">
      <p className="text-xs font-medium text-slate-500">Magic Bridge · Magic Engine 出品</p>
      <h1 className="text-3xl font-semibold text-slate-950">示例报告：Magic Bridge 每周给你看什么</h1>
      <p className="text-sm text-slate-600">示例商家 · 奥克兰一家美容护肤店</p>
    </header>
    <p className="text-slate-700">签约代管后，我们每天检查你的广告；发现哪条变差了，会像下面这样写清楚，由团队跟进处理。</p>
    <ReportView analysis={analysis} />
    <footer className="border-t border-slate-200 pt-4 text-sm text-slate-700">
      <p>想知道你自己的广告现在是什么情况？写信到 <a className="underline" href="mailto:hello@magicengine.cloud?subject=Magic%20Bridge%20广告报告">hello@magicengine.cloud</a>，说说你做什么生意，我们回复你怎么帮你看一份。</p>
    </footer>
  </main>
}
