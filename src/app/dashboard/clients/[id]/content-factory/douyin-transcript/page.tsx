'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

const DEFAULT_ENVIRONMENT = '面向海外华人，用简体中文口语表达。结合海外生活、创业和经营语境；只有与原视频主题相关时才自然带入，不编造个人经历、结果或数据。'
const SCAN_BUDGET = 'US$0.10'
const TRANSCRIPT_BUDGET = 'US$0.15'

interface VideoItem {
  url: string
  title: string
  author: string
  createdAt: string | null
  durationSeconds: number | null
  likes: number
  comments: number
}

interface TranscriptResult {
  videoUrl: string
  transcript: string
  actualApifyUsd: number | null
  apifyRunId: string
  receipt: string
}

interface RewriteResult {
  videoUrl: string
  title: string
  transcript: string
  draft: { title: string; hook: string; script: string; pillar: string }
  post: { id: string; title: string; status: string }
  actualApifyUsd: number | null
  aiCostUsd: number | null
}

async function postJson(clientId: string, body: Record<string, unknown>) {
  const response = await fetch('/api/clients/' + clientId + '/content-factory/douyin-transcript', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : '请求失败')
  return result
}

function formatDate(value: string | null): string {
  if (!value) return '日期未知'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '日期未知' : date.toLocaleDateString('zh-CN')
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '时长未知'
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0')
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

export default function DouyinTranscriptPage() {
  const params = useParams<{ id: string }>()
  const clientId = params?.id
  const [profileUrl, setProfileUrl] = useState('')
  const [directUrl, setDirectUrl] = useState('')
  const [personaNotes, setPersonaNotes] = useState('')
  const [featureEnabled, setFeatureEnabled] = useState<boolean | null>(null)
  const [selectedUrls, setSelectedUrls] = useState<string[]>([])
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchProgress, setBatchProgress] = useState(0)
  const [batchErrors, setBatchErrors] = useState<string[]>([])
  const [results, setResults] = useState<RewriteResult[]>([])
  const [sourceTranscript, setSourceTranscript] = useState('')
  const [maxVideos, setMaxVideos] = useState(10)
  const [environment, setEnvironment] = useState(DEFAULT_ENVIRONMENT)
  const [environmentReady, setEnvironmentReady] = useState(false)
  const [videos, setVideos] = useState<VideoItem[]>([])
  const [hasScanned, setHasScanned] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [activeUrl, setActiveUrl] = useState<string | null>(null)
  const [actualScanUsd, setActualScanUsd] = useState<number | null>(null)
  const [result, setResult] = useState<RewriteResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!clientId) return
    let cancelled = false
    const saved = window.localStorage.getItem('me-douyin-environment:' + clientId)
    if (saved) setEnvironment(saved)
    const savedPersona = window.localStorage.getItem('me-script-agent-persona:' + clientId)
    if (savedPersona) setPersonaNotes(savedPersona)
    void fetch('/api/clients/' + clientId + '/content-factory/douyin-transcript')
      .then((response) => response.ok ? response.json() : { enabled: false, personaNotes: '' })
      .then((data: { enabled?: boolean; personaNotes?: string }) => {
        if (cancelled) return
        setFeatureEnabled(data.enabled === true)
        if (!savedPersona) setPersonaNotes(data.personaNotes || '')
      })
      .catch(() => { if (!cancelled) setFeatureEnabled(false) })
      .finally(() => { if (!cancelled) setEnvironmentReady(true) })
    return () => { cancelled = true }
  }, [clientId])

  useEffect(() => {
    if (clientId && environmentReady) {
      window.localStorage.setItem('me-douyin-environment:' + clientId, environment)
      window.localStorage.setItem('me-script-agent-persona:' + clientId, personaNotes)
    }
  }, [clientId, environment, personaNotes, environmentReady])

  async function scanAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!clientId) return
    setScanning(true)
    setError(null)
    setVideos([])
    setSelectedUrls([])
    setHasScanned(false)
    setActualScanUsd(null)
    setResult(null)
    setSourceTranscript('')
    try {
      const response = await postJson(clientId, { action: 'scan', profileUrl, maxVideos })
      setVideos(Array.isArray(response.videos) ? response.videos : [])
      setHasScanned(true)
      setActualScanUsd(typeof response.actualApifyUsd === 'number' ? response.actualApifyUsd : null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '账号扫描失败')
    } finally {
      setScanning(false)
    }
  }

  async function transcribeAndRewrite(video: Pick<VideoItem, 'url' | 'title'>) {
    if (!clientId) throw new Error('客户信息缺失')
    setActiveUrl(video.url)
    setResult(null)
    try {
      const cacheKey = 'me-douyin-transcript:' + clientId + ':' + video.url
      let source: TranscriptResult | null = null
      try {
        const cached = window.localStorage.getItem(cacheKey)
        if (cached) source = JSON.parse(cached) as TranscriptResult
      } catch { /* Cache is optional; a corrupt entry is ignored. */ }
      if (!source?.transcript || !source.apifyRunId || !source.receipt) {
        source = await postJson(clientId, { action: 'transcribe', videoUrl: video.url }) as TranscriptResult
        if (!source) throw new Error('转写没有返回逐字稿')
        try { window.localStorage.setItem(cacheKey, JSON.stringify(source)) } catch { /* Browser storage may be full. */ }
      }
      setSourceTranscript(source.transcript)
      const rewritten = await postJson(clientId, {
        action: 'rewrite',
        videoUrl: source.videoUrl,
        apifyRunId: source.apifyRunId,
        receipt: source.receipt,
        title: video.title,
        environment,
        personaNotes,
      }) as RewriteResult
      const response = { ...rewritten, actualApifyUsd: source.actualApifyUsd }
      setResult(response)
      setResults((previous) => [response, ...previous.filter((item) => item.videoUrl !== response.videoUrl)])
    } finally {
      setActiveUrl(null)
    }
  }

  async function runSingle(video: Pick<VideoItem, 'url' | 'title'>) {
    setError(null)
    setResult(null)
    setSourceTranscript('')
    try {
      await transcribeAndRewrite(video)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '逐字稿生成失败')
    }
  }

  async function runSelected() {
    if (!clientId || batchRunning || activeUrl || selectedUrls.length === 0) return
    setBatchRunning(true)
    setBatchProgress(0)
    setBatchErrors([])
    setError(null)
    const failures: string[] = []
    for (const url of selectedUrls) {
      const video = videos.find((item) => item.url === url)
      if (!video) continue
      try {
        await transcribeAndRewrite(video)
      } catch (cause) {
        failures.push(video.title + '：' + (cause instanceof Error ? cause.message : '处理失败'))
        setBatchErrors([...failures])
      }
      setBatchProgress((count) => count + 1)
    }
    setBatchRunning(false)
  }

  async function copyScript() {
    if (!result) return
    await navigator.clipboard.writeText(result.draft.script)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  if (featureEnabled !== true) {
    return (
      <main className="mx-auto max-w-5xl p-6 text-me-charcoal">
        <Link href={'/dashboard/clients/' + clientId + '/content-factory'} className="text-xs text-me-taupe underline">← 返回内容工厂</Link>
        <h1 className="mt-3 font-display text-xl font-bold">脚本 Agent · 抖音逐字稿</h1>
        <p className="mt-3 text-sm text-me-taupe">{featureEnabled === null ? '正在检查服务状态…' : '脚本 Agent 暂未开放，请稍后再试。'}</p>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-5xl p-6 text-me-charcoal">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href={'/dashboard/clients/' + clientId + '/content-factory'} className="text-xs text-me-taupe underline">← 返回内容工厂</Link>
          <h1 className="mt-2 font-display text-xl font-bold">脚本 Agent · 抖音逐字稿</h1>
          <p className="mt-1 text-sm text-me-taupe">贴一条视频或扫描公开账号，提取完整逐字稿，按当前客户人设生成供你亲自录制的中文稿。</p>
        </div>
        <Link href={'/dashboard/clients/' + clientId + '/content-factory'} className="rounded-full border border-me-stone px-3 py-2 text-xs hover:border-me-ochre">查看已保存草稿</Link>
      </div>

      <section className="rounded-2xl border border-me-stone bg-me-ivory p-5">
        <form onSubmit={scanAccount} className="space-y-4">
          <label className="block text-sm font-semibold">
            抖音公开主页链接
            <input
              value={profileUrl}
              onChange={(event) => setProfileUrl(event.target.value)}
              placeholder="https://www.douyin.com/user/MS4w..."
              className="mt-2 w-full rounded-xl border border-me-stone bg-white px-3 py-2 font-normal"
              required
            />
          </label>
          <div className="flex flex-wrap items-end gap-4">
            <label className="text-sm font-semibold">
              最多扫描视频
              <select value={maxVideos} onChange={(event) => setMaxVideos(Number(event.target.value))} className="ml-2 rounded-lg border border-me-stone bg-white px-2 py-2">
                {[5, 10, 20].map((count) => <option key={count} value={count}>{count} 条</option>)}
              </select>
            </label>
            <button disabled={scanning || batchRunning || Boolean(activeUrl) || !clientId} className="rounded-full bg-me-charcoal px-4 py-2 text-sm text-white disabled:opacity-50">
              {scanning ? '正在读取主页…' : '读取账号视频'}
            </button>
            {actualScanUsd !== null && <span className="text-xs text-me-taupe">平台报告用量：{'US$' + actualScanUsd.toFixed(4)}</span>}
          </div>
          <p className="text-xs text-me-taupe">每次账号扫描的 Apify 费用上限为 {SCAN_BUDGET}，每个客户每天最多 3 次；公开视频通常只返回抖音允许匿名访问的近期作品。昵称/抖音号不能代替主页链接。</p>
        </form>
      </section>

      <section className="mt-4 rounded-2xl border border-me-stone bg-white p-5">
        <label className="block text-sm font-semibold">
          单条抖音视频链接或分享文案
          <input value={directUrl} onChange={(event) => setDirectUrl(event.target.value)} placeholder="https://www.douyin.com/video/7699445422015745306" className="mt-2 w-full rounded-xl border border-me-stone px-3 py-2 font-normal" />
        </label>
        <button type="button" disabled={!directUrl || Boolean(activeUrl) || batchRunning} onClick={() => void runSingle({ url: directUrl, title: '抖音参考视频' })} className="mt-3 rounded-full border border-me-charcoal px-4 py-2 text-sm disabled:opacity-50">{activeUrl === directUrl ? '正在生成…' : '直接交给脚本 Agent'}</button>
      </section>

      <section className="mt-4 rounded-2xl border border-me-stone bg-white p-5">
        <label className="block text-sm font-semibold">
          表达环境与目标受众
          <textarea
            value={environment}
            onChange={(event) => setEnvironment(event.target.value)}
            rows={3}
            maxLength={2000}
            className="mt-2 w-full rounded-xl border border-me-stone bg-white px-3 py-2 text-sm font-normal"
          />
        </label>
        <label className="mt-4 block text-sm font-semibold">
          脚本 Agent · 创作者口吻与禁忌
          <textarea value={personaNotes} onChange={(event) => setPersonaNotes(event.target.value)} rows={4} maxLength={3000} className="mt-2 w-full rounded-xl border border-me-stone bg-white px-3 py-2 text-sm font-normal" />
        </label>
        <p className="mt-2 text-xs text-me-taupe">当前人设自动读取此客户启用的 Master Brief；大瑞客户预置真人口播规则，可在此修改。环境、人设与已取得的逐字稿会保存在本机浏览器，改写失败可重试而不重复转写。每个客户每天最多 20 次转写和 20 次 AI 改写；单条逐字稿的 Apify 费用上限为 {TRANSCRIPT_BUDGET}，AI 改写另按模型用量计费。页面所示费用可能滞后于最终账单。</p>
      </section>

      {error && <div role="alert" className="mt-4 rounded-xl border border-status-rej/30 bg-me-ivory p-3 text-sm text-status-rej">{error}</div>}

      {sourceTranscript && !result && <section className="mt-4 rounded-2xl border border-me-stone bg-white p-5"><h2 className="font-semibold">来源逐字稿已取得</h2><button type="button" onClick={() => void navigator.clipboard.writeText(sourceTranscript)} className="mt-2 rounded-full border border-me-stone px-3 py-1 text-xs">复制原稿</button><p className="mt-1 text-xs text-me-taupe">改写失败时原稿保留在本机浏览器；可重新点击同一视频重试改写。</p><pre className="mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap font-sans text-sm leading-7">{sourceTranscript}</pre></section>}
      {videos.length > 0 && (
        <section className="mt-6 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display font-semibold">账号视频（{videos.length} 条）</h2>
            <span className="text-xs text-me-taupe">可勾选多条顺序处理；每条独立计费与保存</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <button type="button" disabled={batchRunning} onClick={() => setSelectedUrls(videos.map((video) => video.url))} className="underline">全选</button>
            <button type="button" disabled={batchRunning} onClick={() => setSelectedUrls([])} className="underline">清空</button>
            <button type="button" disabled={!selectedUrls.length || batchRunning || Boolean(activeUrl)} onClick={() => void runSelected()} className="rounded-full bg-me-charcoal px-4 py-2 text-white disabled:opacity-50">{batchRunning ? `处理中 ${batchProgress}/${selectedUrls.length}` : `批量生成 ${selectedUrls.length} 条草稿`}</button>
            <span className="text-me-taupe">转写费用上限每条 {TRANSCRIPT_BUDGET}；本次最多 US${(selectedUrls.length * 0.15).toFixed(2)}（另计 AI 改写）</span>
          </div>
          {batchErrors.map((message, index) => <p key={index} role="alert" className="text-xs text-status-rej">{message}</p>)}
          {videos.map((video) => (
            <article key={video.url} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-me-stone bg-white p-4">
              <input type="checkbox" aria-label={'选择 ' + video.title} checked={selectedUrls.includes(video.url)} onChange={(event) => setSelectedUrls((current) => event.target.checked ? [...current, video.url] : current.filter((url) => url !== video.url))} disabled={batchRunning} />
              <div className="min-w-[240px] flex-1">
                <a href={video.url} target="_blank" rel="noreferrer" className="font-semibold hover:underline">{video.title}</a>
                <div className="mt-1 text-xs text-me-taupe">
                  {[video.author, formatDate(video.createdAt), formatDuration(video.durationSeconds), '赞 ' + formatCount(video.likes), '评 ' + formatCount(video.comments)].filter(Boolean).join(' · ')}
                </div>
              </div>
              <button
                onClick={() => void runSingle(video)}
                disabled={Boolean(activeUrl) || batchRunning}
                className="rounded-full border border-me-charcoal px-4 py-2 text-xs font-semibold hover:bg-me-charcoal hover:text-white disabled:opacity-50"
              >
                {activeUrl === video.url ? '正在转写并改写…' : '抓逐字稿并生成改写稿'}
              </button>
            </article>
          ))}
        </section>
      )}

      {videos.length === 0 && hasScanned && !scanning && !error && (
        <div className="mt-6 rounded-2xl border border-dashed border-me-stone p-8 text-center text-sm text-me-taupe">没有读取到公开视频。请检查主页链接，或确认账号作品对未登录访客可见。</div>
      )}
      {videos.length === 0 && !hasScanned && !scanning && !error && (
        <div className="mt-6 rounded-2xl border border-dashed border-me-stone p-8 text-center text-sm text-me-taupe">粘贴抖音主页链接后读取视频列表。</div>
      )}

      {results.length > 1 && <section className="mt-5 rounded-2xl border border-me-stone bg-white p-4"><h2 className="font-semibold">本次生成的草稿（{results.length}）</h2><div className="mt-2 flex flex-wrap gap-2">{results.map((item) => <button key={item.videoUrl} type="button" onClick={() => setResult(item)} className="rounded-full border border-me-stone px-3 py-1 text-xs">{item.draft.title}</button>)}</div></section>}
      {result && (
        <section className="mt-6 rounded-2xl border border-me-stone bg-me-ivory p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display font-semibold">改写完成，已保存到草稿</h2>
              <p className="mt-1 text-xs text-me-taupe">源视频：{result.title}{result.actualApifyUsd !== null ? ' · Apify 报告用量 US$' + result.actualApifyUsd.toFixed(4) : ''}{typeof result.aiCostUsd === 'number' ? ' · AI 估算 US$' + result.aiCostUsd.toFixed(4) : ''}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => void copyScript()} className="rounded-full border border-me-stone px-3 py-2 text-xs">{copied ? '已复制' : '复制口播稿'}</button>
              <Link href={'/dashboard/clients/' + clientId + '/content-factory'} className="rounded-full bg-me-charcoal px-3 py-2 text-xs text-white">打开内容工厂</Link>
            </div>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-me-stone bg-white p-4">
              <h3 className="mb-2 text-sm font-semibold">来源逐字稿</h3>
              <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap font-sans text-sm leading-7">{result.transcript}</pre>
            </div>
            <div className="rounded-xl border border-me-stone bg-white p-4">
              <h3 className="text-sm font-semibold">{result.draft.title}</h3>
              <p className="mt-2 border-l-2 border-me-ochre pl-3 text-sm font-semibold">{result.draft.hook}</p>
              <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-7">{result.draft.script}</pre>
            </div>
          </div>
        </section>
      )}
    </main>
  )
}
