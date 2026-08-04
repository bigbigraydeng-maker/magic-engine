'use client'

// 单讲工作台 — 一讲从脚本到成片的全部操作都在这一页：
// ① 脚本审 ② 制作方式 ③ 课件预览 ④ 平台 CTA 两版本 ⑤ 成片审 ⑥ 字幕校准 ⑦ 发布(下载+各平台文案)。
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
  changed_at?: string
  section_clips?: Record<string, { url: string; added_at: string }>
}
interface RenderJob {
  id: string
  status: string
  error: string | null
  output_url: string | null
  updated_at: string | null
}
interface CaptionLine {
  start: number
  end: number
  text: string
}
interface PublishedRef {
  platform: 'facebook'
  pageId: string
  videoId: string
  permalink?: string
  draft: boolean
  at: string
}
interface PublishRequest {
  platform: 'facebook'
  status: 'pending' | 'sending' | 'done' | 'failed'
  requestedAt: string
  error?: string
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
  captions: CaptionLine[]
  published: PublishedRef[]
  publishRequest: PublishRequest | null
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

// 存储服务对单次直传的硬上限(超过会在传完那一刻被拒 = 进度条走到 98% 再失败)
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

const PLATFORM_LABEL: Record<string, string> = {
  xiaohongshu: '小红书', douyin: '抖音', facebook: 'FB', tiktok: 'TikTok',
}

/**
 * 上次做片的失败提示还该不该显示：改过制作方式 / 换过录像之后，那条报错就过期了
 * (真实事故:几小时前数字人那次失败的红字，用户改成「自己录」后仍挂在屏幕上)。
 */
function jobErrorStillRelevant(job: RenderJob | null, production: Production | null): boolean {
  if (!job || job.status !== 'failed' || !job.error) return false
  if (job.error.includes('被重做替代')) return false
  const changed = production?.changed_at
  if (changed && job.updated_at && new Date(changed) > new Date(job.updated_at)) return false
  return true
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
  const [linkInput, setLinkInput] = useState('')
  const [clipIdx, setClipIdx] = useState<number | null>(null)   // 正在给哪个要点配录屏
  const [clipLink, setClipLink] = useState('')
  const [capDraft, setCapDraft] = useState<string[] | null>(null)   // 字幕校准草稿
  const [capDirty, setCapDirty] = useState(false)
  const [redoReason, setRedoReason] = useState('')   // 打回重做时可选填的原因

  const base = `/api/clients/${clientId}/content-factory/${postId}`

  const load = useCallback(async () => {
    if (!clientId || !postId) return
    try {
      const r = await fetch(`${base}/lecture`)
      const json = await r.json()
      if (!r.ok) throw new Error(json.error || `HTTP ${r.status}`)
      setData(json)
      setDraft(json.lecture)
      setCapDraft((json.captions ?? []).map((c: CaptionLine) => c.text))
      setCapDirty(false)
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

  // 口播稿导出：一条录到底用的连贯逐字稿——只有要念的词，从头念到尾，
  // 不加任何标记/标题(PM 反馈:标记打断提词阅读)。段落空行 = 自然换气点。
  // 导出的是屏幕上正在编辑的版本——改了没保存也照样导最新的。
  function spokenText(): string {
    if (!draft) return ''
    return [draft.hookSpoken, ...draft.sections.map((s) => s.spoken), draft.ctaSpoken]
      .map((t) => (t ?? '').trim())
      .filter(Boolean)
      .join('\n\n')
  }

  async function copyText(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text)
      setNotice(`${what}已复制 ✅`)
    } catch {
      setError('复制没成功(浏览器不让) — 手动选中文字复制')
    }
  }

  async function copySpoken() {
    try {
      await navigator.clipboard.writeText(spokenText())
      setNotice('口播稿已复制 ✅ 粘到备忘录或提词器里，照着录就行')
    } catch {
      setError('复制没成功(浏览器不让)——点旁边的「下载」拿文件版')
    }
  }

  function downloadSpoken() {
    const blob = new Blob([spokenText()], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${data?.post.lessonNo ? `第${data.post.lessonNo}讲-` : ''}口播稿.txt`
    a.click()
    URL.revokeObjectURL(url)
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
    const ok = await patch(
      { action: 'start_render', redoReason: redoReason.trim() || undefined },
      'render',
      '已开始做片，约 15-30 分钟。做好会出现在下面「成片」区',
    )
    if (ok) setRedoReason('')
  }

  /**
   * 保存字幕并直接重做片 —— 改字幕的唯一目的就是让成片跟着变，
   * 不该让客户再去别的区找「重新做片」(真实事故:PM 改完以为没生效)。
   */
  async function saveCaptionsAndRerender() {
    if (!capDraft) return
    setBusy('captions')
    setError(null)
    try {
      const r = await fetch(`${base}/lecture`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_captions', captions: capDraft }),
      })
      const json = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(json.error || `HTTP ${r.status}`)
      setCapDirty(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(null)
      return
    }
    setBusy(null)
    await patch({ action: 'start_render' }, 'render', '字幕已保存 ✅ 正在用新字幕重做片，约 5-10 分钟')
  }

  async function publishToFacebook() {
    if (!window.confirm('发成草稿？会出现在你的主页后台，公众看不到。确认没问题后再点旁边的「公开发布」。')) return
    await patch({ action: 'publish_facebook' }, 'fb', '已排队 ✅ 后台在发，几分钟后这里会显示结果')
  }

  // 公开发布是不可逆的对外动作,所以单独一个按钮 + 单独一次确认,绝不跟「发草稿」共用一下点击。
  async function publishLive() {
    if (!window.confirm('确定公开发布到 Facebook 主页？\n\n所有人都能看到，发出去就撤不回来了。\n如果主页后台已经有这条草稿，系统会把那条直接转成公开，不会重复发一条。')) return
    await patch({ action: 'publish_facebook', live: true }, 'fbLive', '已排队 ✅ 后台在发，几分钟后这里会显示结果')
  }

  async function applyRecordingLink() {
    if (!linkInput.trim()) return
    if (!(await ensureSaved())) return
    const ok = await patch(
      { action: 'recording_link', link: linkInput.trim() },
      'link',
      '录像链接已接上 ✅ 点「开始做片」，系统自动加课件和字幕',
    )
    if (ok) setLinkInput('')
  }

  async function applySectionClip(index: number) {
    if (!clipLink.trim()) return
    const ok = await patch(
      { action: 'section_clip', index, link: clipLink.trim() },
      `clip-${index}`,
      '录屏已配上 ✅ 讲到这一段时，上半屏会自动换成你的录屏',
    )
    if (ok) { setClipIdx(null); setClipLink('') }
  }

  async function clearSectionClip(index: number) {
    await patch({ action: 'section_clip', index, clear: true }, `clip-${index}`, '已取消这一段的录屏')
  }

  async function uploadRecording(file: File) {
    // 直传有 50MB 硬上限(存储服务的限制)。手机拍的讲课视频普遍上百 MB，
    // 传到 98% 才被拒最气人 —— 超了当场拦住，指去 Dropbox 链接那条路(无上限)。
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(
        `这个视频 ${Math.round(file.size / 1048576)}MB，直接上传最多只能 50MB。` +
        '用下面的「粘 Dropbox 链接」——手机上传到 Dropbox 后复制链接粘进来，多大都行、还不用等。',
      )
      if (fileRef.current) fileRef.current.value = ''
      return
    }
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
        // 413 = 文件超上限(存储服务在收完那一刻才拒，所以是「98% 再失败」)
        const failMsg = (status: number) =>
          status === 413
            ? '这个视频超过 50MB 上限了 — 用下面的「粘 Dropbox 链接」，多大都行、不用等上传'
            : '上传断了 — 重新点一次「上传你录的视频」；反复断就改用下面的 Dropbox 链接'
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(failMsg(xhr.status))))
        xhr.onerror = () => reject(new Error(failMsg(0)))
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
      setNotice(action === 'schedule'
        ? '已通过 ✅ 下面「发布」区拿成片和文案，自己发到各平台'
        : '已打回')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const sectionClip = (i: number) => data?.production?.section_clips?.[String(i)] ?? null

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
  const showJobError = jobErrorStillRelevant(job, data.production)

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
        <div className="flex items-center justify-between gap-2 mb-3">
          <h2 className="font-display font-semibold">① 脚本 · 念的词和课件都在这</h2>
          <div className="flex items-center gap-2">
            <button
              disabled={busy !== null}
              onClick={copySpoken}
              className="text-xs text-me-charcoal border border-me-stone rounded-full px-3 py-1.5 hover:border-me-ochre disabled:opacity-40"
              title="把要念的词复制到剪贴板，粘到备忘录/提词器里照着录"
            >
              复制口播稿
            </button>
            <button
              disabled={busy !== null}
              onClick={downloadSpoken}
              className="text-xs text-me-charcoal border border-me-stone rounded-full px-3 py-1.5 hover:border-me-ochre disabled:opacity-40"
              title="存成文本文件，方便发到手机上"
            >
              下载
            </button>
            <button
              disabled={!dirty || busy !== null}
              onClick={saveScript}
              className="text-xs font-semibold text-white bg-status-track rounded-full px-4 py-1.5 disabled:opacity-40"
            >
              {busy === 'save' ? '保存中…' : dirty ? '保存修改' : '已保存'}
            </button>
          </div>
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
              <div className="flex items-center gap-3">
                <button
                  className="text-[11px] text-me-charcoal hover:underline disabled:opacity-40"
                  disabled={busy !== null}
                  onClick={() => { setClipIdx(clipIdx === i ? null : i); setClipLink('') }}
                >
                  {sectionClip(i) ? '录屏已配 ✓ 换一个' : '＋ 配录屏'}
                </button>
                <button
                  className="text-[11px] text-me-ochre hover:underline disabled:opacity-40"
                  disabled={busy !== null}
                  onClick={() => { setRedoIdx(redoIdx === i ? null : i); setRedoNote('') }}
                >
                  这段不行，重写 ↻
                </button>
              </div>
            </div>
            {clipIdx === i && (
              <div className="bg-me-ivory border border-me-stone rounded-lg p-2 mb-2">
                <div className="text-[11px] text-me-taupe mb-1">
                  粘这一段要配的录屏链接(Dropbox)。讲到这段时上半屏自动换成录屏，讲完自动切回课件；
                  画面会自动裁到操作区放大、并配合这段的长度。
                </div>
                <div className="flex gap-2">
                  <input
                    value={clipLink}
                    onChange={(e) => setClipLink(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void applySectionClip(i) }}
                    placeholder="https://www.dropbox.com/…"
                    className="flex-1 min-w-0 text-xs border border-me-stone rounded-lg px-2 py-1.5"
                  />
                  <button
                    disabled={busy !== null || !clipLink.trim()}
                    onClick={() => applySectionClip(i)}
                    className="flex-none text-xs font-semibold text-white bg-me-ochre rounded-lg px-3 disabled:opacity-40"
                  >
                    {busy === `clip-${i}` ? '检查中…' : '用这个'}
                  </button>
                </div>
                {sectionClip(i) && (
                  <button
                    disabled={busy !== null}
                    onClick={() => clearSectionClip(i)}
                    className="text-[11px] text-status-rej hover:underline mt-1.5 disabled:opacity-40"
                  >
                    取消这一段的录屏
                  </button>
                )}
              </div>
            )}
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
                <div className="text-[11px] font-semibold text-me-taupe mb-1">
                  当前录像
                  {data.production!.recording_url!.includes('dropbox') && '（来自 Dropbox 链接）'}
                </div>
                <video src={data.production!.recording_url} controls playsInline className="w-full max-h-[300px] rounded-lg bg-black" />
                {data.production!.recording_url!.includes('dropbox') && (
                  <div className="text-[10px] text-me-taupe mt-1">
                    Dropbox 链接的视频这里可能放不出来，不影响做片（做片时后台会自己去取）。
                  </div>
                )}
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

            {/* 手机录完直接同步 Dropbox 的，粘链接比再导出上传快 */}
            <div className="mt-3 pt-3 border-t border-me-stone">
              <div className="text-[11px] font-semibold text-me-taupe mb-1">
                或者粘 Dropbox 链接（手机录完自动同步的，直接粘更快）
              </div>
              <div className="flex gap-2">
                <input
                  value={linkInput}
                  onChange={(e) => setLinkInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void applyRecordingLink() }}
                  placeholder="https://www.dropbox.com/…"
                  className="flex-1 min-w-0 text-sm border border-me-stone rounded-lg px-2 py-2"
                />
                <button
                  disabled={busy !== null || !linkInput.trim()}
                  onClick={applyRecordingLink}
                  className="flex-none text-sm font-semibold text-me-charcoal border border-me-stone rounded-lg px-3 hover:border-me-ochre disabled:opacity-40"
                >
                  {busy === 'link' ? '检查中…' : '用这个链接'}
                </button>
              </div>
              <div className="text-[10px] text-me-taupe mt-1">
                在 Dropbox 里对着那条视频「复制链接」即可，权限设成「知道链接的人都能看」。
              </div>
            </div>
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
          {showJobError && <span className="text-xs text-status-rej">{job!.error}</span>}
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

      {/* ⑦ 发布 —— 小红书/抖音没有官方接口，任何工具都做不到全自动，
           所以这里把「下载成片 + 各平台文案」摆到手边，你手动发但零摩擦。 */}
      {data.post.videoUrl && (
        <section className="bg-me-ivory border border-me-stone rounded-2xl p-4 mb-4">
          <h2 className="font-display font-semibold mb-1">⑦ 发布</h2>
          <p className="text-xs text-me-taupe mb-3">
            成片和文案都在这，下载后发到各平台。（小红书和抖音没有官方发布接口，只能手动发；这里帮你把东西备齐。）
          </p>

          <div className="flex flex-wrap items-center gap-2 mb-3">
            <a
              href={data.post.videoUrl}
              download={`${data.post.lessonNo ? `第${data.post.lessonNo}讲` : '成片'}.mp4`}
              className="text-sm font-semibold text-white bg-status-track rounded-xl px-5 py-2.5"
            >
              ⬇ 下载成片
            </a>
            <button
              disabled={busy !== null || data.publishRequest?.status === 'pending' || data.publishRequest?.status === 'sending'}
              onClick={publishToFacebook}
              className="text-sm font-semibold text-me-charcoal border border-me-stone rounded-xl px-4 py-2.5 hover:border-me-ochre disabled:opacity-40"
            >
              {busy === 'fb' ? '排队中…'
                : data.publishRequest?.status === 'pending' ? '已排队，等后台发'
                : data.publishRequest?.status === 'sending' ? '正在发…'
                : '发成草稿'}
            </button>
            <button
              disabled={busy !== null || data.publishRequest?.status === 'pending' || data.publishRequest?.status === 'sending'
                || (data.published ?? []).some((p) => !p.draft)}
              onClick={publishLive}
              className="text-sm font-semibold text-white bg-me-charcoal rounded-xl px-4 py-2.5 hover:bg-me-ochre disabled:opacity-40"
            >
              {busy === 'fbLive' ? '排队中…'
                : (data.published ?? []).some((p) => !p.draft) ? '已公开'
                : '公开发布'}
            </button>
            <span className="text-[11px] text-me-taupe">小红书 / 抖音没有官方接口，下载后手动发</span>
          </div>

          {data.publishRequest?.status === 'failed' && data.publishRequest.error && (
            <div className="text-xs text-status-rej bg-white border border-me-stone rounded-xl px-3 py-2 mb-3">
              上次发布没成功：{data.publishRequest.error}
            </div>
          )}
          {(data.publishRequest?.status === 'pending' || data.publishRequest?.status === 'sending') && (
            <div className="text-xs text-me-ochre bg-white border border-me-stone rounded-xl px-3 py-2 mb-3">
              <span className="animate-pulse">⏳</span> 后台正在发到 Facebook，几分钟后刷新看结果
            </div>
          )}
          {(data.published ?? []).length > 0 && (
            <div className="text-[11px] text-me-taupe mb-3">
              {data.published.map((p, i) => (
                <div key={i}>
                  ✅ {new Date(p.at).toLocaleString('zh-CN')} 发到 Facebook
                  {p.draft ? '（草稿·公众看不到）' : '（已公开）'}
                  {p.permalink && (
                    <a href={p.permalink} target="_blank" rel="noreferrer" className="text-me-ochre underline ml-1">
                      去看看
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-white border border-me-stone rounded-xl p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-semibold text-me-taupe">Facebook / TikTok 文案</span>
                <button
                  onClick={() => copyText(draft.ctaVariants?.fbTiktok ?? '', 'FB/TikTok 文案')}
                  className="text-[11px] text-me-ochre hover:underline"
                >
                  复制
                </button>
              </div>
              <div className="text-xs whitespace-pre-wrap leading-relaxed">
                {draft.ctaVariants?.fbTiktok || '（还没写）'}
              </div>
            </div>

            <div className="bg-white border border-me-stone rounded-xl p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-semibold text-me-taupe">小红书文案</span>
                <button
                  onClick={() => copyText(draft.ctaVariants?.xiaohongshu ?? '', '小红书文案')}
                  className="text-[11px] text-me-ochre hover:underline"
                >
                  复制
                </button>
              </div>
              <div className="text-xs whitespace-pre-wrap leading-relaxed">
                {draft.ctaVariants?.xiaohongshu || '（还没写）'}
              </div>
              {xhsIssues.length === 0 && (
                <div className="text-[10px] text-me-taupe mt-1">✓ 没踩小红书导流红线</div>
              )}
            </div>
          </div>

          <div className="text-[11px] text-me-taupe mt-3">
            发完记得回来点 ⑤ 区的「满意 · 去发布」把这一讲标成已处理，课程列表才看得出进度。
          </div>
        </section>
      )}

      {/* ⑥ 字幕校准 —— 机器听写会有错字，客户在这里改，时间不动 */}
      {(data.captions ?? []).length > 0 && capDraft && (
        <section className="bg-me-ivory border border-me-stone rounded-2xl p-4 mb-4">
          <div className="flex items-center justify-between gap-2 mb-1">
            <h2 className="font-display font-semibold">⑥ 字幕校准</h2>
            <button
              disabled={!capDirty || busy !== null || Boolean(jobActive)}
              onClick={saveCaptionsAndRerender}
              className="text-xs font-semibold text-white bg-status-track rounded-full px-4 py-1.5 disabled:opacity-40"
            >
              {busy === 'captions' ? '保存中…'
                : busy === 'render' ? '排队中…'
                : capDirty ? '保存并重做片' : '已保存'}
            </button>
          </div>
          <p className="text-xs text-me-taupe mb-3">
            这是片子里显示的字幕，按你实际说的话自动听出来的 —— 会有错字（比如把「生意」听成「身影」）。
            对着成片改错字就行，时间不用动。改完点「保存并重做片」，系统会用新字幕重出一条（约 5-10 分钟，比第一次快）。
          </p>
          <div className="max-h-[420px] overflow-y-auto flex flex-col gap-1.5 pr-1">
            {capDraft.map((text, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[10px] text-me-taupe w-12 flex-none tabular-nums">
                  {Math.floor((data.captions[i]?.start ?? 0) / 60)}:
                  {String(Math.floor((data.captions[i]?.start ?? 0) % 60)).padStart(2, '0')}
                </span>
                <input
                  value={text}
                  onChange={(e) => {
                    setCapDraft((d) => (d ? d.map((t, j) => (j === i ? e.target.value : t)) : d))
                    setCapDirty(true)
                  }}
                  className="flex-1 min-w-0 text-sm bg-white border border-me-stone rounded-lg px-2 py-1.5"
                />
              </div>
            ))}
          </div>
        </section>
      )}

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
            <input
              value={redoReason}
              onChange={(e) => setRedoReason(e.target.value)}
              placeholder="哪里不行?一句话就行(可不填) — 同样的问题反复出现，我们会改系统"
              className="w-full text-xs bg-white border border-me-stone rounded-lg px-2 py-1.5 mt-2"
            />
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
