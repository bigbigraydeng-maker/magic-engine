'use client'

// 内容工厂 · 进料设置（对话式）
// FDE/客户跟"配置助理"聊天，把选题进料配置(关键词/平台/频率/喜好)聊定。
// 右侧实时显示当前配置。存进 clients.factory_config.topic_intake。

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface IntakeConfig {
  enabled: boolean
  keywords: string[]
  platforms: string[]
  cadence: 'off' | 'weekly' | 'daily'
  scrapePerPlatform: number
  rewriteCount: number
  preferences: string
}
interface Msg { role: 'user' | 'assistant'; content: string }

const PLATFORM_LABEL: Record<string, string> = { xiaohongshu: '小红书', douyin: '抖音' }
const CADENCE_LABEL: Record<string, string> = { off: '先关着', weekly: '每周一次', daily: '每天一次' }

const GREETING =
  '你好，我来帮你把"选题进料"设好——设好之后，系统会照着你的方向，定期从小红书、抖音这些平台找到当下受欢迎的内容风向，帮你产出贴合品牌的选题候选。\n不用一次说全，我们一样样来，随时能回来改。\n先说说：这个品牌主要做什么、想让内容覆盖哪些话题或赛道？'

export default function IntakeSettingsPage() {
  const params = useParams<{ id: string }>()
  const clientId = params?.id
  const [messages, setMessages] = useState<Msg[]>([{ role: 'assistant', content: GREETING }])
  const [config, setConfig] = useState<IntakeConfig | null>(null)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [runNote, setRunNote] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // 重进页面时把已存配置读回来，填满右侧面板（否则面板空白，像没配过）
  useEffect(() => {
    if (!clientId) return
    void fetch(`/api/clients/${clientId}/content-factory/config-chat`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.config) setConfig(d.config as IntakeConfig) })
      .catch(() => {})
  }, [clientId])

  // 现在先跑一次：立刻抓一批 + 改写成候选，让人当场看到效果，不用等定时任务
  async function runNow() {
    if (!clientId || running) return
    setRunning(true)
    setRunNote(null)
    setError(null)
    try {
      const r = await fetch(`/api/clients/${clientId}/content-factory/run-intake`, { method: 'POST' })
      const d = (await r.json().catch(() => ({}))) as { created?: number; scanned?: number; errors?: string[]; error?: string }
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setRunNote(
        (d.created ?? 0) > 0
          ? `已产出 ${d.created} 条新选题，去"内容工厂"看板的"选题"列查看。`
          : `这次没有新选题${d.errors?.length ? `（${d.errors[0]}）` : '（可能没配关键词，或已抓过的没有更新）'}。`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  async function send() {
    const text = input.trim()
    if (!text || sending || !clientId) return
    const history = [...messages, { role: 'user' as const, content: text }]
    setMessages(history)
    setInput('')
    setSending(true)
    setError(null)
    try {
      const r = await fetch(`/api/clients/${clientId}/content-factory/config-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // 首条 assistant 招呼不发给后端（它只是开场白）
        body: JSON.stringify({ history: history.filter((_, i) => i > 0) }),
      })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`)
      const data = (await r.json()) as { reply: string; config: IntakeConfig }
      setMessages((m) => [...m, { role: 'assistant', content: data.reply }])
      setConfig(data.config)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="p-6 max-w-[1100px] mx-auto text-me-charcoal">
      {clientId && (
        <Link
          href={`/dashboard/clients/${clientId}/content-factory`}
          className="inline-flex items-center gap-1 text-xs text-me-taupe hover:text-me-charcoal mb-3"
        >
          ← 返回内容工厂
        </Link>
      )}
      <h1 className="text-xl font-display font-bold">内容工厂 · 进料设置</h1>
      <p className="text-sm text-me-taupe mb-5">跟我聊，把"覆盖什么话题、在哪些平台、多久一次、什么风格"定下来。设好后系统会定期帮你产出贴合品牌的选题候选。</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* 对话 */}
        <div className="md:col-span-2 flex flex-col bg-me-ivory border border-me-stone rounded-2xl h-[520px]">
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'self-end max-w-[80%]' : 'self-start max-w-[85%]'}>
                <div className={
                  m.role === 'user'
                    ? 'bg-me-ochre text-white rounded-2xl rounded-br-sm px-3 py-2 text-sm whitespace-pre-wrap'
                    : 'bg-white border border-me-stone rounded-2xl rounded-bl-sm px-3 py-2 text-sm whitespace-pre-wrap'
                }>
                  {m.content}
                </div>
              </div>
            ))}
            {sending && <div className="self-start text-xs text-me-taupe px-1">配置助理在想…</div>}
            {error && <div className="self-start text-xs text-status-rej">{error}</div>}
            <div ref={endRef} />
          </div>
          <div className="border-t border-me-stone p-2 flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
              placeholder="说说你的生意、想抓的话题、喜好…"
              className="flex-1 bg-white border border-me-stone rounded-xl px-3 py-2 text-sm outline-none focus:border-me-ochre"
              disabled={sending}
            />
            <button
              onClick={() => void send()}
              disabled={sending || !input.trim()}
              className="text-sm font-semibold text-white bg-me-charcoal rounded-xl px-4 disabled:opacity-40"
            >
              发送
            </button>
          </div>
        </div>

        {/* 当前配置 */}
        <div className="bg-white border border-me-stone rounded-2xl p-4 h-fit">
          <div className="font-display font-semibold text-sm mb-3">当前配置</div>
          {!config ? (
            <div className="text-xs text-me-taupe">还没设置 — 跟左边聊几句就会自动填好。</div>
          ) : (
            <div className="flex flex-col gap-3 text-sm">
              <Row label="状态" value={
                (() => {
                  // 频率=先关着 等于没开，避免"已开启 + 先关着"自相矛盾
                  const on = config.enabled && config.cadence !== 'off'
                  return <span className={on ? 'text-status-track' : 'text-me-taupe'}>{on ? '已开启自动进料' : '未开启'}</span>
                })()
              } />
              <Row label="平台" value={(config.platforms ?? []).map((p) => PLATFORM_LABEL[p] ?? p).join(' · ') || '—'} />
              <Row label="频率" value={CADENCE_LABEL[config.cadence] ?? config.cadence} />
              <div>
                <div className="text-[11px] text-me-taupe mb-1">关键词 / 赛道</div>
                <div className="flex flex-wrap gap-1">
                  {(config.keywords ?? []).length
                    ? config.keywords.map((k) => (
                        <span key={k} className="text-[11px] bg-me-ivory border border-me-stone rounded px-1.5 py-0.5">{k}</span>
                      ))
                    : <span className="text-xs text-me-taupe">—</span>}
                </div>
              </div>
              <Row label="每次给几个选题" value={`${config.rewriteCount} 条`} />
              {config.preferences && (
                <div>
                  <div className="text-[11px] text-me-taupe mb-1">喜好 / 风格</div>
                  <div className="text-xs leading-relaxed">{config.preferences}</div>
                </div>
              )}

              {/* 现在先跑一次：当场验证，不用等定时任务 */}
              <div className="border-t border-me-stone pt-3 mt-1">
                <button
                  onClick={() => void runNow()}
                  disabled={running || !(config.keywords ?? []).length}
                  className="w-full text-sm font-semibold text-white bg-me-charcoal rounded-xl py-2.5 disabled:opacity-40"
                >
                  {running ? '正在抓取 + 出选题…' : '现在先跑一次'}
                </button>
                {!(config.keywords ?? []).length && (
                  <div className="text-[11px] text-me-taupe mt-1.5">先聊定关键词，才能跑。</div>
                )}
                {runNote && <div className="text-[11px] text-me-charcoal mt-2 leading-relaxed">{runNote}</div>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-me-taupe">{label}</span>
      <span className="text-sm text-right">{value}</span>
    </div>
  )
}
