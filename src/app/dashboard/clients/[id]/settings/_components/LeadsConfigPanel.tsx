'use client'

/**
 * 邮件反应同步开关 + Mailchimp audience id。
 *
 * 开了之后，系统每天自动把「谁收到了、谁打开了、谁点了链接」搬进这个客户的
 * 客人档案 —— 点过链接的人会排到销售名单最前面。
 *
 * 默认关：一个邮件账户可能同时服务好几个客户，全开会把别人的邮件反应
 * 记到这个客户的客人身上。
 *
 * audience id 输入框 2026-09-03 补上：`mailchimp-paid-tagging` 那条 cron
 * （每天把「钱到账了」的客人自动打 `paid_customer` 标签）靠它才知道去
 * Mailchimp 哪个名单里找人，之前这个字段只能改数据库，新客户接进来只能
 * 静默跳过打标签。
 */

import { useCallback, useEffect, useState } from 'react'
import { CAPI_EVENT_CHOICES } from '@/lib/conversions/capi-client-config'

interface Config {
  mailchimpEnabled: boolean
  mailchimpAudienceId: string
  capiAllowedEvents: string[] | null
  capiAllowedEventsMalformed: boolean
}

interface EventDraft {
  restrict: boolean
  names: string[]
}

export function LeadsConfigPanel({ clientId }: { clientId: string }) {
  const [config, setConfig] = useState<Config | null>(null)
  const [audienceIdDraft, setAudienceIdDraft] = useState('')
  const [events, setEvents] = useState<EventDraft>({ restrict: false, names: [] })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const apply = useCallback((next: Config, refreshEvents: boolean) => {
    setConfig(next)
    setAudienceIdDraft(next.mailchimpAudienceId)
    if (refreshEvents) setEvents(eventDraftFrom(next))
  }, [])

  const load = useCallback(async () => {
    setErr(null)
    try {
      apply(await readPanel(clientId), true)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败')
    }
  }, [apply, clientId])

  useEffect(() => { void load() }, [load])

  const save = async (patch: Record<string, unknown>, refreshEvents: boolean) => {
    setSaving(true)
    setErr(null)
    try {
      apply(await writePanel(clientId, patch), refreshEvents)
      setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (config === null && !err) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-400">加载中...</p>
      </div>
    )
  }

  return (
    <PanelView
      clientId={clientId}
      config={config}
      audienceIdDraft={audienceIdDraft}
      events={events}
      saving={saving}
      err={err}
      savedAt={savedAt}
      onAudience={setAudienceIdDraft}
      onEvents={setEvents}
      onSave={(patch, refreshEvents) => void save(patch, refreshEvents)}
    />
  )
}

function PanelView(props: {
  clientId: string
  config: Config | null
  audienceIdDraft: string
  events: EventDraft
  saving: boolean
  err: string | null
  savedAt: string | null
  onAudience: (value: string) => void
  onEvents: (draft: EventDraft) => void
  onSave: (patch: Record<string, unknown>, refreshEvents: boolean) => void
}) {
  const { config, clientId } = props
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={config?.mailchimpEnabled === true}
          disabled={props.saving}
          onChange={(e) => props.onSave({ mailchimpEnabled: e.target.checked }, false)}
          className="mt-1 h-4 w-4 shrink-0 accent-cyan-600"
        />
        <span>
          <span className="block text-sm font-bold text-slate-800">
            把邮件反应同步进这个客户的客人档案
          </span>
          <span className="mt-1 block text-xs leading-relaxed text-slate-500">
            开了之后，系统每天自动记下<strong>谁收到了、谁打开了、谁点了链接</strong>，
            写进每个客人的往来记录。点过链接的人是最热的一批，会排到销售名单最前面。
          </span>
        </span>
      </label>

      <MailAudience
        clientId={clientId}
        value={props.audienceIdDraft}
        saved={config?.mailchimpAudienceId ?? ''}
        saving={props.saving}
        onChange={props.onAudience}
        onSave={() => props.onSave({ mailchimpAudienceId: props.audienceIdDraft.trim() }, false)}
      />

      <EventAllowList
        clientId={clientId}
        draft={props.events}
        malformed={config?.capiAllowedEventsMalformed === true}
        saving={props.saving}
        dirty={eventsDirty(config, props.events)}
        onChange={props.onEvents}
        onSave={() => props.onSave({ capiAllowedEvents: props.events.restrict ? props.events.names : null }, true)}
      />

      {props.err && <p className="mt-2 text-xs text-red-600">⚠ {props.err}</p>}
      {!props.err && props.savedAt && (
        <p className="mt-2 text-xs text-emerald-600">✓ 已保存（{props.savedAt}）</p>
      )}

      <p className="mt-4 border-t border-slate-100 pt-3 text-xs leading-relaxed text-slate-400">
        默认关闭。同一个邮件账户可能同时服务好几个客户 —— 全开会把别人的邮件反应
        记到这个客户的客人身上，所以要一个一个确认。
      </p>
    </div>
  )
}

