'use client'

/**
 * 发信设置表单（只有 Magic Lab 的全局管理员能看和改）。
 * 读接口一次返回：状态 + 版本 + 已存设置 + 校验错误 + 历史。
 * 保存走 PUT，带 baseVersion 做乐观锁；409 时提示重新载入。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { EMAIL_SETTINGS_SAVED_EVENT } from '@/lib/crm/email-templates/settings-events'
import type { SettingsHistoryEntry } from '@/lib/crm/email-templates/settings-store'

interface StoredSettings {
  enabled: boolean
  send_mailbox: string | null
  allow_unsolicited: boolean
  footer: string | null
  limits: { per_user_per_hour: number; per_user_per_day: number; per_mailbox_per_day: number }
  frequency_cap: { max: number; window_days: number } | null
  recipient_allowlist: string[] | null
  same_template_cooldown_hours: number
  call_prompt_hours: number
  guardrails: {
    allowed_link_hosts: string[]
    rules: Array<{ id: string; phrases: string[]; message: string; severity: 'block' | 'warn' }>
  }
  providers: { published_tours?: { url_pattern: string; all_tours_url: string } }
}

interface LoadPayload {
  state: 'none' | 'ok' | 'invalid'
  version: number | null
  settings: StoredSettings | null
  errors: string[]
  history: SettingsHistoryEntry[]
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; payload: LoadPayload }

// Editable form state: strings for numbers so the user can clear them.
interface RuleDraft {
  id: string
  severity: 'block' | 'warn'
  message: string
  phrasesText: string
}

interface FormState {
  enabled: boolean
  sendMailbox: string
  allowUnsolicited: boolean
  footer: string
  perUserPerHour: string
  perUserPerDay: string
  perMailboxPerDay: string
  frequencyOn: boolean
  frequencyMax: string
  frequencyWindowDays: string
  allowlistMode: 'list' | 'anyone'
  allowlistText: string
  sameTemplateCooldownHours: string
  callPromptHours: string
  allowedHostsText: string
  rules: RuleDraft[]
  urlPattern: string
  allToursUrl: string
}

const DEFAULT_FORM: FormState = {
  enabled: false,
  sendMailbox: '',
  allowUnsolicited: false,
  footer: '',
  perUserPerHour: '30',
  perUserPerDay: '100',
  perMailboxPerDay: '200',
  frequencyOn: true,
  frequencyMax: '2',
  frequencyWindowDays: '7',
  allowlistMode: 'list',
  allowlistText: '',
  sameTemplateCooldownHours: '24',
  callPromptHours: '24',
  allowedHostsText: '',
  rules: [],
  urlPattern: '',
  allToursUrl: '',
}

function linesToList(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}

function formFromSettings(s: StoredSettings): FormState {
  return {
    enabled: s.enabled,
    sendMailbox: s.send_mailbox ?? '',
    allowUnsolicited: s.allow_unsolicited,
    footer: s.footer ?? '',
    perUserPerHour: String(s.limits.per_user_per_hour),
    perUserPerDay: String(s.limits.per_user_per_day),
    perMailboxPerDay: String(s.limits.per_mailbox_per_day),
    frequencyOn: s.frequency_cap !== null,
    frequencyMax: s.frequency_cap ? String(s.frequency_cap.max) : '2',
    frequencyWindowDays: s.frequency_cap ? String(s.frequency_cap.window_days) : '7',
    allowlistMode: s.recipient_allowlist === null ? 'anyone' : 'list',
    allowlistText: s.recipient_allowlist ? s.recipient_allowlist.join('\n') : '',
    sameTemplateCooldownHours: String(s.same_template_cooldown_hours),
    callPromptHours: String(s.call_prompt_hours),
    allowedHostsText: s.guardrails.allowed_link_hosts.join('\n'),
    rules: s.guardrails.rules.map((r) => ({
      id: r.id,
      severity: r.severity,
      message: r.message,
      phrasesText: r.phrases.join('\n'),
    })),
    urlPattern: s.providers.published_tours?.url_pattern ?? '',
    allToursUrl: s.providers.published_tours?.all_tours_url ?? '',
  }
}

function parsePositiveInt(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return null
  return n
}

function parsePositiveIntMin1(text: string): number | null {
  const n = parsePositiveInt(text)
  if (n === null || n < 1) return null
  return n
}

type BuildResult = { ok: true; settings: StoredSettings } | { ok: false; message: string }

function buildSettings(form: FormState): BuildResult {
  const perUserPerHour = parsePositiveIntMin1(form.perUserPerHour)
  const perUserPerDay = parsePositiveIntMin1(form.perUserPerDay)
  const perMailboxPerDay = parsePositiveIntMin1(form.perMailboxPerDay)
  if (perUserPerHour === null || perUserPerDay === null || perMailboxPerDay === null) {
    return { ok: false, message: '发送上限要填大于 0 的整数。' }
  }

  let frequencyCap: StoredSettings['frequency_cap'] = null
  if (form.frequencyOn) {
    const max = parsePositiveIntMin1(form.frequencyMax)
    const windowDays = parsePositiveIntMin1(form.frequencyWindowDays)
    if (max === null || windowDays === null) {
      return { ok: false, message: '频次上限要填大于 0 的整数。' }
    }
    frequencyCap = { max, window_days: windowDays }
  }

  const sameTemplateCooldownHours = parsePositiveInt(form.sameTemplateCooldownHours)
  const callPromptHours = parsePositiveIntMin1(form.callPromptHours)
  if (sameTemplateCooldownHours === null || callPromptHours === null) {
    return { ok: false, message: '防重复的小时数要填整数（冷却可以是 0）。' }
  }

  const allowlist = form.allowlistMode === 'anyone' ? null : linesToList(form.allowlistText)

  const rules = form.rules.map((r) => ({
    id: r.id.trim(),
    severity: r.severity,
    message: r.message.trim(),
    phrases: linesToList(r.phrasesText),
  }))

  const urlPattern = form.urlPattern.trim()
  const allToursUrl = form.allToursUrl.trim()
  const providers: StoredSettings['providers'] = {}
  if (urlPattern !== '' || allToursUrl !== '') {
    providers.published_tours = { url_pattern: urlPattern, all_tours_url: allToursUrl }
  }

  return {
    ok: true,
    settings: {
      enabled: form.enabled,
      send_mailbox: form.sendMailbox.trim() === '' ? null : form.sendMailbox.trim(),
      allow_unsolicited: form.allowUnsolicited,
      footer: form.footer.trim() === '' ? null : form.footer.trim(),
      limits: {
        per_user_per_hour: perUserPerHour,
        per_user_per_day: perUserPerDay,
        per_mailbox_per_day: perMailboxPerDay,
      },
      frequency_cap: frequencyCap,
      recipient_allowlist: allowlist,
      same_template_cooldown_hours: sameTemplateCooldownHours,
      call_prompt_hours: callPromptHours,
      guardrails: {
        allowed_link_hosts: linesToList(form.allowedHostsText),
        rules,
      },
      providers,
    },
  }
}

const NZ_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return NZ_FORMATTER.format(d)
}

export function EmailSettingsPanel(props: { clientId: string }): JSX.Element {
  const { clientId } = props
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' })
  const [form, setForm] = useState<FormState>(DEFAULT_FORM)
  const [baseVersion, setBaseVersion] = useState<number | null>(null)
  const [changeNote, setChangeNote] = useState('')
  const [confirmUnrestricted, setConfirmUnrestricted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string[] | null>(null)
  const [saveOk, setSaveOk] = useState<number | null>(null)
  const [conflict, setConflict] = useState(false)

  const fetchSettings = useCallback(async () => {
    setLoad({ kind: 'loading' })
    setSaveError(null)
    setSaveOk(null)
    setConflict(false)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/email-settings`)
      if (res.status === 403) {
        setLoad({ kind: 'forbidden' })
        return
      }
      if (!res.ok) {
        setLoad({ kind: 'error', message: `暂时读不到发信设置：服务器返回 ${res.status}` })
        return
      }
      const payload = (await res.json()) as LoadPayload
      setLoad({ kind: 'ready', payload })
      if (payload.state === 'ok' && payload.settings) {
        setForm(formFromSettings(payload.settings))
        setBaseVersion(payload.version)
      } else if (payload.state === 'invalid') {
        setForm(DEFAULT_FORM)
        setBaseVersion(payload.version)
      } else {
        setForm(DEFAULT_FORM)
        setBaseVersion(null)
      }
      setChangeNote('')
      setConfirmUnrestricted(false)
    } catch {
      setLoad({ kind: 'error', message: '暂时读不到发信设置：网络出错。' })
    }
  }, [clientId])

  useEffect(() => {
    void fetchSettings()
  }, [fetchSettings])

  const built = useMemo(() => buildSettings(form), [form])
  const needsConfirm = built.ok && built.settings.enabled && built.settings.recipient_allowlist === null
  const canSave = built.ok && !saving && (!needsConfirm || confirmUnrestricted)

  const update = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const updateRule = (index: number, patch: Partial<RuleDraft>): void => {
    setForm((prev) => ({
      ...prev,
      rules: prev.rules.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    }))
  }

  const addRule = (): void => {
    setForm((prev) => ({
      ...prev,
      rules: [...prev.rules, { id: '', severity: 'warn', message: '', phrasesText: '' }],
    }))
  }

  const removeRule = (index: number): void => {
    setForm((prev) => ({ ...prev, rules: prev.rules.filter((_, i) => i !== index) }))
  }

  const save = async (): Promise<void> => {
    if (!built.ok || saving) return
    setSaving(true)
    setSaveError(null)
    setSaveOk(null)
    setConflict(false)
    try {
      const body: Record<string, unknown> = {
        settings: built.settings,
        baseVersion,
      }
      const note = changeNote.trim()
      if (note !== '') body.changeNote = note
      if (needsConfirm) body.confirmUnrestricted = true

      const res = await fetch(`/api/clients/${clientId}/crm/email-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.status === 409) {
        setConflict(true)
        return
      }
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        version?: number
        error?: string
        errors?: string[]
      }
      if (!res.ok) {
        const lines = json.errors && json.errors.length > 0 ? json.errors : [json.error ?? '保存失败，请稍后再试。']
        setSaveError(lines)
        return
      }
      // fetchSettings clears the banners, so the "saved" note is put back after the re-read
      await fetchSettings()
      if (typeof json.version === 'number') setSaveOk(json.version)
      window.dispatchEvent(new Event(EMAIL_SETTINGS_SAVED_EVENT))
    } catch {
      setSaveError(['网络出错，保存状态不明。请重新载入后再确认。'])
    } finally {
      setSaving(false)
    }
  }

  if (load.kind === 'loading') {
    return (
      <div data-testid="email-settings-panel" className="text-sm text-me-charcoal/60">
        正在读取发信设置…
      </div>
    )
  }

  if (load.kind === 'forbidden') {
    return (
      <div data-testid="email-settings-panel" className="text-sm text-me-charcoal/70">
        发信设置只有 Magic Lab 的全局管理员能看和改。
      </div>
    )
  }

  if (load.kind === 'error') {
    return (
      <div data-testid="email-settings-panel" className="text-sm text-me-charcoal/70">
        <p className="mb-2 text-red-700">{load.message}</p>
        <button
          type="button"
          onClick={() => void fetchSettings()}
          className="rounded-lg border border-me-stone bg-white px-3 py-1.5 text-sm font-bold text-me-charcoal"
        >
          重试
        </button>
      </div>
    )
  }

  const payload = load.payload
  const history = payload.history.slice(0, 10)

  return (
    <div data-testid="email-settings-panel" className="space-y-5 text-sm text-me-charcoal">
      {payload.state === 'invalid' && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-800">
          <p className="mb-1 font-bold">现有设置有问题，发不出去：</p>
          <ul className="list-disc pl-4">
            {payload.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <Section title="总开关">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => update('enabled', e.target.checked)}
          />
          <span>打开「在 CRM 里发邮件」</span>
        </label>
        <Help>关着的时候谁都发不出去。</Help>
      </Section>

      <Section title="发信邮箱">
        <input
          type="text"
          value={form.sendMailbox}
          onChange={(e) => update('sendMailbox', e.target.value)}
          aria-label="发信邮箱"
          placeholder="例如 sales@example.com"
          className="w-full rounded-lg border border-me-stone bg-white px-3 py-2 text-sm"
        />
        <Help>只连了一个邮箱时可以不填。</Help>
      </Section>

      <Section title="允许发给没咨询过的人">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.allowUnsolicited}
            onChange={(e) => update('allowUnsolicited', e.target.checked)}
          />
          <span>允许发给没咨询过我们的人</span>
        </label>
      </Section>

      <Section title="邮件页脚">
        <textarea
          value={form.footer}
          onChange={(e) => update('footer', e.target.value)}
          rows={3}
          maxLength={500}
          aria-label="邮件页脚"
          className="w-full rounded-lg border border-me-stone bg-white px-3 py-2 text-sm"
        />
      </Section>

      <Section title="发送上限">
        <div className="grid grid-cols-3 gap-2">
          <NumberField
            label="每人每小时"
            value={form.perUserPerHour}
            onChange={(v) => update('perUserPerHour', v)}
          />
          <NumberField
            label="每人每天"
            value={form.perUserPerDay}
            onChange={(v) => update('perUserPerDay', v)}
          />
          <NumberField
            label="每个邮箱每天"
            value={form.perMailboxPerDay}
            onChange={(v) => update('perMailboxPerDay', v)}
          />
        </div>
      </Section>

      <Section title="同一个客人的频次上限">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.frequencyOn}
            onChange={(e) => update('frequencyOn', e.target.checked)}
          />
          <span>限制频次</span>
        </label>
        {form.frequencyOn && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <NumberField
              label="最多 N 封"
              value={form.frequencyMax}
              onChange={(v) => update('frequencyMax', v)}
            />
            <NumberField
              label="每 D 天"
              value={form.frequencyWindowDays}
              onChange={(v) => update('frequencyWindowDays', v)}
            />
          </div>
        )}
        <Help>按这个客人名下所有邮箱地址、含群发邮件一起数。</Help>
      </Section>

      <Section title="试跑名单">
        <div className="space-y-2">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="allowlist-mode"
              checked={form.allowlistMode === 'list'}
              onChange={() => update('allowlistMode', 'list')}
            />
            <span>只允许发给下面这些地址</span>
          </label>
          {form.allowlistMode === 'list' && (
            <textarea
              value={form.allowlistText}
              onChange={(e) => update('allowlistText', e.target.value)}
              rows={4}
              aria-label="允许发送的地址列表"
              placeholder="一行一个地址"
              className="w-full rounded-lg border border-me-stone bg-white px-3 py-2 text-sm"
            />
          )}
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="allowlist-mode"
              checked={form.allowlistMode === 'anyone'}
              onChange={() => update('allowlistMode', 'anyone')}
            />
            <span>对所有客人放开</span>
          </label>
          {form.allowlistMode === 'anyone' && (
            <p className="text-xs font-semibold text-red-700">选这个等于对所有客人放开。</p>
          )}
        </div>
      </Section>

      <Section title="防重复">
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="同一模板冷却小时数"
            value={form.sameTemplateCooldownHours}
            onChange={(v) => update('sameTemplateCooldownHours', v)}
          />
          <NumberField
            label="通话后提示小时数"
            value={form.callPromptHours}
            onChange={(v) => update('callPromptHours', v)}
          />
        </div>
      </Section>

      <Section title="文字红线">
        <label className="mb-1 block text-xs font-bold text-me-charcoal/70">允许出现的链接域名</label>
        <textarea
          value={form.allowedHostsText}
          onChange={(e) => update('allowedHostsText', e.target.value)}
          rows={3}
          aria-label="允许出现的链接域名"
          placeholder="一行一个域名，例如 example.com"
          className="w-full rounded-lg border border-me-stone bg-white px-3 py-2 text-sm"
        />

        <div className="mt-3 space-y-3">
          {form.rules.map((rule, i) => (
            <div key={i} className="rounded-lg border border-me-stone bg-me-ivory/40 p-3">
              <div className="mb-2 grid grid-cols-2 gap-2">
                <label className="block text-xs">
                  <span className="mb-1 block font-bold text-me-charcoal/70">规则 ID</span>
                  <input
                    type="text"
                    value={rule.id}
                    onChange={(e) => updateRule(i, { id: e.target.value })}
                    aria-label={`第 ${i + 1} 条规则的 ID`}
                    className="w-full rounded-lg border border-me-stone bg-white px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="block text-xs">
                  <span className="mb-1 block font-bold text-me-charcoal/70">严重度</span>
                  <select
                    value={rule.severity}
                    onChange={(e) =>
                      updateRule(i, { severity: e.target.value === 'block' ? 'block' : 'warn' })
                    }
                    aria-label={`第 ${i + 1} 条规则的严重度`}
                    className="w-full rounded-lg border border-me-stone bg-white px-2 py-1.5 text-sm"
                  >
                    <option value="block">拦截</option>
                    <option value="warn">提醒</option>
                  </select>
                </label>
              </div>
              <label className="mb-2 block text-xs">
                <span className="mb-1 block font-bold text-me-charcoal/70">说明</span>
                <input
                  type="text"
                  value={rule.message}
                  onChange={(e) => updateRule(i, { message: e.target.value })}
                  aria-label={`第 ${i + 1} 条规则的说明`}
                  className="w-full rounded-lg border border-me-stone bg-white px-2 py-1.5 text-sm"
                />
              </label>
              <label className="block text-xs">
                <span className="mb-1 block font-bold text-me-charcoal/70">词语（一行一个）</span>
                <textarea
                  value={rule.phrasesText}
                  onChange={(e) => updateRule(i, { phrasesText: e.target.value })}
                  rows={3}
                  aria-label={`第 ${i + 1} 条规则的词语`}
                  className="w-full rounded-lg border border-me-stone bg-white px-2 py-1.5 text-sm"
                />
              </label>
              <button
                type="button"
                onClick={() => removeRule(i)}
                className="mt-2 rounded-lg border border-me-stone bg-white px-3 py-1 text-xs font-bold text-me-charcoal"
              >
                删除
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addRule}
            className="rounded-lg border border-me-stone bg-white px-3 py-1.5 text-sm font-bold text-me-charcoal"
          >
            加一条规则
          </button>
        </div>
        <Help>词语要具体，别用单个常见词。</Help>
      </Section>

      <Section title="团目录链接">
        <Help>不填团页链接格式 = 邮件里的团页链接不会被检查（挡不住指向下架团的链接），用团的模板也发不出去。</Help>
        <label className="mb-2 block text-xs">
          <span className="mb-1 block font-bold text-me-charcoal/70">团页链接格式</span>
          <input
            type="text"
            value={form.urlPattern}
            onChange={(e) => update('urlPattern', e.target.value)}
            aria-label="团页链接格式"
            placeholder="要包含 {destination}、{tier}、{slug}"
            className="w-full rounded-lg border border-me-stone bg-white px-2 py-1.5 text-sm"
          />
        </label>
        <label className="block text-xs">
          <span className="mb-1 block font-bold text-me-charcoal/70">全部团页面</span>
          <input
            type="text"
            value={form.allToursUrl}
            onChange={(e) => update('allToursUrl', e.target.value)}
            aria-label="全部团页面"
            className="w-full rounded-lg border border-me-stone bg-white px-2 py-1.5 text-sm"
          />
        </label>
      </Section>

      <Section title="变更说明">
        <input
          type="text"
          value={changeNote}
          onChange={(e) => setChangeNote(e.target.value)}
          aria-label="变更说明"
          placeholder="可选，写一句这次改了什么"
          className="w-full rounded-lg border border-me-stone bg-white px-3 py-2 text-sm"
        />
        {history.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-me-charcoal/70">
            {history.map((h) => (
              <li key={h.version}>
                第 {h.version} 版 · {formatWhen(h.createdAt)} · {h.createdBy}
                {h.changeNote ? ` · ${h.changeNote}` : ''}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {!built.ok && <p className="text-xs font-semibold text-red-700">{built.message}</p>}

      {needsConfirm && (
        <label className="flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-800">
          <input
            type="checkbox"
            checked={confirmUnrestricted}
            onChange={(e) => setConfirmUnrestricted(e.target.checked)}
          />
          <span>我确认：对所有客人放开</span>
        </label>
      )}

      {conflict && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="mb-2">设置刚被别人改过，请重新载入后再改。</p>
          <button
            type="button"
            onClick={() => void fetchSettings()}
            className="rounded-lg border border-me-stone bg-white px-3 py-1.5 text-sm font-bold text-me-charcoal"
          >
            重新载入
          </button>
        </div>
      )}

      {saveError && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-800">
          <ul className="list-disc pl-4">
            {saveError.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {saveOk !== null && (
        <p className="text-xs font-semibold text-green-700">✓ 已保存为第 {saveOk} 版</p>
      )}

      <button
        type="button"
        onClick={() => void save()}
        disabled={!canSave}
        aria-label="保存发信设置"
        className="rounded-lg bg-me-charcoal px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
      >
        {saving ? '保存中…' : '保存设置'}
      </button>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="rounded-xl border border-me-charcoal/10 bg-me-ivory/40 p-3">
      <h3 className="mb-2 text-[13px] font-black text-me-charcoal/70">{title}</h3>
      {children}
    </section>
  )
}

function Help({ children }: { children: React.ReactNode }): JSX.Element {
  return <p className="mt-1 text-xs text-me-charcoal/55">{children}</p>
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}): JSX.Element {
  return (
    <label className="block text-xs">
      <span className="mb-1 block font-bold text-me-charcoal/70">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="w-full rounded-lg border border-me-stone bg-white px-2 py-1.5 text-sm"
      />
    </label>
  )
}
