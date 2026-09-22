'use client'

// 内容工厂看板（第一期 · 客户+FDE 都可看）
// 一条内容从左流到右：选题 → 备料 → 出片 → 发布 → 看表现。
// 卡片 = 摘要；点开 → 右侧详情抽屉（完整逐字稿 + 来源 + 确认/打回）。
// 客户安全：不暴露生产手法（不写"抄爆款"、不露"真拍/AI"），只展示进度与内容。

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

const STAGES = ['选题', '备料', '出片', '发布', '看表现'] as const
type Stage = (typeof STAGES)[number]

// 直传硬上限（存储服务的限制）。超了当场拦住，指去粘链接那条路 —— 别让人传到 98% 才被拒。
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

const STAGE_META: Record<Stage, { hint: string; empty: string }> = {
  选题: { hint: '待确认的选题方向', empty: '还没有选题 — 有新方向会出现在这里' },
  备料: { hint: '已确认 · 做片中或等你录', empty: '没有在做的 — 确认选题后会进这一列' },
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
  mode?: string          // '讲课式' 等制作形态
  rendering?: boolean    // 流水线正在给这条做片 —— 做片中不给挂片入口
}

interface Lesson extends Card {
  lessonNo: number
  renderFailed?: boolean
}
interface Course {
  name: string
  source: string
  lessons: Lesson[]
}

interface BoardData {
  stages: Record<Stage, Card[]>
  counts: Record<Stage, number>
  courses?: Course[]
  /** 客户配置了哪些「资料包」（团/档位），供确认做片时选归属。0-1 个不用选
   *  （见 post-fields.ts::resolveOfferFacts 的兜底规则），≥2 个必须选一个。 */
  offerKeys?: string[]
}