function MailAudience(props: {
  clientId: string
  value: string
  saved: string
  saving: boolean
  onChange: (value: string) => void
  onSave: () => void
}) {
  return (
    <div className="mt-4 border-t border-slate-100 pt-3">
      <label className="block text-sm font-bold text-slate-800" htmlFor={`mailchimp-audience-${props.clientId}`}>
        Mailchimp audience id
      </label>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        在 Mailchimp 后台 Audience → Settings → Audience name and defaults 里能找到。
        没填的话，付款自动打标签那条每日任务会跳过这个客户。
      </p>
      <div className="mt-2 flex items-center gap-2">
        <input
          id={`mailchimp-audience-${props.clientId}`}
          type="text"
          value={props.value}
          disabled={props.saving}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder="例如 a1b2c3d4e5"
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-800 focus:border-cyan-500 focus:outline-none"
        />
        <button
          type="button"
          disabled={props.saving || props.value.trim() === props.saved}
          onClick={props.onSave}
          className="shrink-0 rounded-lg bg-cyan-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          保存
        </button>
      </div>
    </div>
  )
}

async function readPanel(clientId: string): Promise<Config> {
  const res = await fetch(`/api/clients/${clientId}/leads-config`)
  const json = (await res.json()) as { config?: Partial<Config>; error?: string }
  if (!res.ok) throw new Error(json.error ?? '加载失败')
  return configFrom(json.config)
}

async function writePanel(clientId: string, patch: Record<string, unknown>): Promise<Config> {
  const res = await fetch(`/api/clients/${clientId}/leads-config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  const json = (await res.json()) as { config?: Partial<Config>; error?: string }
  if (!res.ok) throw new Error(json.error ?? '保存失败')
  return configFrom(json.config)
}

function EventAllowList(props: {
  clientId: string
  draft: EventDraft
  malformed: boolean
  saving: boolean
  dirty: boolean
  onChange: (draft: EventDraft) => void
  onSave: () => void
}) {
  return (
    <fieldset className="mt-4 border-t border-slate-100 pt-3">
      <legend className="text-sm font-bold text-slate-800">允许发给广告平台的事</legend>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        不限制 = 跟现在一样。勾选之后，没勾上的先停在排队里。一个都不勾，是全部先不发，跟「不限制」不是一回事。
      </p>
      <EventMode clientId={props.clientId} draft={props.draft} saving={props.saving} onChange={props.onChange} />
      {props.draft.restrict && (
        <EventChecks draft={props.draft} saving={props.saving} onChange={props.onChange} />
      )}
      {props.malformed && (
        <p className="mt-2 text-xs text-amber-700">允许发送的名单之前存坏了，请重新选一次再保存。在这之前先不发。</p>
      )}
      <button
        type="button"
        disabled={props.saving || !props.dirty}
        onClick={props.onSave}
        className="mt-2 rounded-lg bg-cyan-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
      >
        保存发送名单
      </button>
    </fieldset>
  )
}

function EventMode(props: {
  clientId: string
  draft: EventDraft
  saving: boolean
  onChange: (draft: EventDraft) => void
}) {
  return (
    <>
      <label className="mt-2 flex items-start gap-2 text-sm text-slate-700">
        <input
          type="radio"
          name={`capi-events-${props.clientId}`}
          checked={!props.draft.restrict}
          disabled={props.saving}
          onChange={() => props.onChange({ ...props.draft, restrict: false })}
          className="mt-1"
        />
        不限制（没填名单，该发的都会发）
      </label>
      <label className="mt-1 flex items-start gap-2 text-sm text-slate-700">
        <input
          type="radio"
          name={`capi-events-${props.clientId}`}
          checked={props.draft.restrict}
          disabled={props.saving}
          onChange={() => props.onChange({ ...props.draft, restrict: true })}
          className="mt-1"
        />
        只发勾选的
      </label>
    </>
  )
}

function EventChecks(props: { draft: EventDraft; saving: boolean; onChange: (draft: EventDraft) => void }) {
  const toggle = (name: string) => {
    const names = props.draft.names.includes(name)
      ? props.draft.names.filter((item) => item !== name)
      : [...props.draft.names, name]
    props.onChange({ ...props.draft, names })
  }
  return (
    <div className="mt-2 space-y-1 pl-6">
      {CAPI_EVENT_CHOICES.map((choice) => (
        <label key={choice.name} className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={props.draft.names.includes(choice.name)}
            disabled={props.saving}
            onChange={() => toggle(choice.name)}
          />
          {choice.label}
        </label>
      ))}
      {props.draft.names.length === 0 && (
        <p className="text-xs text-amber-700">一项都没勾。保存之后全部先不发。</p>
      )}
    </div>
  )
}

function configFrom(raw: Partial<Config> | undefined): Config {
  return {
    mailchimpEnabled: raw?.mailchimpEnabled === true,
    mailchimpAudienceId: raw?.mailchimpAudienceId ?? '',
    capiAllowedEvents: Array.isArray(raw?.capiAllowedEvents) ? raw.capiAllowedEvents : null,
    capiAllowedEventsMalformed: raw?.capiAllowedEventsMalformed === true,
  }
}

function eventDraftFrom(config: Config): EventDraft {
  const hasList = config.capiAllowedEvents != null
  return {
    restrict: config.capiAllowedEventsMalformed || hasList,
    names: config.capiAllowedEvents ?? [],
  }
}

function eventsDirty(config: Config | null, draft: EventDraft): boolean {
  if (!config) return false
  if (config.capiAllowedEventsMalformed) return true
  const savedRestrict = config.capiAllowedEvents != null
  if (draft.restrict !== savedRestrict) return true
  if (!draft.restrict) return false
  const saved = [...(config.capiAllowedEvents ?? [])].sort().join('\0')
  return [...draft.names].sort().join('\0') !== saved
}
