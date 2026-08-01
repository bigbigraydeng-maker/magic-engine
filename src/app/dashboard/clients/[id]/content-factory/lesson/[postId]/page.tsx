'use client'

// 单讲工作台 — 一讲从脚本到成片的全部操作都在这一页：
// ① 脚本审(可改) ② 制作方式(自己录 / 数字人) ③ 课件预览 ④ 平台 CTA 两版本 ⑤ 成片审。
// 客户安全：不暴露生产手法，人话文案。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface LectureSection {
  spoken: string
  slideTitle: string
  slidePoints: string[]
}
interface Lecture {
  title: string
  hookSpoken: string
  sections: LectureSection[]
  ctaSpoken: string
  ctaVariants?: { fbTiktok: string; xiaohongshu: string }
}
interface Production {
  method: 'self_record' | 'digital_human'
  recording_url?: string
  recording_uploaded_at?: string
}
interface RenderJob {
  id: string
  status: string
  error: string | null
  output_url: string | null
  updated_at: string | null
}
interface Detail {
  post: {
    id: string
    title: string
    status: string
    platforms: string[]
    videoUrl: string | null
    lessonNo: number | null
    source: string | null
  }
  lecture: Lecture
  production: Production | null
  renderJob: RenderJob | null
  viColors: { primary?: string; secondary?: string; accent?: string } | null
}

// 小红书导流红线词(前端提示用；后端还有一道闸)
const XHS_BANNED = ['私信', '加微', '微信', 'vx', 'wx', 'whatsapp', '扣1', '扣 1', 'dd我', '滴滴我']
function xhsWarnings(text: string): string[] {
  const lower = (text || '').toLowerCase()
  return XHS_BANNED.filter((w) => lower.includes(w.toLowerCase()))
}

const ACTIVE_JOB = ['queued', 'planning', 'rendering', 'assembling']

const PLATFORM_LABEL: Record<string, string> = {
  xiaohongshu: '小红书', douyin: '抖音', facebook: 'FB', tiktok: 'TikTok',
}

/** 做片任务超过 1 小时没动静 = 大概率卡住了，别让用户干等。 */
function jobLooksStuck(job: RenderJob | null): boolean {
  if (!job?.updated_at) return false
  return Date.now() - new Date(job.updated_at).getTime() > 60 * 60 * 1000
}

