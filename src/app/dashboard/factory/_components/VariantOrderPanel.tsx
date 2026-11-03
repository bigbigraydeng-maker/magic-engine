'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface Base {
  id: string
  client_id: string
  client_name: string
  status: string
  angle: string | null
  created_at: string
  template: string | null
  hook_lines: unknown
  video_url: string | null
}

interface MusicChoice {
  id: string
  mood: string
  style: string
  energy: string
}

interface Detail {
  id: string
  client_id: string
  template: string | null
  hook_lines: unknown
  current_music: string | null
  music_choices: MusicChoice[]
  max_hook_chars: number
}

interface HookLine {
  text: string
  badge: string
}

type ChangeMode = 'hook' | 'music'

const STATUS_LABELS: Record<string, string> = {
  in_review: '待审',
  published: '已发布',
  superseded: '已被新版替代',
  review_rejected: '已打回',
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readHookLines(value: unknown): HookLine[] | null {
  if (!Array.isArray(value) || value.length !== 3) return null
  const lines: HookLine[] = []
  for (const item of value) {
    if (!isRecord(item)) return null
    const text = typeof item.text === 'string' ? item.text : ''
    const badge = typeof item.badge === 'string' ? item.badge : ''
    lines.push({ text, badge })
  }
  return lines
}

function isMusicChoice(value: unknown): value is MusicChoice {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.mood === 'string' &&
    typeof value.style === 'string' &&
    typeof value.energy === 'string'
  )
}

function parseBases(json: unknown): Base[] {
  if (!isRecord(json) || !Array.isArray(json.bases)) return []
  return json.bases.filter((item): item is Base => isRecord(item) && typeof item.id === 'string')
}

function parseDetail(json: unknown): Detail | null {
  if (!isRecord(json) || !isRecord(json.base)) return null
  const base = json.base
  if (typeof base.id !== 'string') return null
  const musicChoices = Array.isArray(base.music_choices) ? base.music_choices.filter(isMusicChoice) : []
  return {
    id: base.id,
    client_id: typeof base.client_id === 'string' ? base.client_id : '',
    template: typeof base.template === 'string' ? base.template : null,
    hook_lines: base.hook_lines,
    current_music: typeof base.current_music === 'string' ? base.current_music : null,
    music_choices: musicChoices,
    max_hook_chars: typeof base.max_hook_chars === 'number' ? base.max_hook_chars : 0,
  }
}

function parseOrder(json: unknown): { id: string; status: string; summary: string } | null {
  if (!isRecord(json) || !isRecord(json.order)) return null
  const order = json.order
  if (typeof order.id !== 'string') return null
  return {
    id: order.id,
    status: typeof order.status === 'string' ? order.status : '',
    summary: typeof order.summary === 'string' ? order.summary : '',
  }
}

function readError(json: unknown, fallback: string): string {
  if (isRecord(json) && typeof json.error === 'string') return json.error
  return fallback
}

function hookWidth(line: HookLine): number {
  return line.text.length + (line.badge ? line.badge.length + 1 : 0)
}

interface BaseRowProps {
  base: Base
  selected: boolean
  onSelect: (id: string) => void
}