// 单讲在流程里的人话状态(比看板段更细)
function lessonStatus(l: Card & { renderFailed?: boolean }): { label: string; cls: string } {
  if (l.status === 'published') return { label: '已发布', cls: 'text-status-track' }
  if (l.status === 'scheduled') return { label: '待发布', cls: 'text-status-sched' }
  if (l.hasVideo) return { label: '成片待审', cls: 'text-status-exec' }
  if (l.status === 'approved') {
    return l.renderFailed
      ? { label: '做片失败', cls: 'text-status-rej' }
      : { label: '做片中', cls: 'text-me-ochre' }
  }
  if (l.status === 'rejected') return { label: '已打回', cls: 'text-status-rej' }
  return { label: '脚本待审', cls: 'text-me-taupe' }
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
  const [selected, setSelectedRaw] = useState<Card | null>(null)
  const [acting, setActing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const [videoLink, setVideoLink] = useState('')
  const [offerKey, setOfferKey] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // 换卡片/关抽屉一律把链接输入框和归属选择清空 —— 在 A 里选了归属不提交就关掉，
  // 再打开 B 时选择还留着 A 的，点确认就把错的归属存到 B 上了（跟 videoLink 同一个教训）。
  const setSelected = useCallback((c: Card | null) => {
    setSelectedRaw(c)
    setVideoLink('')
    setOfferKey('')
  }, [])

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
        body: JSON.stringify(
          action === 'confirm' && offerKey ? { action, offer_key: offerKey } : { action },
        ),
      })
      const data = (await r.json().catch(() => ({}))) as {
        error?: string
        render?: { error?: string }
        publish?: { publerJobId: string }
      }
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      setSelected(null)
      setError(null)
      // 给运营一句能安心的反馈（做片要 15-30 分钟，别让人以为丢了）
      if (action === 'confirm') {
        if (data.publish) {
          // LinkedIn 进度贴没有做片环节，"确认"这一步已经是真的发布了——
          // 不能走下面视频那套"正在做片"的话术，那是假消息。
          setNotice('已确认 · 已经发布，不需要做片')
        } else {
          // data.render.error 现在是常态(旧拼片管线已退役)，不是偶发失败——不能再提示
          // "再点一次确认重试"：这张卡片的状态已经改成 approved，进了「备料」列，选题段的
          // 确认按钮不会再出现，重试没有入口。真正能做的是去「备料」列手动传成片/粘视频链接。
          setNotice(data.render?.error
            ? '已确认 · 已进「备料」列，旧自动做片管线已退役，请在「备料」列打开这张卡片手动传成片或粘视频链接'
            : '已确认 · 正在做片，约 15-30 分钟后会出现在「出片」列')
        }
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

  /** 自己录/自己剪的片挂上去 —— 挂完卡片就从「备料」走到「出片」。 */
  async function attachVideo(payload: { action: 'link'; link: string } | { action: 'clear' }) {
    if (!selected || !clientId) return
    setActing(true)
    try {
      const r = await fetch(`/api/clients/${clientId}/content-factory/${selected.id}/video`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      setSelected(null)
      setVideoLink('')
      setError(null)
      setNotice(payload.action === 'clear' ? '已撤掉这条片' : '成片已挂上 ✅ 卡片进「出片」列，审完就能去发布')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setActing(false)
    }
  }

  async function uploadVideo(file: File) {
    if (!selected || !clientId) return
    // 超上限当场拦住，别让人传到 98% 才被存储服务拒掉
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(
        `这个视频 ${Math.round(file.size / 1048576)}MB，直接上传最多只能 50MB。` +
        '用下面的「粘视频链接」——先传到 Dropbox 再复制链接粘进来，多大都行。',
      )
      if (fileRef.current) fileRef.current.value = ''
      return
    }
    setActing(true)
    setError(null)
    setUploadPct(0)
    const base = `/api/clients/${clientId}/content-factory/${selected.id}/video`
    try {
      const r = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name }),
      })
      const sign = await r.json()
      if (!r.ok) throw new Error(sign.error || `HTTP ${r.status}`)

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('PUT', sign.signedUrl)
        xhr.setRequestHeader('Content-Type', file.type || 'video/mp4')
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) setUploadPct(Math.round((ev.loaded / ev.total) * 100))
        }
        const failMsg = (status: number) =>
          status === 413
            ? '这个视频超过 50MB 上限了 — 用下面的「粘视频链接」，多大都行'
            : '上传断了 — 重新点一次；反复断就改用下面的视频链接'
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(failMsg(xhr.status)))
        xhr.onerror = () => reject(new Error(failMsg(0)))
        xhr.send(file)
      })

      const done = await fetch(base, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'uploaded', path: sign.path }),
      })
      const json = await done.json().catch(() => ({}))
      if (!done.ok) throw new Error(json.error || `HTTP ${done.status}`)
      setSelected(null)
      setNotice('成片已挂上 ✅ 卡片进「出片」列，审完就能去发布')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setActing(false)
      setUploadPct(null)
      if (fileRef.current) fileRef.current.value = ''
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

      {/* 课程区：成系列的内容收在一起，逐讲流转 */}
      {board?.courses && board.courses.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-display font-bold">课程 · 成系列的内容</h2>
          <p className="text-sm text-me-taupe mb-4">整套课收在一起，逐讲审脚本 → 出片 → 发布。点每讲进工作台。</p>
          <div className="flex flex-col gap-4">
            {board.courses.map((course) => {
              const done = course.lessons.filter((l) => l.status === 'published').length
              return (
                <div key={course.source} className="bg-me-ivory border border-me-stone rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="font-display font-semibold">{course.name}</div>
                    <span className="text-[11px] text-me-taupe tabular-nums">{course.lessons.length} 讲 · 已发 {done}</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {course.lessons.map((l) => {
                      const st = lessonStatus(l)
                      return (
                        <Link
                          key={l.id}
                          href={`/dashboard/clients/${clientId}/content-factory/lesson/${l.id}`}
                          className="text-left bg-white border border-me-stone rounded-xl px-3 py-2.5 hover:border-me-ochre transition-colors flex items-center gap-3"
                        >
                          <span className="text-[11px] font-semibold text-me-taupe w-12 flex-none tabular-nums">第{l.lessonNo}讲</span>
                          <span className="flex-1 text-[13px] font-medium leading-snug">{l.title.replace(/^【系列课·第\d+讲】/, '')}</span>
                          {l.mode && <span className="text-[10px] text-me-charcoal bg-me-ivory border border-me-stone rounded px-1.5 py-0.5 flex-none">{l.mode}</span>}
                          <span className="hidden sm:flex flex-none items-center gap-1">
                            {(l.platforms ?? []).slice(0, 3).map((p) => (
                              <span key={p} className="text-[10px] text-me-taupe">{PLATFORM_LABEL[p] ?? p}</span>
                            ))}
                          </span>
                          <span className={`text-[11px] font-semibold flex-none w-16 text-right ${st.cls}`}>{st.label}</span>
                        </Link>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
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

            {/* 选题段：确认 / 打回。配了 ≥2 份资料包（团/档位）时必须先选这条视频
                对应哪一份，不然出片会因为系统不敢乱猜而被拦下（见 post-fields.ts
                ::resolveOfferFacts）——只配 0-1 份时不用选，不显示这个下拉框。 */}
            {selected.stage === '选题' && (
              <div className="sticky bottom-0 bg-white pt-3 border-t border-me-stone">
                {(board?.offerKeys?.length ?? 0) >= 2 && (
                  <div className="mb-2">
                    <label className="text-[11px] font-semibold text-me-taupe mb-1 block">
                      这条视频对应哪份资料（团/档位）
                    </label>
                    <select
                      value={offerKey}
                      onChange={(e) => setOfferKey(e.target.value)}
                      className="w-full text-sm border border-me-stone rounded-xl px-3 py-2"
                    >
                      <option value="">先选一个…</option>
                      {board?.offerKeys?.map((k) => (
                        <option key={k} value={k}>{k}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    disabled={acting || ((board?.offerKeys?.length ?? 0) >= 2 && !offerKey)}
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
              </div>
            )}

            {/* 备料段 · 非讲课式：片子是人自己录/自己剪的，从这里挂上去。
                讲课式不显示 —— 它的成片由系统做，手动挂会盖掉做片结果。 */}
            {selected.stage === '备料' && selected.mode !== '讲课式' && !selected.rendering && (
              <div className="sticky bottom-0 bg-white pt-3 border-t border-me-stone">
                <div className="text-[11px] font-semibold text-me-taupe mb-2">
                  录好了？把成片挂上来 — 挂完这条就进「出片」列
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="video/mp4,video/quicktime,video/x-m4v,video/webm"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void uploadVideo(f)
                  }}
                />
                <button
                  disabled={acting}
                  onClick={() => fileRef.current?.click()}
                  className="w-full text-sm font-semibold text-white bg-status-track rounded-xl py-2.5 disabled:opacity-50"
                >
                  {uploadPct !== null ? `上传中 ${uploadPct}%` : acting ? '处理中…' : '⬆ 传成片（50MB 以内）'}
                </button>

                <div className="flex gap-2 mt-2">
                  <input
                    value={videoLink}
                    onChange={(e) => setVideoLink(e.target.value)}
                    placeholder="或粘视频链接（Dropbox 等，多大都行）"
                    className="flex-1 text-sm border border-me-stone rounded-xl px-3 py-2"
                  />
                  <button
                    disabled={acting || !videoLink.trim()}
                    onClick={() => void attachVideo({ action: 'link', link: videoLink })}
                    className="text-sm border border-me-stone rounded-xl px-4 disabled:opacity-50"
                  >
                    确定
                  </button>
                </div>
                <div className="text-[11px] text-me-taupe mt-2">
                  链接要设成「知道链接的人都能看」，粘之前对着视频本身复制链接。
                </div>
              </div>
            )}

            {selected.stage === '备料' && selected.mode !== '讲课式' && selected.rendering && (
              <div className="sticky bottom-0 bg-white pt-3 border-t border-me-stone text-[11px] text-me-taupe">
                这条正在自动做片，做好会进「出片」列。要改用自己录的片，先「打回重做」再来挂。
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
                {/* 自己挂的片传错了要能撤 —— 系统做的片不给撤，那条走「打回重做」 */}
                {selected.mode !== '讲课式' && (
                  <button
                    disabled={acting}
                    onClick={() => void attachVideo({ action: 'clear' })}
                    className="text-sm text-me-taupe border border-me-stone rounded-xl px-3 disabled:opacity-50"
                    title="撤掉这条片，回到「备料」重新挂"
                  >
                    换一条
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
