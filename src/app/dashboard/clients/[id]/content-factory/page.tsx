'use client'

// 内容工厂看板（第一期 · 只读）
// 一条 organic 内容从左流到右：选题 → 录制 → 出片 → 发布 → 复盘。
// 数据来自 GET /api/clients/[id]/content-factory/board（读 content_posts 推导分段）。
//
// ⚠️ 待定（问 PM/板桥，未拍板前用内部占位）：
//   - 列名最终叫法（现为内部说法）
//   - 受众（FDE 内部 vs 客户老板）→ 决定卡片露出哪些信息
//   - 卡片信息集
// 建完拉魏征挑逻辑 + 板桥看体验，再上。

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

const STAGES = ['选题', '录制', '出片', '发布', '复盘'] as const
type Stage = (typeof STAGES)[number]

// 每列的一句话职责 + 空列时的引导（空看板最容易让人以为系统没干活 → 给下一步提示，不留白）
const STAGE_META: Record<Stage, { hint: string; empty: string }> = {
  选题: { hint: '爆款改写来的候选，待确认', empty: '还没有候选 — 选题助理抓爆款后会出现在这里' },
  录制: { hint: '已确认，等录制/传素材', empty: '没有待录的 — 确认候选后进这一列' },
  出片: { hint: '素材到位，出片中/已出片', empty: '没有在出片的' },
  发布: { hint: '文案封面就绪，待发/已排期', empty: '没有待发布的' },
  复盘: { hint: '已发布，回收数据', empty: '还没有已发布的内容' },
}

interface Card {
  id: string
  title: string
  status: string
  stage: Stage
  hasVideo: boolean
  platforms: string[]
  scheduledAt: string | null
  publishedAt: string | null
  createdAt: string | null
}

interface BoardData {
  stages: Record<Stage, Card[]>
  counts: Record<Stage, number>
}

const PLATFORM_LABEL: Record<string, string> = {
  xiaohongshu: '小红书', douyin: '抖音', facebook: 'FB', tiktok: 'TikTok',
}

export default function ContentFactoryBoardPage() {
  const params = useParams<{ id: string }>()
  const clientId = params?.id
  const [board, setBoard] = useState<BoardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!clientId) return
    let alive = true
    setLoading(true)
    fetch(`/api/clients/${clientId}/content-factory/board`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`)
        return r.json() as Promise<BoardData>
      })
      .then((d) => { if (alive) { setBoard(d); setError(null) } })
      .catch((e) => { if (alive) setError(e.message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [clientId])

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-baseline gap-3 mb-1">
        <h1 className="text-xl font-bold">内容工厂</h1>
        <span className="text-xs text-slate-500">选题 → 录制 → 出片 → 发布 → 复盘</span>
      </div>
      <p className="text-sm text-slate-500 mb-5">
        一条内容从左流到右。列名/信息为内部占位，待板桥定稿。
      </p>

      {loading && <div className="text-sm text-slate-400 py-10 text-center">加载中…</div>}
      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
          加载失败：{error}
        </div>
      )}

      {board && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {STAGES.map((stage) => {
            const cards = board.stages[stage] ?? []
            return (
              <div key={stage} className="bg-slate-50 border border-slate-200 rounded-xl p-3 min-h-[220px] flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-sm">{stage}</div>
                    <div className="text-[11px] text-slate-400">{STAGE_META[stage].hint}</div>
                  </div>
                  <span className="text-[11px] text-slate-500 bg-white border border-slate-200 rounded-full px-2 tabular-nums">
                    {cards.length}
                  </span>
                </div>

                {cards.length === 0 ? (
                  <div className="text-[11px] text-slate-400 text-center border border-dashed border-slate-200 rounded-lg py-6 px-2 mt-1">
                    {STAGE_META[stage].empty}
                  </div>
                ) : (
                  cards.map((c) => (
                    <div key={c.id} className="bg-white border border-slate-200 rounded-lg p-2.5 shadow-sm">
                      <div className="text-[13px] font-medium leading-snug mb-1.5">{c.title}</div>
                      <div className="flex flex-wrap gap-1">
                        {(c.platforms ?? []).map((p) => (
                          <span key={p} className="text-[10px] bg-slate-100 text-slate-600 rounded px-1.5 py-0.5">
                            {PLATFORM_LABEL[p] ?? p}
                          </span>
                        ))}
                        {c.hasVideo && (
                          <span className="text-[10px] bg-emerald-50 text-emerald-700 rounded px-1.5 py-0.5">有片</span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
