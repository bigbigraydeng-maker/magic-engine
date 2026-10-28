'use client'

/**
 * 抽屉里的「选模板 → 预览 → 改 → 发」面板。
 * 预览和真发送走同一批服务端判断（template-preview / compose），所以面板上看到的和点发送那一刻一致。
 * 预览请求带单调递增的计数器，晚到的旧响应直接丢掉。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PostCallTemplateSummary } from '@/lib/crm/email-templates/post-call-state'
import type { PreviewFrequency, PreviewResult } from '@/lib/crm/email-templates/template-preview'
import type { PickOption } from '@/lib/crm/email-templates/facts/types'
import type { CallBasis } from '@/lib/crm/email-templates/types'
import type { ComposePreview } from '@/lib/microsoft/mail-send-new'

export interface TemplateEmailPanelProps {
  clientId: string
  contactId: string
  templates: PostCallTemplateSummary[]
  initialCallBasis: CallBasis
  onClose: () => void
  onSent: () => void
}

type PreviewOk = Extract<PreviewResult, { ok: true }> & { send: ComposePreview }

interface PickedItem {
  tourId: string
  departOn: string | null
}

interface OldDraft {
  subject: string
  body: string
}

const PICK_MODE_LABEL: Record<PostCallTemplateSummary['pickMode'], string> = {
  none: '不选团',
  one: '选一个团',
  many: '选多个团',
}

const SOURCE_LABEL: Record<string, string> = {
  sent_items: '邮箱已发送',
  audit: '系统发送记录',
  touchpoint: '邮件记录',
  mailchimp: '群发',
}

const MAX_PICKS = 3

const OUTDATED_REASONS = new Set([
  'template_outdated',
  'catalog_outdated',
  'template_unavailable',
  'tour_unavailable',
  'invalid_pick',
])

function newRequestId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : '00000000-0000-4000-8000-' + Math.random().toString(16).slice(2, 14).padEnd(12, '0')
}

function formatWhen(iso: string | null): string {
  if (iso === null) return '稍后'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '稍后'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Pacific/Auckland',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
}

export function TemplateEmailPanel(props: TemplateEmailPanelProps): JSX.Element {
  const { clientId, contactId, templates, initialCallBasis, onClose, onSent } = props

  const [preview, setPreview] = useState<PreviewOk | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [picks, setPicks] = useState<PickedItem[]>([])
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [edited, setEdited] = useState(false)
  const markEdited = useCallback((value: boolean): void => {
    editedRef.current = value
    setEdited(value)
  }, [])
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [outdatedNotice, setOutdatedNotice] = useState(false)
  const [oldDraft, setOldDraft] = useState<OldDraft | null>(null)

  const requestId = useRef(newRequestId())
  // The text is only overwritten by a fresh render while the staff member has not edited it. A ref (not just state)
  // because the async preview callback must see the value set a moment before it runs.
  const editedRef = useRef(false)
  const previewSeq = useRef(0)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (closeTimer.current !== null) clearTimeout(closeTimer.current)
    }
  }, [])

  const runPreview = useCallback(
    async (args: {
      key: string
      picks: PickedItem[]
      inputs: Record<string, string>
      callBasis: CallBasis
      subject?: string
      body?: string
    }): Promise<void> => {
      previewSeq.current += 1
      const seq = previewSeq.current
      setLoading(true)
      setPreviewError(null)
      try {
        const res = await fetch(`/api/clients/${clientId}/crm/contacts/${contactId}/email/template-preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key: args.key,
            picks: args.picks,
            inputs: args.inputs,
            callBasis: args.callBasis,
            ...(args.subject !== undefined ? { subject: args.subject } : {}),
            ...(args.body !== undefined ? { body: args.body } : {}),
          }),
        })
        const json = (await res.json().catch(() => ({}))) as PreviewOk | { error?: string; reason?: string }
        if (seq !== previewSeq.current) return
        if (!res.ok || !('ok' in json) || json.ok !== true) {
          const err = 'error' in json && typeof json.error === 'string' ? json.error : '预览失败，请稍后再试'
          const reason = 'reason' in json ? json.reason : undefined
          setPreviewError(reason === 'feature_off' ? '邮件功能还没开通或设置无效。' : err)
          return
        }
        setPreview(json)
        if (!editedRef.current) {
          setSubject(json.rendered.subject)
          setBody(json.rendered.body)
        }
      } catch {
        if (seq !== previewSeq.current) return
        setPreviewError('网络出错，预览没拿到。请稍后再试。')
      } finally {
        if (seq === previewSeq.current) setLoading(false)
      }
    },
    [clientId, contactId],
  )

  const startTemplate = (t: PostCallTemplateSummary): void => {
    setPreview(null)
    setPreviewError(null)
    setPicks([])
    setInputs({})
    setSubject('')
    setBody('')
    markEdited(false)
    setSendError(null)
    setOutdatedNotice(false)
    setOldDraft(null)
    void runPreview({ key: t.key, picks: [], inputs: {}, callBasis: initialCallBasis })
  }

  const changePicks = (next: PickedItem[]): void => {
    if (preview === null) return
    setPicks(next)
    void runPreview({ key: preview.template.key, picks: next, inputs, callBasis: preview.callBasis })
  }

  const changeInput = (name: string, value: string): void => {
    setInputs((prev) => ({ ...prev, [name]: value }))
  }

  const commitInput = (): void => {
    if (preview === null) return
    void runPreview({ key: preview.template.key, picks, inputs, callBasis: preview.callBasis })
  }

  const regenerate = (): void => {
    if (preview === null) return
    markEdited(false)
    void runPreview({ key: preview.template.key, picks, inputs, callBasis: preview.callBasis })
  }

  const check = (): void => {
    if (preview === null) return
    void runPreview({ key: preview.template.key, picks, inputs, callBasis: preview.callBasis, subject, body })
  }

  const backToTemplates = (): void => {
    setPreview(null)
    setPreviewError(null)
    setPicks([])
    setInputs({})
    setSubject('')
    setBody('')
    markEdited(false)
    setSendError(null)
    setOutdatedNotice(false)
    setOldDraft(null)
  }

  const send = async (): Promise<void> => {
    if (preview === null || sending) return
    if (preview.send.canCompose !== true) return
    setSending(true)
    setSendError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/contacts/${contactId}/email/compose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject,
          body,
          requestId: requestId.current,
          expectedRecipient: preview.send.recipient,
          template: {
            key: preview.template.key,
            version: preview.template.version,
            catalogVersion: preview.catalogVersion,
            picks,
            inputs,
            callBasis: preview.callBasis,
          },
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string; reason?: string }
      if (!res.ok) {
        const reason = json.reason
        if (reason !== undefined && OUTDATED_REASONS.has(reason)) {
          setOldDraft({ subject, body })
          markEdited(false)
          setOutdatedNotice(true)
          void runPreview({ key: preview.template.key, picks, inputs, callBasis: preview.callBasis })
          return
        }
        setSendError(json.error ?? '发送失败，请稍后再试')
        return
      }
      requestId.current = newRequestId()
      setSent(true)
      onSent()
      closeTimer.current = setTimeout(() => {
        onClose()
      }, 1200)
    } catch {
      setSendError('网络出错，发送状态不明。请先看时间线确认，别重复发送。')
    } finally {
      setSending(false)
    }
  }

  const missingInputs = preview === null ? [] : preview.rendered.missing.filter((m) => m.startsWith('input.'))
  const missingOther = preview === null ? [] : preview.rendered.missing.filter((m) => !m.startsWith('input.'))

  const pickProblem = preview?.pickProblem ?? null
  const blocks = preview?.blocks ?? []
  const warnings = preview?.warnings ?? []
  const frequency = preview?.frequency ?? null
  const sendPreview = preview?.send ?? null

  const needsPick = preview !== null && preview.template.pickMode !== 'none' && picks.length === 0
  const textBlocked = !edited && preview !== null && (preview.rendered.missing.length > 0 || preview.rendered.problems.length > 0)
  const frequencyBlocked = frequency !== null && (frequency.state === 'capped' || frequency.state === 'unverifiable')
  const sendDisabled =
    sending ||
    sent ||
    loading ||
    preview === null ||
    sendPreview === null ||
    sendPreview.canCompose !== true ||
    subject.trim() === '' ||
    body.trim() === '' ||
    textBlocked ||
    blocks.length > 0 ||
    pickProblem !== null ||
    needsPick ||
    frequencyBlocked

  return (
    <div className="mt-4 rounded-xl border border-me-charcoal/10 bg-me-ivory/40 p-3" data-testid="template-email-panel">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[13px] font-black text-me-charcoal/70">✉️ 用模板写邮件</p>
        <button type="button" onClick={onClose} className="text-xs text-me-charcoal/55 underline">
          关闭
        </button>
      </div>

      {preview === null && (
        <div>
          {templates.length === 0 ? (
            <p className="text-xs text-me-charcoal/55">现在没有启用中的模板。</p>
          ) : (
            <ul className="space-y-1">
              {templates.map((t) => (
                <li key={t.key}>
                  <button
                    type="button"
                    onClick={() => startTemplate(t)}
                    disabled={loading}
                    className="w-full rounded-lg border border-me-stone bg-white px-3 py-2 text-left text-sm disabled:opacity-40"
                  >
                    <span className="font-bold text-me-charcoal">{t.name}</span>
                    <span className="ml-2 text-xs text-me-charcoal/55">{PICK_MODE_LABEL[t.pickMode]}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {loading && <p className="mt-2 text-xs text-me-charcoal/55">正在生成…</p>}
          {previewError !== null && (
            <p className="mt-2 text-xs font-semibold text-red-700" role="alert">
              {previewError}
            </p>
          )}
        </div>
      )}

      {preview !== null && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-bold text-me-charcoal">
              {preview.template.name}
              <span className="ml-2 text-xs font-normal text-me-charcoal/55">版本 {preview.template.version}</span>
            </p>
            <button type="button" onClick={backToTemplates} className="text-xs text-me-charcoal/55 underline">
              换一个模板
            </button>
          </div>

          {preview.callBasis === 'system_call' && (
            <p className="mb-2 text-xs text-me-charcoal/60">📞 系统记录了刚才的通话</p>
          )}
          {preview.callBasis === 'staff_attested' && (
            <p className="mb-2 text-xs text-me-charcoal/60">📞 按你点的「刚和他通过电话」写</p>
          )}

          {preview.template.pickMode !== 'none' && (
            <PickList
              mode={preview.template.pickMode}
              options={preview.options}
              picks={picks}
              onChange={changePicks}
            />
          )}

          {pickProblem !== null && <p className="mt-2 text-xs font-semibold text-red-700">{pickProblem}</p>}

          {missingInputs.map((m) => {
            const name = m.slice('input.'.length)
            return (
              <label key={m} className="mt-2 block text-xs text-me-charcoal/70">
                {name}
                <input
                  value={inputs[name] ?? ''}
                  onChange={(e) => changeInput(name, e.target.value)}
                  onBlur={() => commitInput()}
                  className="mt-1 w-full rounded-lg border border-me-stone bg-white px-3 py-2 text-sm"
                  aria-label={`填写 ${name}`}
                />
              </label>
            )
          })}
          {missingOther.map((m) => (
            <p key={m} className="mt-1 text-xs font-semibold text-red-700">
              还缺：{m}
            </p>
          ))}
          {preview.rendered.problems.map((p) => (
            <p key={p} className="mt-1 text-xs font-semibold text-red-700">
              {p}
            </p>
          ))}

          <input
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value)
              markEdited(true)
            }}
            placeholder="主题"
            maxLength={200}
            className="mt-2 w-full rounded-lg border border-me-stone bg-white px-3 py-2 text-sm"
            aria-label="邮件主题"
          />
          <textarea
            value={body}
            onChange={(e) => {
              setBody(e.target.value)
              markEdited(true)
            }}
            placeholder="正文（纯文本）"
            rows={10}
            maxLength={10000}
            className="mt-2 w-full rounded-lg border border-me-stone bg-white px-3 py-2 text-sm"
            aria-label="邮件正文"
          />
          <div className="mt-1 flex items-center gap-3">
            <button type="button" onClick={regenerate} className="text-xs text-me-charcoal/55 underline">
              按模板重新生成（会丢掉你的修改）
            </button>
            <button type="button" onClick={check} disabled={loading} className="text-xs text-me-charcoal/55 underline disabled:opacity-40">
              检查
            </button>
          </div>

          {blocks.map((b) => (
            <p key={`${b.code}:${b.ruleId ?? ''}:${b.detail}`} className="mt-1 text-xs font-semibold text-red-700">
              不能发：{b.detail}
            </p>
          ))}
          {warnings.map((w) => (
            <p key={`${w.code}:${w.ruleId ?? ''}:${w.detail}`} className="mt-1 text-xs font-semibold text-amber-700">
              提醒：{w.detail}
            </p>
          ))}

          {frequency !== null && <FrequencyLine frequency={frequency} />}

          {sendPreview !== null && (
            <p className={`mt-2 text-xs ${sendPreview.canCompose ? 'text-me-charcoal/60' : 'font-semibold text-red-700'}`}>
              {sendPreview.canCompose
                ? `将用 ${sendPreview.mailbox} 发给 ${sendPreview.recipient}`
                : `不能发：${sendPreview.message}`}
            </p>
          )}

          <p className="mt-1 text-xs text-me-charcoal/55">这是一封新邮件、新主题，不是回复客人的上一封。</p>

          {outdatedNotice && (
            <p className="mt-2 text-xs font-semibold text-amber-700">
              模板或团目录刚更新了，已按最新内容重新生成。你之前改的稿放在下面的「旧稿」里。
            </p>
          )}
          {oldDraft !== null && (
            <details className="mt-1 text-xs text-me-charcoal/70">
              <summary className="cursor-pointer">旧稿</summary>
              <p className="mt-1 font-bold">主题：{oldDraft.subject}</p>
              <pre className="mt-1 whitespace-pre-wrap break-words font-sans">{oldDraft.body}</pre>
            </details>
          )}

          {loading && <p className="mt-2 text-xs text-me-charcoal/55">正在生成…</p>}
          {previewError !== null && (
            <p className="mt-2 text-xs font-semibold text-red-700" role="alert">
              {previewError}
            </p>
          )}
          {sendError !== null && (
            <p className="mt-2 text-xs font-semibold text-red-700" role="alert">
              {sendError}
            </p>
          )}
          {sent && <p className="mt-2 text-xs font-semibold text-green-700">✓ 邮件已发出</p>}

          <button
            type="button"
            onClick={() => void send()}
            disabled={sendDisabled}
            aria-label="发送模板邮件"
            className="mt-2 rounded-lg bg-me-charcoal px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
          >
            {sending ? '发送中…' : '发送'}
          </button>
        </div>
      )}
    </div>
  )
}

function PickList(props: {
  mode: PostCallTemplateSummary['pickMode']
  options: PickOption[]
  picks: PickedItem[]
  onChange: (next: PickedItem[]) => void
}): JSX.Element {
  const { mode, options, picks, onChange } = props
  if (options.length === 0) {
    return <p className="mt-2 text-xs text-me-charcoal/55">现在没有可选的团（目录里没有在售的）。</p>
  }
  const choose = (opt: PickOption, departOn: string | null): void => {
    const next: PickedItem = { tourId: opt.tourId, departOn }
    if (mode === 'one') {
      onChange([next])
      return
    }
    if (picks.some((p) => p.tourId === opt.tourId)) {
      onChange(picks.map((p) => (p.tourId === opt.tourId ? next : p)))
      return
    }
    if (picks.length >= MAX_PICKS) return
    onChange([...picks, next])
  }

  const toggleTour = (opt: PickOption): void => {
    if (mode === 'many' && picks.some((p) => p.tourId === opt.tourId)) {
      onChange(picks.filter((p) => p.tourId !== opt.tourId))
      return
    }
    choose(opt, opt.requiresDeparture ? (opt.departures[0]?.departOn ?? null) : null)
  }

  return (
    <div className="mt-2 space-y-2">
      {options.map((opt) => {
        const selected = picks.find((p) => p.tourId === opt.tourId)
        const isSelected = selected !== undefined
        return (
          <div key={opt.tourId} className="rounded-lg border border-me-stone bg-white p-2">
            <label className="flex items-start gap-2 text-sm">
              <input
                type={mode === 'one' ? 'radio' : 'checkbox'}
                name="template-pick"
                checked={isSelected}
                onChange={() => toggleTour(opt)}
                className="mt-1"
              />
              <span>
                <span className="font-bold text-me-charcoal">{opt.name}</span>
                {opt.durationText !== null && <span className="ml-2 text-xs text-me-charcoal/55">{opt.durationText}</span>}
                {opt.priceText !== null && <span className="ml-2 text-xs text-me-charcoal/55">{opt.priceText}</span>}
              </span>
            </label>
            {opt.requiresDeparture && isSelected && (
              <select
                value={selected.departOn ?? ''}
                onChange={(e) => choose(opt, e.target.value === '' ? null : e.target.value)}
                className="mt-1 w-full rounded-lg border border-me-stone bg-white px-2 py-1 text-xs"
                aria-label={`${opt.name} 出发日期`}
              >
                {opt.departures.length === 0 && <option value="">没有可选的出发日期</option>}
                {opt.departures.map((d) => (
                  <option key={d.departOn} value={d.departOn}>
                    {d.displayDate}
                    {d.status === 'limited' ? '（余位不多）' : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
        )
      })}
    </div>
  )
}

function FrequencyLine(props: { frequency: PreviewFrequency }): JSX.Element | null {
  const { frequency } = props
  if (frequency.state === 'off') return null
  if (frequency.state === 'ok') {
    return (
      <p className="mt-2 text-xs text-me-charcoal/60">
        最近 {frequency.windowDays} 天已给他发了 {frequency.count} 封（上限 {frequency.max}）
      </p>
    )
  }
  if (frequency.state === 'capped') {
    return (
      <div className="mt-2">
        <p className="text-xs font-semibold text-red-700">
          他最近 {frequency.windowDays} 天已收到 {frequency.count} 封，已到上限 {frequency.max}；最早 {formatWhen(frequency.nextAllowedAt)} 可再发
        </p>
        <FrequencyItems items={frequency.items} />
      </div>
    )
  }
  return (
    <div className="mt-2">
      <p className="text-xs font-semibold text-red-700">暂时数不清他这周收了几封，先别发，稍后再试</p>
      <FrequencyItems items={frequency.items} />
    </div>
  )
}

function FrequencyItems(props: { items: PreviewFrequency['items'] }): JSX.Element | null {
  if (props.items.length === 0) return null
  return (
    <details className="mt-1 text-xs text-me-charcoal/70">
      <summary className="cursor-pointer">看明细</summary>
      <ul className="mt-1 space-y-0.5">
        {props.items.map((it, i) => (
          <li key={`${it.source}:${it.at}:${i}`}>
            {formatWhen(it.at)} · {SOURCE_LABEL[it.source] ?? it.source} · {it.subject ?? '（无主题）'}
          </li>
        ))}
      </ul>
    </details>
  )
}