export default function LectureWorkbenchPage() {
  const params = useParams<{ id: string; postId: string }>()
  const clientId = params?.id
  const postId = params?.postId

  const [data, setData] = useState<Detail | null>(null)
  const [draft, setDraft] = useState<Lecture | null>(null)
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null) // 当前在跑的动作名
  const [redoIdx, setRedoIdx] = useState<number | null>(null)
  const [redoNote, setRedoNote] = useState('')
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const base = `/api/clients/${clientId}/content-factory/${postId}`

  const load = useCallback(async () => {
    if (!clientId || !postId) return
    try {
      const r = await fetch(`${base}/lecture`)
      const json = await r.json()
      if (!r.ok) throw new Error(json.error || `HTTP ${r.status}`)
      setData(json)
      setDraft(json.lecture)
      setDirty(false)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [base, clientId, postId])

  useEffect(() => { void load() }, [load])

  // 做片中每 30 秒刷新一次状态
  const jobActive = data?.renderJob && ACTIVE_JOB.includes(data.renderJob.status)
  useEffect(() => {
    if (!jobActive) return
    const t = setInterval(() => { void load() }, 30000)
    return () => clearInterval(t)
  }, [jobActive, load])

  function edit(update: (l: Lecture) => Lecture) {
    setDraft((d) => (d ? update(d) : d))
    setDirty(true)
  }

  async function patch(body: Record<string, unknown>, doing: string, okMsg?: string) {
    setBusy(doing)
    setError(null)
    try {
      const r = await fetch(`${base}/lecture`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(json.error || `HTTP ${r.status}`)
      if (okMsg) setNotice(okMsg)
      await load()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setBusy(null)
    }
  }

  async function saveScript() {
    if (!draft) return
    await patch({ action: 'save_script', lecture: draft }, 'save', '脚本已保存')
  }

  /**
   * 有没保存的修改时先帮用户存一把(板桥审:换制作方式/重写/上传都会刷新页面数据，
   * 没保存的修改会被静默清掉——用户会以为系统丢了他的字)。存失败就中断动作。
   */
  async function ensureSaved(): Promise<boolean> {
    if (!dirty || !draft) return true
    setBusy('save')
    try {
      const r = await fetch(`${base}/lecture`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_script', lecture: draft }),
      })
      const json = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(json.error || `HTTP ${r.status}`)
      setDirty(false)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setBusy(null)
    }
  }

  async function setMethod(method: 'self_record' | 'digital_human') {
    if (!(await ensureSaved())) return
    await patch({ action: 'set_method', method }, 'method')
  }

  async function redoSection(index: number) {
    if (!(await ensureSaved())) return
    const ok = await patch(
      { action: 'redo_section', index, instruction: redoNote.trim() || undefined },
      `redo-${index}`,
      '这一段已重写，看看新版',
    )
    if (ok) { setRedoIdx(null); setRedoNote('') }
  }

  async function startRender() {
    if (data?.post.videoUrl) {
      const spend = data.production?.method === 'digital_human' ? '用数字人的话会再产生几块钱成本。' : ''
      if (!window.confirm(`确定重做整条？会重新做一条新片(约 15-30 分钟)，做好后替换现在这条。${spend}`)) return
    }
    if (!(await ensureSaved())) return
    await patch({ action: 'start_render' }, 'render', '已开始做片，约 15-30 分钟。做好会出现在下面「成片」区')
  }

  async function uploadRecording(file: File) {
    if (!(await ensureSaved())) return
    setBusy('upload')
    setError(null)
    setUploadPct(0)
    try {
      const r = await fetch(`${base}/lecture`, {
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
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('上传断了 — 重新点一次「上传你录的视频」(大文件建议在 WiFi 下传)')))
        xhr.onerror = () => reject(new Error('上传断了 — 重新点一次「上传你录的视频」(大文件建议在 WiFi 下传)'))
        xhr.send(file)
      })

      const done = await fetch(`${base}/lecture`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'recording_uploaded', path: sign.path }),
      })
      const json = await done.json().catch(() => ({}))
      if (!done.ok) throw new Error(json.error || `HTTP ${done.status}`)
      setNotice('录像已上传 ✅ 点「开始做片」，系统自动加课件和字幕')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
      setUploadPct(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function publishAction(action: 'schedule' | 'reject') {
    setBusy(action)
    setError(null)
    try {
      const r = await fetch(base, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const json = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(json.error || `HTTP ${r.status}`)
      const platformNames = (data?.post.platforms ?? []).map((p) => PLATFORM_LABEL[p] ?? p).join(' / ')
      setNotice(action === 'schedule'
        ? `已通过 ✅ 会按排期自动发到 ${platformNames || '你配置的平台'}，不用你再操作`
        : '已打回')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const vi = data?.viColors
  const slideBg = vi?.primary || '#1A1A2E'
  const slideAccent = vi?.secondary || '#E94560'

  const slides = useMemo(() => {
    if (!draft) return []
    return [
      { title: draft.title, points: ['本讲重点', ...draft.sections.map((s) => s.slideTitle)] },
      ...draft.sections.map((s) => ({ title: s.slideTitle, points: s.slidePoints })),
      { title: '关注看全系列', points: ['主页合集', '下一讲更实操'] },
    ]
  }, [draft])

  const xhsIssues = xhsWarnings(draft?.ctaVariants?.xiaohongshu ?? '') // 正文红线
  const spokenIssues = xhsWarnings(draft?.ctaSpoken ?? '')             // 口播也不能带(同片发小红书)

  if (loading) return <div className="p-6 text-sm text-me-taupe">加载中…</div>
  if (!data || !draft) {
    return (
      <div className="p-6 text-sm text-status-rej">
        {error || '未找到该讲'}
        <div className="mt-3">
          <Link className="text-me-charcoal underline" href={`/dashboard/clients/${clientId}/content-factory`}>← 回内容工厂</Link>
        </div>
      </div>
    )
  }

  const method = data.production?.method
  const hasRecording = Boolean(data.production?.recording_url)
  const job = data.renderJob

  return (
    <div className="p-6 max-w-3xl mx-auto text-me-charcoal">
      <Link href={`/dashboard/clients/${clientId}/content-factory`} className="text-xs text-me-taupe hover:text-me-charcoal">
        ← 内容工厂
      </Link>
      <h1 className="text-xl font-display font-bold mt-1">
        {data.post.lessonNo ? `第${data.post.lessonNo}讲 · ` : ''}
        {draft.title}
      </h1>
      <p className="text-sm text-me-taupe mb-4">{data.post.source?.replace(/^系列课[·:：]?/, '')}</p>

      {error && <div className="text-sm text-status-rej bg-me-ivory border border-me-stone rounded-2xl p-3 mb-3">{error}</div>}
      {notice && (
        <div className="flex items-start gap-2 text-sm bg-me-ivory border border-me-stone rounded-2xl p-3 mb-3">
          <span className="flex-1">{notice}</span>
          <button className="text-me-taupe text-xs" onClick={() => setNotice(null)}>✕</button>
        </div>
      )}

      {/* ① 脚本审 */}
      <section className="bg-me-ivory border border-me-stone rounded-2xl p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display font-semibold">① 脚本 · 念的词和课件都在这</h2>
          <button
            disabled={!dirty || busy !== null}
            onClick={saveScript}
            className="text-xs font-semibold text-white bg-status-track rounded-full px-4 py-1.5 disabled:opacity-40"
          >
            {busy === 'save' ? '保存中…' : dirty ? '保存修改' : '已保存'}
          </button>
        </div>

        <label className="block text-[11px] font-semibold text-me-taupe mb-1">开场钩子(前3秒)</label>
        <textarea
          value={draft.hookSpoken}
          onChange={(e) => edit((l) => ({ ...l, hookSpoken: e.target.value }))}
          rows={2}
          className="w-full text-sm bg-white border border-me-stone rounded-xl p-2.5 mb-3"
        />

        {draft.sections.map((s, i) => (
          <div key={i} className="bg-white border border-me-stone rounded-xl p-3 mb-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] font-semibold text-me-taupe">要点 {i + 1}</div>
              <button
                className="text-[11px] text-me-ochre hover:underline disabled:opacity-40"
                disabled={busy !== null}
                onClick={() => { setRedoIdx(redoIdx === i ? null : i); setRedoNote('') }}
              >
                这段不行，重写 ↻
              </button>
            </div>
            {redoIdx === i && (
              <div className="flex gap-2 mb-2">
                <input
                  value={redoNote}
                  onChange={(e) => setRedoNote(e.target.value)}
                  placeholder="想怎么改?(可留空，如：步骤再具体点)"
                  className="flex-1 text-xs bg-me-ivory border border-me-stone rounded-lg px-2 py-1.5"
                />
                <button
                  disabled={busy !== null}
                  onClick={() => redoSection(i)}
                  className="text-xs font-semibold text-white bg-me-ochre rounded-lg px-3 disabled:opacity-40"
                >
                  {busy === `redo-${i}` ? '重写中…约1分钟，别刷新' : '重写这段'}
                </button>
              </div>
            )}
            <label className="block text-[11px] text-me-taupe mb-1">口播(念这段)</label>
            <textarea
              value={s.spoken}
              onChange={(e) => edit((l) => ({ ...l, sections: l.sections.map((x, j) => (j === i ? { ...x, spoken: e.target.value } : x)) }))}
              rows={3}
              className="w-full text-sm border border-me-stone rounded-lg p-2 mb-2"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-me-taupe mb-1">课件标题</label>
                <input
                  value={s.slideTitle}
                  onChange={(e) => edit((l) => ({ ...l, sections: l.sections.map((x, j) => (j === i ? { ...x, slideTitle: e.target.value } : x)) }))}
                  className="w-full text-sm border border-me-stone rounded-lg p-2"
                />
              </div>
              <div>
                <label className="block text-[11px] text-me-taupe mb-1">课件要点(一行一条)</label>
                <textarea
                  value={s.slidePoints.join('\n')}
                  onChange={(e) => edit((l) => ({
                    ...l,
                    sections: l.sections.map((x, j) => (j === i ? { ...x, slidePoints: e.target.value.split('\n') } : x)),
                  }))}
                  rows={3}
                  className="w-full text-sm border border-me-stone rounded-lg p-2"
                />
              </div>
            </div>
          </div>
        ))}

        <label className="block text-[11px] font-semibold text-me-taupe mb-1">
          结尾口播 CTA(视频里念的 · 只引导关注/合集，别念「私信」——同一条片要发小红书)
        </label>
        <textarea
          value={draft.ctaSpoken}
          onChange={(e) => edit((l) => ({ ...l, ctaSpoken: e.target.value }))}
          rows={2}
          className="w-full text-sm bg-white border border-me-stone rounded-xl p-2.5"
        />
        {spokenIssues.length > 0 && (
          <div className="text-[11px] text-status-rej mt-1">⚠ 口播里有「{spokenIssues.join('、')}」——发小红书会被限流，删掉再保存</div>
        )}
      </section>

      {/* ② 制作方式 */}
      <section className="bg-me-ivory border border-me-stone rounded-2xl p-4 mb-4">
        <h2 className="font-display font-semibold mb-1">② 这条片怎么做</h2>
        <p className="text-xs text-me-taupe mb-3">选好方式后点「开始做片」，系统自动加课件、配字幕、拼成上下分屏成片。</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <button
            disabled={busy !== null}
            onClick={() => setMethod('self_record')}
            className={`text-left border rounded-xl p-3 transition-colors ${method === 'self_record' ? 'border-me-ochre bg-white' : 'border-me-stone bg-white/60 hover:border-me-ochre'}`}
          >
            <div className="text-sm font-semibold mb-1">{method === 'self_record' ? '● ' : '○ '}我自己录</div>
            <div className="text-[11px] text-me-taupe leading-relaxed">
              照着上面的口播词，手机横平竖直录一条(一镜到底就行，念错了停顿两秒重念那句)。
              上传后系统自动切段、配课件和字幕。
            </div>
          </button>
          <button
            disabled={busy !== null}
            onClick={() => setMethod('digital_human')}
            className={`text-left border rounded-xl p-3 transition-colors ${method === 'digital_human' ? 'border-me-ochre bg-white' : 'border-me-stone bg-white/60 hover:border-me-ochre'}`}
          >
            <div className="text-sm font-semibold mb-1">{method === 'digital_human' ? '● ' : '○ '}用数字人</div>
            <div className="text-[11px] text-me-taupe leading-relaxed">
              不用出镜，系统用你的克隆声音和形象自动生成口播。每生成一条有几块钱(纽币)成本。
            </div>
          </button>
        </div>

        {method === 'self_record' && (
          <div className="bg-white border border-me-stone rounded-xl p-3 mb-3">
            {hasRecording && (
              <div className="mb-2">
                <div className="text-[11px] font-semibold text-me-taupe mb-1">已上传的录像</div>
                <video src={data.production!.recording_url} controls playsInline className="w-full max-h-[300px] rounded-lg bg-black" />
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm,video/x-m4v"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadRecording(f) }}
            />
            <button
              disabled={busy !== null}
              onClick={() => fileRef.current?.click()}
              className="text-sm font-semibold text-me-charcoal border border-me-stone rounded-xl px-4 py-2 hover:border-me-ochre disabled:opacity-40"
            >
              {busy === 'upload'
                ? `上传中… ${uploadPct ?? 0}%`
                : hasRecording ? '重新上传录像' : '上传你录的视频'}
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            disabled={busy !== null || Boolean(jobActive) || !method || (method === 'self_record' && !hasRecording)}
            onClick={startRender}
            className="text-sm font-semibold text-white bg-status-track rounded-xl px-5 py-2.5 disabled:opacity-40"
          >
            {busy === 'render' ? '排队中…' : data.post.videoUrl ? '重新做片' : '开始做片'}
          </button>
          {dirty && !jobActive && <span className="text-xs text-me-taupe">会先自动保存你在 ① 改的脚本</span>}
          {jobActive && !jobLooksStuck(job) && (
            <span className="text-xs text-me-ochre"><span className="animate-pulse">⏳</span> 做片中，约 15-30 分钟，这页会自动刷新</span>
          )}
          {jobActive && jobLooksStuck(job) && (
            <span className="text-xs text-status-rej">等太久了？可能卡住了 — 直接联系我们，或等它自动失败后点「重新做片」</span>
          )}
          {job?.status === 'failed' && job.error && !job.error.includes('被重做替代') && (
            <span className="text-xs text-status-rej">{job.error}</span>
          )}
        </div>
      </section>

      {/* ③ 课件预览 */}
      <section className="bg-me-ivory border border-me-stone rounded-2xl p-4 mb-4">
        <h2 className="font-display font-semibold mb-1">③ 课件预览</h2>
        <p className="text-xs text-me-taupe mb-3">成片上半屏就是这些页，讲到哪页自动翻到哪页。想改字直接在 ① 里改。</p>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {slides.map((s, i) => (
            <div
              key={i}
              className="flex-none w-44 aspect-[9/8] rounded-xl p-3 flex flex-col"
              style={{ backgroundColor: slideBg, color: '#fff' }}
            >
              <div className="w-8 h-1 rounded mb-2" style={{ backgroundColor: slideAccent }} />
              <div className="text-[13px] font-bold leading-snug mb-2">{s.title}</div>
              <ul className="text-[10px] leading-relaxed opacity-90">
                {s.points.filter((p) => p.trim()).slice(0, 4).map((p, j) => (
                  <li key={j} className="flex gap-1.5">
                    <span style={{ color: slideAccent }}>●</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-auto text-[9px]" style={{ color: slideAccent }}>
                {i === 0 ? '封面' : i === slides.length - 1 ? '结尾' : `要点 ${i}`}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ④ 平台 CTA 两版本 */}
      <section className="bg-me-ivory border border-me-stone rounded-2xl p-4 mb-4">
        <h2 className="font-display font-semibold mb-1">④ 发布文案 CTA · 按平台两版本</h2>
        <p className="text-xs text-me-taupe mb-3">同一条片，发不同平台用不同的行动号召。发布时各平台自动带各自版本。</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="bg-white border border-me-stone rounded-xl p-3">
            <div className="text-[11px] font-semibold text-me-taupe mb-1">Facebook / TikTok 版(可引导私信)</div>
            <textarea
              value={draft.ctaVariants?.fbTiktok ?? ''}
              onChange={(e) => edit((l) => ({ ...l, ctaVariants: { fbTiktok: e.target.value, xiaohongshu: l.ctaVariants?.xiaohongshu ?? '' } }))}
              rows={3}
              className="w-full text-sm border border-me-stone rounded-lg p-2"
              placeholder="留言【关键词】，我私信发你…"
            />
          </div>
          <div className="bg-white border border-me-stone rounded-xl p-3">
            <div className="text-[11px] font-semibold text-me-taupe mb-1">小红书版(只能引导关注+主页合集)</div>
            <textarea
              value={draft.ctaVariants?.xiaohongshu ?? ''}
              onChange={(e) => edit((l) => ({ ...l, ctaVariants: { fbTiktok: l.ctaVariants?.fbTiktok ?? '', xiaohongshu: e.target.value } }))}
              rows={3}
              className="w-full text-sm border border-me-stone rounded-lg p-2"
              placeholder="关注我，主页合集看全系列…"
            />
            {xhsIssues.length > 0 ? (
              <div className="text-[11px] text-status-rej mt-1">⚠ 出现「{xhsIssues.join('、')}」——小红书引导私信会被限流，必须删掉</div>
            ) : (
              <div className="text-[11px] text-me-taupe mt-1">✓ 没踩小红书红线</div>
            )}
          </div>
        </div>
      </section>

      {/* ⑤ 成片审 */}
      <section className="bg-me-ivory border border-me-stone rounded-2xl p-4 mb-8">
        <h2 className="font-display font-semibold mb-1">⑤ 成片</h2>
        {data.post.videoUrl ? (
          <>
            {jobActive && (
              <div className="text-xs text-me-ochre bg-white border border-me-stone rounded-xl px-3 py-2 mt-2">
                ⏳ 新片制作中 — 下面这条是旧成片，做好后会自动替换
              </div>
            )}
            <video src={data.post.videoUrl} controls playsInline className="w-full max-h-[480px] rounded-xl bg-black my-2" />
            <div className="flex gap-2">
              <button
                disabled={busy !== null || Boolean(jobActive) || data.post.status === 'scheduled' || data.post.status === 'published'}
                onClick={() => publishAction('schedule')}
                className="flex-1 text-sm font-semibold text-white bg-status-track rounded-xl py-2.5 disabled:opacity-40"
              >
                {data.post.status === 'scheduled' ? '已进发布' : data.post.status === 'published' ? '已发布' : busy === 'schedule' ? '处理中…' : '满意 · 去发布'}
              </button>
              <button
                disabled={busy !== null || Boolean(jobActive)}
                onClick={startRender}
                className="text-sm text-me-charcoal border border-me-stone rounded-xl px-4 hover:border-me-ochre disabled:opacity-40"
              >
                打回重做(整条)
              </button>
            </div>
            <p className="text-[11px] text-me-taupe mt-2">哪段词不行 → 回 ① 改词或「重写这段」，保存后再点「重新做片」。</p>
          </>
        ) : (
          <p className="text-sm text-me-taupe py-4 text-center">
            {jobActive ? '做片中… 做好了成片会出现在这里' : '还没有成片 — 在 ② 里选好方式，点「开始做片」'}
          </p>
        )}
      </section>
    </div>
  )
}
