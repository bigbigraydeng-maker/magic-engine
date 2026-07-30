'use client'

// 内容工厂看板（第一期 · 只读 · 客户+FDE 都可看）
// 一条内容从左流到右：选题 → 备料 → 出片 → 发布 → 看表现。
// 数据来自 GET /api/clients/[id]/content-factory/board（读 content_posts 推导分段）。
// 客户安全：不暴露生产手法（不写"抄爆款"、不露"真拍/AI"），只展示进度。

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

const STAGES = ['选题', '备料', '出片', '发布', '看表现'] as const
type Stage = (typeof STAGES)[number]

// 每列一句话职责 + 空列引导（空看板最容易让人以为没在干活 → 每格都给"下一步"，不留白）
const STAGE_META: Record<Stage, { hint: string; empty: string }> = {
  选题: { hint: '待确认的选题方向', empty: '还没有选题 — 有新方向会出现在这里' },
  备料: { hint: '已确认，准备素材中', empty: '没有待备料的 — 选题定了会进这一列' },
  出片: { hint: '素材齐了，正在做片', empty: '还没有在做的片 — 素材齐了会自动进来' },
  发布: { hint: '做好了，等发布 / 已排期', empty: '没有待发布的 — 做好的片会排到这里' },
  看表现: { hint: '已发布，看数据', empty: '还没有发布的内容 — 发出去后来这看表现' },
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

// 状态点颜色（走 ME status 令牌）
function dotClass(status: string): string {
  switch (status) {
    case 'published': return 'bg-status-track'   // 绿 = 已发
    case 'scheduled': return 'bg-status-sched'   // 蓝 = 已排期
    case 'approved':  return 'bg-status-exec'    // 琥珀 = 进行中
    case 'rejected':  return 'bg-status-rej'     // 红 = 打回
    default:          return 'bg-me-taupe'       // 灰 = 等待(draft)
  }
}

function shortDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getMonth() + 1}/${d.getDate()}`
}

// 每列露最相关的日期
function cardDate(c: Card): string {
  if (c.stage === '发布' && c.scheduledAt) return `排期 ${shortDate(c.scheduledAt)}`
  if (c.stage === '看表现' && c.publishedAt) return `发布 ${shortDate(c.publishedAt)}`
  if (c.createdAt) return `建于 ${shortDate(c.createdAt)}`
  return ''
}

export default function ContentFactoryBoardPage() {
  const params = useParams<{ id: string }>()
  const clientId = params?.id
  const [board, setBoard] = useState<BoardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!clientId) { setLoading(false); return }   // 魏征 M4：无 id 不再无限"加载中"
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
    <div className="p-6 max-w-[1400px] mx-auto text-me-charcoal">
      <h1 className="text-xl font-display font-bold">内容工厂</h1>
      <p className="text-sm text-me-taupe mb-5">选题 → 备料 → 出片 → 发布 → 看表现，一条内容从左走到右。</p>

      {loading && <div className="text-sm text-me-taupe py-10 text-center">加载中…</div>}
      {error && (
        <div className="text-sm text-status-rej bg-me-ivory border border-me-stone rounded-2xl p-3">
          加载失败：{error}
        </div>
      )}

      {board && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {STAGES.map((stage) => {
            const cards = board.stages[stage] ?? []
            return (
              <div key={stage} className="bg-me-ivory border border-me-stone rounded-2xl p-3 min-h-[220px] flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-display font-semibold text-sm">{stage}</div>
                    <div className="text-[11px] text-me-taupe">{STAGE_META[stage].hint}</div>
                  </div>
                  <span className="text-[11px] text-me-charcoal bg-white border border-me-stone rounded-full px-2 tabular-nums">
                    {cards.length}
                  </span>
                </div>

                {cards.length === 0 ? (
                  <div className="text-[11px] text-me-taupe text-center border border-dashed border-me-stone rounded-xl py-6 px-2 mt-1">
                    {STAGE_META[stage].empty}
                  </div>
                ) : (
                  cards.map((c) => (
                    <div key={c.id} className="bg-white border border-me-stone rounded-xl p-2.5">
                      <div className="flex items-start gap-1.5 mb-1.5">
                        <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-none ${dotClass(c.status)}`} />
                        <span className="text-[13px] font-medium leading-snug">{c.title}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        {(c.platforms ?? []).map((p) => (
                          <span key={p} className="text-[10px] bg-me-ivory text-me-charcoal border border-me-stone rounded px-1.5 py-0.5">
                            {PLATFORM_LABEL[p] ?? p}
                          </span>
                        ))}
                        {cardDate(c) && (
                          <span className="text-[10px] text-me-taupe ml-auto tabular-nums">{cardDate(c)}</span>
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
