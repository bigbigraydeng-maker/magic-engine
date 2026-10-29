'use client'

/**
 * Create or edit one email template. Saving always produces a new version;
 * old versions are kept. See docs/specs for the email template design.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import type {
  EmailTemplateVersion,
  FactSource,
  PickFilter,
  PickMode,
  TemplateStatus,
} from '@/lib/crm/email-templates/types'

export interface TemplateVariables {
  common: string[]
  bySource: Record<string, string[]>
}

export interface TemplateEditorProps {
  clientId: string
  /** The CURRENT version of an existing template; null = a brand-new template. */
  initial: EmailTemplateVersion | null
  /** Optional: start the form from an OLDER version's content. */
  prefill?: EmailTemplateVersion | null
  variables: TemplateVariables
  onSaved: (template: EmailTemplateVersion, notices: string[]) => void
  onCancel: () => void
  onReload: () => void
}

const KEY_RE = /^[a-z0-9][a-z0-9-]{1,62}$/

const FACT_SOURCE_LABELS: Record<FactSource, string> = {
  none: '不用目录',
  published_tours: '已发布的团目录',
}

const PICK_MODE_LABELS: Record<PickMode, string> = {
  none: '不选团',
  one: '选一个团',
  many: '选多个团',
}

const STATUS_LABELS: Record<TemplateStatus, string> = {
  active: '启用',
  disabled: '停用',
}

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function splitList(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function buildPickFilter(
  factSource: FactSource,
  destinations: string,
  tiers: string,
  months: number[],
): PickFilter {
  if (factSource === 'none') return {}
  const filter: PickFilter = {}
  const dest = splitList(destinations)
  if (dest.length > 0) filter.destinations = dest
  const tier = splitList(tiers)
  if (tier.length > 0) filter.tiers = tier
  if (months.length > 0) filter.departureMonths = [...months].sort((a, b) => a - b)
  return filter
}

interface FormState {
  name: string
  templateKey: string
  status: TemplateStatus
  factSource: FactSource
  pickMode: PickMode
  destinations: string
  tiers: string
  months: number[]
  subject: string
  body: string
  changeNote: string
}

function initialState(initial: EmailTemplateVersion | null, prefill: EmailTemplateVersion | null | undefined): FormState {
  const source = prefill ?? initial
  if (!source) {
    return {
      name: '',
      templateKey: '',
      status: 'disabled',
      factSource: 'none',
      pickMode: 'none',
      destinations: '',
      tiers: '',
      months: [],
      subject: '',
      body: '',
      changeNote: '',
    }
  }
  const filter = source.pickFilter ?? {}
  return {
    name: source.name,
    templateKey: source.templateKey,
    status: source.status,
    factSource: source.factSource,
    pickMode: source.pickMode,
    destinations: (filter.destinations ?? []).join(', '),
    tiers: (filter.tiers ?? []).join(', '),
    months: filter.departureMonths ?? [],
    subject: source.subject,
    body: source.body,
    changeNote: '',
  }
}

type SaveError =
  | { kind: 'validation'; lines: string[] }
  | { kind: 'conflict' }
  | { kind: 'other'; message: string }

export function TemplateEditor(props: TemplateEditorProps): JSX.Element {
  const { clientId, initial, prefill, variables, onSaved, onCancel, onReload } = props
  const isNew = initial === null

  const [form, setForm] = useState<FormState>(() => initialState(initial, prefill))
  const [keyTouched, setKeyTouched] = useState<boolean>(() => !isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<SaveError | null>(null)

  const subjectRef = useRef<HTMLInputElement | null>(null)
  const bodyRef = useRef<HTMLTextAreaElement | null>(null)
  const lastFocused = useRef<'subject' | 'body'>('body')

  const update = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }, [])

  const onNameChange = (value: string): void => {
    setForm((prev) => {
      const next: FormState = { ...prev, name: value }
      if (!keyTouched) next.templateKey = slugify(value)
      return next
    })
  }

  const onKeyChange = (value: string): void => {
    setKeyTouched(true)
    update('templateKey', value)
  }

  const onFactSourceChange = (value: FactSource): void => {
    setForm((prev) => ({
      ...prev,
      factSource: value,
      pickMode: value === 'none' ? 'none' : prev.pickMode,
    }))
  }

  const toggleMonth = (month: number): void => {
    setForm((prev) => {
      const has = prev.months.includes(month)
      const months = has ? prev.months.filter((m) => m !== month) : [...prev.months, month]
      return { ...prev, months }
    })
  }

  const insertPlaceholder = (name: string): void => {
    const token = `{{${name}}}`
    if (lastFocused.current === 'subject') {
      const el = subjectRef.current
      const current = form.subject
      const start = el?.selectionStart ?? current.length
      const end = el?.selectionEnd ?? current.length
      const next = current.slice(0, start) + token + current.slice(end)
      update('subject', next.slice(0, 400))
      requestAnimationFrame(() => {
        const node = subjectRef.current
        if (node) {
          const pos = Math.min(start + token.length, node.value.length)
          node.focus()
          node.setSelectionRange(pos, pos)
        }
      })
    } else {
      const el = bodyRef.current
      const current = form.body
      const start = el?.selectionStart ?? current.length
      const end = el?.selectionEnd ?? current.length
      const next = current.slice(0, start) + token + current.slice(end)
      update('body', next.slice(0, 10000))
      requestAnimationFrame(() => {
        const node = bodyRef.current
        if (node) {
          const pos = Math.min(start + token.length, node.value.length)
          node.focus()
          node.setSelectionRange(pos, pos)
        }
      })
    }
  }

  const placeholderNames = useMemo(() => {
    const source = variables.bySource[form.factSource] ?? []
    return [...variables.common, ...source]
  }, [variables, form.factSource])

  const keyValid = isNew ? KEY_RE.test(form.templateKey) : true
  const canSave =
    !saving &&
    form.name.trim() !== '' &&
    form.subject.trim() !== '' &&
    form.body.trim() !== '' &&
    keyValid

  const save = async (): Promise<void> => {
    if (!canSave) return
    setSaving(true)
    setError(null)
    const pickFilter = buildPickFilter(form.factSource, form.destinations, form.tiers, form.months)
    const changeNote = form.changeNote.trim() === '' ? null : form.changeNote.trim()
    const payload = {
      name: form.name,
      subject: form.subject,
      body: form.body,
      factSource: form.factSource,
      pickMode: form.factSource === 'none' ? 'none' : form.pickMode,
      pickFilter,
      status: form.status,
      changeNote,
    }
    try {
      const url = isNew
        ? `/api/clients/${clientId}/crm/email-templates`
        : `/api/clients/${clientId}/crm/email-templates/${initial.templateKey}`
      const body = isNew
        ? JSON.stringify({ templateKey: form.templateKey, ...payload })
        : JSON.stringify({ baseVersion: initial.version, ...payload })
      const res = await fetch(url, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      if (res.ok) {
        const json = (await res.json()) as { template: EmailTemplateVersion; notices: string[] }
        onSaved(json.template, json.notices ?? [])
        return
      }
      if (res.status === 400) {
        const json = (await res.json().catch(() => ({}))) as { error?: string; errors?: string[] }
        const lines = json.errors && json.errors.length > 0 ? json.errors : [json.error ?? '内容有问题，请检查后再保存。']
        setError({ kind: 'validation', lines })
        return
      }
      if (res.status === 409) {
        setError({ kind: 'conflict' })
        return
      }
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      setError({ kind: 'other', message: json.error ?? '保存失败，请稍后再试' })
    } catch {
      setError({ kind: 'other', message: '网络出错，没保存成功。' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-me-charcoal/10 bg-me-ivory/40 p-4" data-testid="template-editor">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-black text-me-charcoal/80">
          {isNew ? '新建邮件模板' : '修改邮件模板'}
        </p>
        {!isNew && (
          <p className="text-xs text-me-charcoal/55">
            当前是第 {initial.version} 版。保存会生成新的一版，旧版本都留着。
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-me-charcoal/70">名称</span>
          <input
            type="text"
            value={form.name}
            onChange={(e) => onNameChange(e.target.value)}
            aria-label="模板名称"
            maxLength={120}
            className="w-full rounded-lg border border-me-stone bg-white px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-me-charcoal/70">模板标识</span>
          {isNew ? (
            <>
              <input
                type="text"
                value={form.templateKey}
                onChange={(e) => onKeyChange(e.target.value)}
                aria-label="模板标识"
                maxLength={63}
                className="w-full rounded-lg border border-me-stone bg-white px-3 py-2 text-sm"
              />
              {form.templateKey !== '' && !keyValid && (
                <span className="mt-1 block text-xs text-red-700">
                  只能用英文小写字母、数字和短横线，2–63 个字符，开头要是字母或数字。
                </span>
              )}
            </>
          ) : (
            <p className="rounded-lg border border-me-stone/60 bg-me-stone/20 px-3 py-2 text-sm text-me-charcoal/60">
              {form.templateKey}
            </p>
          )}
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-me-charcoal/70">状态</span>
          <select
            value={form.status}
            onChange={(e) => update('status', e.target.value as TemplateStatus)}
            aria-label="模板状态"
            className="w-full rounded-lg border border-me-stone bg-white px-3 py-2 text-sm"
          >
            <option value="active">{STATUS_LABELS.active}</option>
            <option value="disabled">{STATUS_LABELS.disabled}</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-me-charcoal/70">内容来源</span>
          <select
            value={form.factSource}
            onChange={(e) => onFactSourceChange(e.target.value as FactSource)}
            aria-label="内容来源"
            className="w-full rounded-lg border border-me-stone bg-white px-3 py-2 text-sm"
          >
            <option value="none">{FACT_SOURCE_LABELS.none}</option>
            <option value="published_tours">{FACT_SOURCE_LABELS.published_tours}</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-me-charcoal/70">选团方式</span>
          <select
            value={form.pickMode}
            onChange={(e) => update('pickMode', e.target.value as PickMode)}
            aria-label="选团方式"
            disabled={form.factSource === 'none'}
            className="w-full rounded-lg border border-me-stone bg-white px-3 py-2 text-sm disabled:opacity-50"
          >
            <option value="none">{PICK_MODE_LABELS.none}</option>
            <option value="one">{PICK_MODE_LABELS.one}</option>
            <option value="many">{PICK_MODE_LABELS.many}</option>
          </select>
        </label>
      </div>

      {form.factSource !== 'none' && (
        <div className="mt-3 rounded-lg border border-me-stone/60 bg-white/60 p-3">
          <p className="mb-2 text-xs font-semibold text-me-charcoal/70">适用范围（都可以不填）</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs text-me-charcoal/60">目的地</span>
              <input
                type="text"
                value={form.destinations}
                onChange={(e) => update('destinations', e.target.value)}
                aria-label="适用目的地"
                placeholder="用逗号分开，比如：日本, 新西兰"
                className="w-full rounded-lg border border-me-stone bg-white px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-me-charcoal/60">档次</span>
              <input
                type="text"
                value={form.tiers}
                onChange={(e) => update('tiers', e.target.value)}
                aria-label="适用档次"
                placeholder="用逗号分开，比如：标准, 豪华"
                className="w-full rounded-lg border border-me-stone bg-white px-3 py-2 text-sm"
              />
            </label>
          </div>
          <div className="mt-2">
            <span className="mb-1 block text-xs text-me-charcoal/60">出发月份</span>
            <div className="flex flex-wrap gap-2">
              {MONTHS.map((m) => (
                <label key={m} className="flex items-center gap-1 text-xs text-me-charcoal/70">
                  <input
                    type="checkbox"
                    checked={form.months.includes(m)}
                    onChange={() => toggleMonth(m)}
                    aria-label={`出发月份 ${m}`}
                  />
                  <span>{m} 月</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="mt-3">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-me-charcoal/70">主题</span>
          <input
            ref={subjectRef}
            type="text"
            value={form.subject}
            onChange={(e) => update('subject', e.target.value)}
            onFocus={() => {
              lastFocused.current = 'subject'
            }}
            aria-label="邮件主题"
            maxLength={400}
            className="w-full rounded-lg border border-me-stone bg-white px-3 py-2 text-sm"
          />
        </label>
      </div>

      <div className="mt-3">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-me-charcoal/70">正文</span>
          <textarea
            ref={bodyRef}
            value={form.body}
            onChange={(e) => update('body', e.target.value)}
            onFocus={() => {
              lastFocused.current = 'body'
            }}
            aria-label="邮件正文"
            rows={14}
            maxLength={10000}
            className="w-full rounded-lg border border-me-stone bg-white px-3 py-2 text-sm"
          />
        </label>
      </div>

      <div className="mt-2">
        <p className="mb-1 text-xs font-semibold text-me-charcoal/70">插入占位符</p>
        <div className="flex flex-wrap gap-1">
          {placeholderNames.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => insertPlaceholder(name)}
              className="rounded-md border border-me-stone bg-white px-2 py-1 text-xs text-me-charcoal/80 hover:bg-me-ivory"
            >
              {`{{${name}}}`}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-me-charcoal/55">
          手填内容写成 {'{{input.名字}}'}；列表类可以写 {'{{名字:3}}'} 取前 3 项。主题里不能用多行的内容。
        </p>
      </div>

      <div className="mt-3">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-me-charcoal/70">变更说明</span>
          <input
            type="text"
            value={form.changeNote}
            onChange={(e) => update('changeNote', e.target.value)}
            aria-label="变更说明"
            maxLength={300}
            placeholder="这次改了什么（可不填）"
            className="w-full rounded-lg border border-me-stone bg-white px-3 py-2 text-sm"
          />
        </label>
      </div>

      {error && (
        <div className="mt-3" role="alert">
          {error.kind === 'validation' && (
            <ul className="list-disc pl-5 text-xs font-semibold text-red-700">
              {error.lines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
          {error.kind === 'conflict' && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold text-red-700">别人刚改过这个模板，你的修改还没保存。</p>
              <button
                type="button"
                onClick={onReload}
                className="rounded-lg border border-me-stone bg-white px-3 py-1 text-xs font-bold text-me-charcoal"
              >
                重新载入最新版
              </button>
            </div>
          )}
          {error.kind === 'other' && (
            <p className="text-xs font-semibold text-red-700">{error.message}</p>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={!canSave}
          aria-label="保存模板"
          className="rounded-lg bg-me-charcoal px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
        >
          {saving ? '保存中…' : '保存'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-me-stone bg-white px-4 py-2 text-sm font-bold text-me-charcoal"
        >
          取消
        </button>
      </div>
    </div>
  )
}