function BaseRow({ base, selected, onSelect }: BaseRowProps) {
  const title = base.angle ? truncate(base.angle, 60) : '（无标题）'
  return (
    <article
      className={`rounded-lg border p-3 ${selected ? 'border-slate-500 bg-slate-50' : 'border-slate-200'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800">
            {base.client_name} · {title}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {statusLabel(base.status)} · {base.created_at.slice(0, 10)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {base.video_url && (
            <a
              href={base.video_url}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
            >
              看视频
            </a>
          )}
          <button
            onClick={() => onSelect(base.id)}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700"
          >
            用它当底稿
          </button>
        </div>
      </div>
    </article>
  )
}

interface HookEditorProps {
  lines: HookLine[]
  maxChars: number
  onChange: (index: number, next: HookLine) => void
}

function HookEditor({ lines, maxChars, onChange }: HookEditorProps) {
  return (
    <div className="space-y-2">
      {lines.map((line, index) => {
        const width = hookWidth(line)
        const tooWide = width > maxChars
        return (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <input
              value={line.text}
              onChange={(e) => onChange(index, { ...line, text: e.target.value })}
              placeholder={`第 ${index + 1} 行`}
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            />
            <input
              value={line.badge}
              onChange={(e) => onChange(index, { ...line, badge: e.target.value })}
              placeholder="小标签，可空"
              className="w-32 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            />
            <span className={`text-xs ${tooWide ? 'text-red-600' : 'text-slate-500'}`}>
              {width}/{maxChars}
              {tooWide && ' 太长会折行'}
            </span>
          </div>
        )
      })}
    </div>
  )
}

interface MusicPickerProps {
  choices: MusicChoice[]
  currentMusic: string | null
  selected: string
  onSelect: (id: string) => void
}

function MusicPicker({ choices, currentMusic, selected, onSelect }: MusicPickerProps) {
  if (choices.length === 0) {
    return <p className="text-sm text-slate-500">这条视频没有可换的无人声配乐</p>
  }
  return (
    <div className="space-y-2">
      <select
        value={selected}
        onChange={(e) => onSelect(e.target.value)}
        className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
      >
        <option value="">请选择配乐</option>
        {choices.map((c) => (
          <option key={c.id} value={c.id}>
            {c.id} · {c.mood} · {c.style}
          </option>
        ))}
      </select>
      <p className="text-xs text-slate-500">现在用的：{currentMusic || '（未知）'}</p>
    </div>
  )
}

interface OrderFormProps {
  detail: Detail
  onSubmitted: (message: string) => void
}

function OrderForm({ detail, onSubmitted }: OrderFormProps) {
  const initialLines = readHookLines(detail.hook_lines)
  const hookAllowed = detail.template === 'list' && initialLines !== null

  const [mode, setMode] = useState<ChangeMode>(hookAllowed ? 'hook' : 'music')
  const [lines, setLines] = useState<HookLine[]>(
    initialLines ?? [
      { text: '', badge: '' },
      { text: '', badge: '' },
      { text: '', badge: '' },
    ],
  )
  const [musicId, setMusicId] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const updateLine = (index: number, next: HookLine) => {
    setDone(null)
    setLines((prev) => prev.map((line, i) => (i === index ? next : line)))
  }

  const selectMusic = (id: string) => {
    setDone(null)
    setMusicId(id)
  }

  const hookChanged =
    initialLines === null ||
    lines.some(
      (line, i) =>
        line.text.trim() !== initialLines[i].text.trim() || line.badge.trim() !== initialLines[i].badge.trim(),
    )
  const hookValid =
    hookAllowed &&
    hookChanged &&
    lines.every((line) => line.text.trim().length > 0 && hookWidth(line) <= detail.max_hook_chars)
  const musicValid = detail.music_choices.length > 0 && musicId !== ''
  const canSubmit = !submitting && (mode === 'hook' ? hookValid : musicValid)

  const submit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const change =
        mode === 'hook'
          ? { kind: 'hook' as const, lines: lines.map((l) => ({ text: l.text, badge: l.badge })) }
          : { kind: 'music' as const, music_id: musicId }
      const res = await fetch('/api/factory/work-orders/variant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base_work_order_id: detail.id, change, note }),
      })
      const json: unknown = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(readError(json, `下单失败 (${res.status})`))
      const order = parseOrder(json)
      if (!order) throw new Error('下单失败：返回格式异常')
      const message = `已排队，单号 ${order.id.slice(0, 8)}：${order.summary}。出片大约几分钟，好了会出现在上面的待审列表，不会自动发布。`
      onSubmitted(message)
      setDone(message)
      if (initialLines !== null) setLines(initialLines)
      setMusicId('')
      setNote('')
    } catch (e) {
      setError(e instanceof Error ? e.message : '下单失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="radio"
            name="variant-mode"
            value="hook"
            checked={mode === 'hook'}
            disabled={!hookAllowed}
            onChange={() => setMode('hook')}
          />
          改开场文字
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="radio"
            name="variant-mode"
            value="music"
            checked={mode === 'music'}
            onChange={() => setMode('music')}
          />
          换配乐
        </label>
      </div>
      {!hookAllowed && (
        <p className="text-xs text-slate-500">这条不是清单款视频，只能换配乐</p>
      )}

      {mode === 'hook' ? (
        <>
          <HookEditor lines={lines} maxChars={detail.max_hook_chars} onChange={updateLine} />
          {!hookChanged && (
            <p className="text-xs text-slate-500">先改一行字再下单（和底稿一样的不用下）</p>
          )}
        </>
      ) : (
        <MusicPicker
          choices={detail.music_choices}
          currentMusic={detail.current_music}
          selected={musicId}
          onSelect={selectMusic}
        />
      )}

      <textarea
        value={note}
        onChange={(e) => {
          setDone(null)
          setNote(e.target.value.slice(0, 300))
        }}
        maxLength={300}
        placeholder="备注（可空，写这条想测什么）"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        rows={2}
      />

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {done && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{done}</p>}

      <button
        onClick={() => void submit()}
        disabled={!canSubmit}
        className="rounded-lg bg-slate-900 px-4 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {submitting ? '正在下单…' : '下单'}
      </button>
    </div>
  )
}

export function VariantOrderPanel({ clientId }: { clientId: string | null }) {
  const [opened, setOpened] = useState(false)
  const [bases, setBases] = useState<Base[]>([])
  const [loadingBases, setLoadingBases] = useState(false)
  const [basesError, setBasesError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const loadedOnce = useRef(false)
  const latestBaseRequest = useRef<string | null>(null)

  const loadBases = useCallback(async () => {
    setLoadingBases(true)
    setBasesError(null)
    try {
      const url = clientId
        ? `/api/factory/work-orders/variant?client=${encodeURIComponent(clientId)}`
        : '/api/factory/work-orders/variant'
      const res = await fetch(url)
      const json: unknown = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(readError(json, `加载失败 (${res.status})`))
      setBases(parseBases(json).slice(0, 40))
    } catch (e) {
      setBasesError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoadingBases(false)
    }
  }, [clientId])

  useEffect(() => {
    if (!opened) return
    void loadBases()
  }, [opened, loadBases])

  const onToggle = (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    const isOpen = e.currentTarget.open
    setOpened(isOpen)
    if (isOpen && !loadedOnce.current) {
      loadedOnce.current = true
    }
  }

  const selectBase = async (id: string) => {
    latestBaseRequest.current = id
    setSelectedId(id)
    setDetail(null)
    setDetailError(null)
    setSuccess(null)
    setLoadingDetail(true)
    try {
      const res = await fetch(`/api/factory/work-orders/variant?base=${encodeURIComponent(id)}`)
      const json: unknown = await res.json().catch(() => ({}))
      if (latestBaseRequest.current !== id) return
      if (!res.ok) throw new Error(readError(json, `加载失败 (${res.status})`))
      const parsed = parseDetail(json)
      if (!parsed) throw new Error('加载失败：返回格式异常')
      if (latestBaseRequest.current === id) setDetail(parsed)
    } catch (e) {
      if (latestBaseRequest.current === id) {
        setDetailError(e instanceof Error ? e.message : '加载失败')
      }
    } finally {
      if (latestBaseRequest.current === id) setLoadingDetail(false)
    }
  }

  return (
    <details
      className="mt-8 rounded-xl border border-slate-200 bg-white"
      onToggle={onToggle}
    >
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-slate-700">
        下单做一条视频（照已有视频改一样）
      </summary>
      <div className="border-t border-slate-100 p-4 space-y-3">
        <p className="text-xs text-slate-500">
          选一条已出好的视频当底稿，只改一样：开场三行字，或换配乐。做好后出现在上面的待审列表，不会自动发布。
        </p>

        {success && (
          <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{success}</p>
        )}
        {basesError && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{basesError}</p>
        )}
        {loadingBases && <p className="text-sm text-slate-500">加载中…</p>}

        {!loadingBases && bases.length === 0 && !basesError && (
          <p className="text-sm text-slate-500">还没有可以当底稿的视频。</p>
        )}

        {bases.map((base) => (
          <div key={base.id}>
            <BaseRow
              base={base}
              selected={selectedId === base.id}
              onSelect={(id) => void selectBase(id)}
            />
            {/* The form opens right under the chosen row, not after a 40-row list. */}
            {selectedId === base.id && (
              <>
                {loadingDetail && <p className="mt-2 text-sm text-slate-500">加载中…</p>}
                {detailError && (
                  <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{detailError}</p>
                )}
                {detail && (
                  <OrderForm
                    key={detail.id}
                    detail={detail}
                    onSubmitted={(message) => setSuccess(message)}
                  />
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </details>
  )
}
