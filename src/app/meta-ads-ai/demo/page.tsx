import type { Metadata } from 'next'
import ReportView from '../[clientId]/ReportView'
import { demoAnalysis } from './sample'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '示例报告 · Magic Engine Facebook 广告体检',
  robots: { index: false, follow: false },
}

export default function DemoPage({ searchParams }: { searchParams: { view?: string } }) {
  const view = searchParams.view === 'managed' ? 'managed' : 'self_serve'
  // 按新西兰日期算「今天」：主要看演示的人在澳新，按 UTC 算会差一天
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(new Date())
  const analysis = demoAnalysis(today, view)
  return <main className="mx-auto max-w-3xl space-y-6 p-6">
    <p role="note" className="sticky top-0 z-10 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
      以下是虚构的示例店铺，数字不是真实客户的。报告的格式和检查方法跟真实报告一样。
    </p>
    <header className="space-y-2">
      <p className="text-xs font-medium text-slate-500">Magic Engine · Facebook 广告体检</p>
      <h1 className="text-3xl font-semibold text-slate-950">示例报告：体检报告长什么样</h1>
      <p className="text-sm text-slate-600">示例商家 · 奥克兰一家美容护肤店</p>
    </header>
    <nav className="flex gap-2 text-sm">
      <a
        href="/meta-ads-ai/demo"
        aria-current={view === 'self_serve' ? 'page' : undefined}
        className={view === 'self_serve'
          ? 'rounded-full border border-slate-900 bg-slate-900 px-4 py-1.5 font-medium text-white no-underline'
          : 'rounded-full border border-slate-300 px-4 py-1.5 text-slate-700 no-underline'}
      >
        自己用，你会看到
      </a>
      <a
        href="/meta-ads-ai/demo?view=managed"
        aria-current={view === 'managed' ? 'page' : undefined}
        className={view === 'managed'
          ? 'rounded-full border border-slate-900 bg-slate-900 px-4 py-1.5 font-medium text-white no-underline'
          : 'rounded-full border border-slate-300 px-4 py-1.5 text-slate-700 no-underline'}
      >
        交给我们管，你会看到
      </a>
    </nav>
    <p className="text-slate-700">
      {view === 'self_serve'
        ? '自己注册就能用：连上广告账户，点一下生成报告。哪条广告值得你看一眼、可以怎么改，都写在里面，改不改由你决定。'
        : '交给我们代管后，我们每天检查你的广告；发现哪条变差了，会像下面这样写清楚，由团队跟进处理。'}
    </p>
    <ReportView analysis={analysis} />
    <footer className="space-y-3 border-t border-slate-200 pt-4 text-sm text-slate-700">
      <a
        href="/meta-ads-ai/mine"
        className="inline-block rounded bg-slate-900 px-4 py-2 font-medium text-white no-underline"
      >
        免费体检我的广告
      </a>
      <p>
        想让我们帮你管？写邮件到{' '}
        <a className="underline" href="mailto:hello@magicengine.cloud?subject=Facebook%20广告体检">
          hello@magicengine.cloud
        </a>{' '}
        聊聊。
      </p>
    </footer>
  </main>
}
