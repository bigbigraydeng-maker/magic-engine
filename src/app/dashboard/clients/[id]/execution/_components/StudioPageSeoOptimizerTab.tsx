'use client'

/**
 * StudioPageSeoOptimizerTab — Phase 22.E.S13 stub.
 *
 * Routes from action_type === 'seo.optimize_page_seo'. The full backend
 * (read existing page → diff title / meta / H1 / Schema → push to WP / Next.js)
 * is tracked as S15.
 *
 * Why no Expected-Impact card here:
 *   Same reason as StudioLandingPageTab — computeExpectedImpact needs
 *   rule_id (currently 'low_ctr_title' for CTR rewrites), which is only set
 *   by patrol cron, not by FDE-manual / QA-injected actions. Adding a card
 *   that silently never renders is worse than not adding one.
 */

import type { ExecutionItem } from '@/types/diagnostic'

interface Props {
  clientId: string
  item: ExecutionItem
}

interface PageOptimiserMetadata {
  url: string | null
  keyword: string | null
  position: number | null
  ctr: number | null
  ctrBenchmark: number | null
}

function readMetadata(item: ExecutionItem): PageOptimiserMetadata {
  const empty: PageOptimiserMetadata = {
    url: null, keyword: null, position: null, ctr: null, ctrBenchmark: null,
  }
  const meta = item.steps_json
  if (!meta || typeof meta !== 'object') return empty
  const m = meta as Record<string, unknown>
  return {
    url: typeof m.url === 'string' ? m.url : null,
    keyword: typeof m.keyword === 'string' ? m.keyword : null,
    position: typeof m.position === 'number' ? m.position : null,
    ctr: typeof m.ctr === 'number' ? m.ctr : null,
    ctrBenchmark: typeof m.ctr_benchmark === 'number' ? m.ctr_benchmark : null,
  }
}

function fmtPct(n: number | null): string {
  if (n === null) return '—'
  return `${(n * 100).toFixed(1)}%`
}

export function StudioPageSeoOptimizerTab({ item }: Props) {
  const { url, keyword, position, ctr, ctrBenchmark } = readMetadata(item)

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Stub banner with concrete fallback instruction */}
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
        <div className="text-sm font-black text-amber-900">🚧 页面 SEO 元素优化器开发中</div>
        <div className="mt-2 text-[12px] text-amber-900/85 leading-relaxed">
          后端 S15（读 URL → 改 title / meta / H1 / Schema → 推送 WP / Next.js）尚未上线。
          <br />
          <strong>临时替代方案</strong>：FDE 可先在 ME 后台
          <strong> SEO Intelligence → Page Health</strong> 查看现有页面的 GSC 表现，
          手动改 title / meta / H1 / Schema 后通过 CMS 推送上线。
        </div>
      </div>

      {/* Target URL */}
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">目标页面 URL</label>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 break-all">
          {url ?? <span className="text-gray-400">（未配置 — 此 action 缺 steps_json.url）</span>}
        </div>
      </div>

      {/* Performance context */}
      {(keyword || position !== null || ctr !== null) && (
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="text-[11px] font-bold text-gray-500 tracking-wide mb-2">当前表现（来自 patrol metadata）</div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-gray-500">目标关键词</div>
              <div className="font-black text-gray-900">{keyword ?? '—'}</div>
            </div>
            <div>
              <div className="text-gray-500">当前排名</div>
              <div className="font-black text-gray-900">{position ?? '—'}</div>
            </div>
            <div>
              <div className="text-gray-500">当前 CTR</div>
              <div className="font-black text-gray-900">{fmtPct(ctr)}</div>
            </div>
            <div>
              <div className="text-gray-500">基准 CTR</div>
              <div className="font-black text-gray-900">{fmtPct(ctrBenchmark)}</div>
            </div>
          </div>
        </div>
      )}

      <div className="text-[11px] text-gray-400">
        路由依据：<code className="text-[10px] bg-gray-100 px-1 py-0.5 rounded">action_type === &quot;seo.optimize_page_seo&quot;</code>
      </div>
    </div>
  )
}
