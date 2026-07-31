'use client'

// 内容工厂看板（第一期 · 客户+FDE 都可看）
// 一条内容从左流到右：选题 → 备料 → 出片 → 发布 → 看表现。
// 卡片 = 摘要；点开 → 右侧详情抽屉（完整逐字稿 + 来源 + 确认/打回）。
// 客户安全：不暴露生产手法（不写"抄爆款"、不露"真拍/AI"），只展示进度与内容。

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

const STAGES = ['选题', '备料', '出片', '发布', '看表现'] as const
type Stage = (typeof STAGES)[number]

const STAGE_META: Record<Stage, { hint: string; empty: string }> = {
  选题: { hint: '待确认的选题方向', empty: '还没有选题 — 有新方向会出现在这里' },
  备料: { hint: '已确认 · 做片中（约15-30分钟）', empty: '没有在做的 — 确认选题后会进这一列做片' },
  出片: { hint: '片子做好了 · 待你审', empty: '还没有做好的片 — 做片完成会自动进来' },
  发布: { hint: '做好了，等发布 / 已排期', empty: '没有待发布的 — 做好的片会排到这里' },
  看表现: { hint: '已发布，看数据', empty: '还没有发布的内容 — 发出去后来这看表现' },
}

interface Card {
  id: string
  title: string
  status: string
  stage: Stage
  hasVideo: boolean
  videoUrl: string | null
  platforms: string[]
  scheduledAt: string | null
  publishedAt: string | null
  createdAt: string | null
  hook: string
  script: string
  pillar: string
  visualBrief: string
}

interface BoardData {
  stages: Record<Stage, Card[]>
  counts: Record<Stage, number>
}

const PLATFORM_LABEL: Record<string, string> = {
  xiaohongshu: '小红书', douyin: '抖音', facebook: 'FB', tiktok: 'TikTok',
}

function dotClass(status: string): string {
  switch (status) {
    case 'published': return 'bg-status-track'
    case 'scheduled': return 'bg-status-sched'
    case 'approved':  return 'bg-status-exec'
    case 'rejected':  return 'bg-status-rej'
    default:          return 'bg-me-taupe'
  }
}

function shortDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getMonth() + 1}/${d.getDate()}`
}

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
  const [selected, setSelected] = useState<Card | null>(null)
  const [acting, setActing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!clientId) { setLoading(false); return }
    setLoading(true)
    try {
      const r = await fetch(`/api/clients/${clientId}/content-factory/board`)
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`)
      setBoard(await r.json()); setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { void load() }, [load])

  async function act(action: 'confirm' | 'reject' | 'schedule') {
    if (!selected || !clientId) return
    setActing(true)
    try {
      const r = await fetch(`/api/clients/${clientId}/content-factory/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = (await r.json().catch(() => ({}))) as { error?: string; render?: { error?: string } }
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      setSelected(null)
      setError(null)
      // 给运营一句能安心的反馈（做片要 15-30 分钟，别让人以为丢了）
      if (action === 'confirm') {
        setNotice(data.render?.error
          ? `已确认，但建做片任务失败：${data.render.error}（可再点一次确认重试）`
          : '已确认 · 正在做片，约 15-30 分钟后会出现在「出片」列')
      } else if (action === 'schedule') {
        setNotice('已通过 · 已进「发布」列')
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setActing(false)
    }
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto text-me-charcoal">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-display font-bold">内容工厂</h1>
        {clientId && (
          <Link href={`/dashboard/clients/${clientId}/content-factory/settings`}
            className="text-xs text-me-charcoal border border-me-stone rounded-full px-3 py-1 hover:border-me-ochre">
            ⚙ 进料设置
          </Link>
        )}
      </div>
      <p className="text-sm text-me-taupe mb-5">选题 → 备料 → 出片 → 发布 → 看表现，一条内容从左走到右。点卡片看全文。</p>

      {loading && <div className="text-sm text-me-taupe py-10 text-center">加载中…</div>}
      {error && (
        <div className="text-sm text-status-rej bg-me-ivory border border-me-stone rounded-2xl p-3 mb-3">
          {error}
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 text-sm text-me-charcoal bg-me-ivory border border-me-stone rounded-2xl p-3 mb-3">
          <span className="flex-1">{notice}</span>
          <button className="text-me-taupe text-xs" onClick={() => setNotice(null)}>✕</button>
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
                    <button
                      key={c.id}
                      onClick={() => setSelected(c)}
                      className="text-left bg-white border border-me-stone rounded-xl p-2.5 hover:border-me-ochre transition-colors"
                    >
                      <div className="flex items-start gap-1.5 mb-1">
                        <span className={`mt-1 w-1.5 h-1.5 rounded-full flex-none ${dotClass(c.status)}`} />
                        <span className="text-[13px] font-medium leading-snug">{c.title}</span>
                      </div>
                      {c.status === 'approved' && !c.hasVideo && (
                        <div className="inline-flex items-center gap-1 text-[10px] text-me-ochre bg-me-ivory border border-me-stone rounded px-1.5 py-0.5 mb-1.5">
                          <span className="animate-pulse">⏳</span> 制作中
                        </div>
                      )}
                      {c.hook && <div className="text-[11px] text-me-taupe leading-snug mb-1.5 line-clamp-2">{c.hook}</div>}
                      <div className="flex flex-wrap items-center gap-1">
                        {(c.platforms ?? []).map((p) => (
                          <span key={p} className="text-[10px] bg-me-ivory text-me-charcoal border border-me-stone rounded px-1.5 py-0.5">
                            {PLATFORM_LABEL[p] ?? p}
                          </span>
                        ))}
                        {cardDate(c) && <span className="text-[10px] text-me-taupe ml-auto tabular-nums">{cardDate(c)}</span>}
                      </div>
                    </button>
                  ))
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* 详情抽屉 */}
      {selected && (
        <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
          <button className="absolute inset-0 bg-me-charcoal/30" aria-label="关闭" onClick={() => setSelected(null)} />
          <div className="relative w-full max-w-md h-full bg-white border-l border-me-stone shadow-xl overflow-y-auto p-5">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                {selected.pillar && (
                  <span className="text-[11px] font-semibold text-white bg-me-ochre rounded px-2 py-0.5">{selected.pillar}</span>
                )}
                <span className={`w-2 h-2 rounded-full ${dotClass(selected.status)}`} />
              </div>
              <button className="text-me-taupe text-sm" onClick={() => setSelected(null)}>✕</button>
            </div>

            <h2 className="text-base font-display font-bold leading-snug mb-3">{selected.title}</h2>

            {selected.videoUrl && (
              <div className="mb-3">
                <div className="text-[11px] font-semibold text-me-taupe mb-1">成片</div>
                <video
                  src={selected.videoUrl}
                  controls
                  playsInline
                  className="w-full max-h-[420px] rounded-xl bg-black"
                />
              </div>
            )}

            {selected.hook && (
              <div className="mb-3">
                <div className="text-[11px] font-semibold text-me-taupe mb-1">钩子（前3秒）</div>
                <div className="text-sm">{selected.hook}</div>
              </div>
            )}

            <div className="mb-3">
              <div className="text-[11px] font-semibold text-me-taupe mb-1">完整逐字稿</div>
              <div className="text-sm leading-relaxed whitespace-pre-wrap bg-me-ivory border border-me-stone rounded-xl p-3">
                {selected.script || '（还没有逐字稿）'}
              </div>
            </div>

            {selected.visualBrief && (
              <div className="mb-3">
                <div className="text-[11px] font-semibold text-me-taupe mb-1">画面 / B-roll</div>
                <div className="text-sm">{selected.visualBrief}</div>
              </div>
            )}

            <div className="flex flex-wrap gap-3 text-[11px] text-me-taupe mb-4">
              {(selected.platforms ?? []).map((p) => <span key={p}>{PLATFORM_LABEL[p] ?? p}</span>)}
            </div>

            {/* 选题段：确认 / 打回 */}
            {selected.stage === '选题' && (
              <div className="flex gap-2 sticky bottom-0 bg-white pt-3 border-t border-me-stone">
                <button
                  disabled={acting}
                  onClick={() => act('confirm')}
                  className="flex-1 text-sm font-semibold text-white bg-status-track rounded-xl py-2.5 disabled:opacity-50"
                >
                  {acting ? '处理中…' : '确认做 → 进备料'}
                </button>
                <button
                  disabled={acting}
                  onClick={() => act('reject')}
                  className="text-sm text-status-rej border border-me-stone rounded-xl px-4 disabled:opacity-50"
                >
                  打回
                </button>
              </div>
            )}

            {/* 出片段：满意去发布 / 打回重做 */}
            {selected.stage === '出片' && (
              <div className="flex gap-2 sticky bottom-0 bg-white pt-3 border-t border-me-stone">
                <button
                  disabled={acting}
                  onClick={() => act('schedule')}
                  className="flex-1 text-sm font-semibold text-white bg-status-track rounded-xl py-2.5 disabled:opacity-50"
                >
                  {acting ? '处理中…' : '满意 · 去发布'}
                </button>
                <button
                  disabled={acting}
                  onClick={() => act('reject')}
                  className="text-sm text-status-rej border border-me-stone rounded-xl px-4 disabled:opacity-50"
                >
                  打回重做
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
