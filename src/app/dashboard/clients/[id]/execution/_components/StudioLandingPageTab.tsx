'use client'

/**
 * StudioLandingPageTab — Phase 22.E.S13 stub.
 *
 * Routes from action_type === 'seo.publish_landing_page'. The full backend
 * (Product / Service Schema generator, conversion-oriented page structure) is
 * tracked as S14. This stub exists to make the routing complete + the work
 * type explicit on the kanban — instead of all SEO actions silently funneling
 * into the article workbench.
 *
 * Why no Expected-Impact card here:
 *   computeExpectedImpact routes on steps_json.rule_id. Landing-page actions
 *   created by FDE / QA injection do not carry rule_id='phase1_landing_page',
 *   so the card would render blank. We intentionally omit it until S9-prereq
 *   guarantees rule_id presence — showing a silently-empty card would confuse
 *   the FDE into thinking the system broke.
 */

import type { ExecutionItem } from '@/types/diagnostic'

interface Props {
  clientId: string
  item: ExecutionItem
}

interface LandingPageMetadata {
  keyword: string | null
  searchVolume: number | null
  kd: number | null
  category: string | null
}

function readMetadata(item: ExecutionItem): LandingPageMetadata {
  const empty: LandingPageMetadata = {
    keyword: null, searchVolume: null, kd: null, category: null,
  }
  const meta = item.steps_json
  if (!meta || typeof meta !== 'object') return empty
  const m = meta as Record<string, unknown>
  return {
    keyword: typeof m.keyword === 'string' ? m.keyword : null,
    searchVolume: typeof m.search_volume === 'number' ? m.search_volume : null,
    kd: typeof m.keyword_difficulty === 'number' ? m.keyword_difficulty : null,
    category: typeof m.category === 'string' ? m.category : null,
  }
}

export function StudioLandingPageTab({ item }: Props) {
  const { keyword, searchVolume, kd, category } = readMetadata(item)

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Stub banner with concrete fallback instruction */}
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
        <div className="text-sm font-black text-amber-900">🚧 落地页生成器开发中</div>
        <div className="mt-2 text-[12px] text-amber-900/85 leading-relaxed">
          后端 S14（落地页生成 API，含 Product/Service Schema + 转化导向结构）尚未上线。
          <br />
          <strong>临时替代方案</strong>：请使用 <strong>SEO 文章 Tab</strong> 生成长篇内容
          （将本页关键词填入），内容生成后由 CMS 同事上传为落地页结构，并手动添加
          Schema.org Product / Service 标记。
        </div>
      </div>

      {/* Target keyword display */}
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">目标关键词</label>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900">
          {keyword ?? <span className="text-gray-400">（未配置 — 此 action 缺 steps_json.keyword）</span>}
        </div>
      </div>

      {/* Search context */}
      {(searchVolume !== null || kd !== null || category) && (
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="text-[11px] font-bold text-gray-500 tracking-wide mb-2">关键词上下文（来自 patrol metadata）</div>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div>
              <div className="text-gray-500">月搜索量</div>
              <div className="font-black text-gray-900">{searchVolume ?? '—'}</div>
            </div>
            <div>
              <div className="text-gray-500">关键词难度</div>
              <div className="font-black text-gray-900">{kd ?? '—'}</div>
            </div>
            <div>
              <div className="text-gray-500">品类</div>
              <div className="font-black text-gray-900">{category ?? '—'}</div>
            </div>
          </div>
        </div>
      )}

      <div className="text-[11px] text-gray-400">
        路由依据：<code className="text-[10px] bg-gray-100 px-1 py-0.5 rounded">action_type === &quot;seo.publish_landing_page&quot;</code>
      </div>
    </div>
  )
}
