'use client'

import { useState } from 'react'
import type { CatalogSettings, ImageHostSuggestion } from '@/lib/tour-catalog/catalog-contract'
import { putSettings } from './CatalogBrandSettingsCard'
import { BRAND_BUTTON_CLASS } from './catalog-brand'
import { inputClass, smallButtonClass } from './editor-parts'

export const IMAGE_HOSTS_MAX = 10
export const IMAGE_HOSTS_HELP = '只填域名，不带 https:// 和路径；至多 10 个'
export const IMAGE_HOST_BAD_TEXT = '只填域名，例如 images.example.com，不带 https:// 和路径'
export const IMAGE_HOSTS_FULL_TEXT = '名单最多 10 个，已经到上限'
export const IMAGE_HOSTS_SAVED_TEXT = '已保存'
export const IMAGE_HOSTS_SAVE_FAILED_TEXT = '没有保存成功，请稍后再试'
export const IMAGE_HOSTS_INVALID_TEXT = '名单里有写法不对的域名，请检查后再保存'

const HOST_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/
const IP_PATTERN = /^[0-9.]+$/

function isValidHost(value: string): boolean {
  return HOST_PATTERN.test(value) && !IP_PATTERN.test(value)
}

/** The other settings are not edited on this card: they go back exactly as they came. */
function brandOf(settings: CatalogSettings): Omit<CatalogSettings, 'imageHosts'> {
  return {
    logoUrl: settings.logoUrl,
    brandPrimary: settings.brandPrimary,
    brandSecondary: settings.brandSecondary,
    channelsConnected: settings.channelsConnected,
  }
}

/** Why this host cannot be added, or null when it can. */
function addRefusal(value: string, hosts: string[]): string | null {
  if (!isValidHost(value)) return IMAGE_HOST_BAD_TEXT
  if (hosts.length >= IMAGE_HOSTS_MAX) return IMAGE_HOSTS_FULL_TEXT
  return null
}

interface HostsState {
  hosts: string[]
  draft: string
  error: string | null
  saved: boolean
  saving: boolean
  setDraft: (value: string) => void
  addHost: (raw: string) => void
  removeHost: (host: string) => void
  save: () => Promise<void>
}

function useImageHosts(
  clientId: string,
  settings: CatalogSettings,
  onSaved: () => void,
): HostsState {
  const [hosts, setHosts] = useState<string[]>(settings.imageHosts ?? [])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  function addHost(raw: string): void {
    const value = raw.trim().toLowerCase()
    if (value.length === 0) return
    if (hosts.includes(value)) return setDraft('')
    const refusal = addRefusal(value, hosts)
    if (refusal) return setError(refusal)
    setHosts([...hosts, value])
    setDraft('')
    setError(null)
    setSaved(false)
  }

  function removeHost(host: string): void {
    setHosts(hosts.filter((h) => h !== host))
    setSaved(false)
  }

  async function save(): Promise<void> {
    setSaving(true)
    setError(null)
    const result = await putSettings(clientId, { ...brandOf(settings), imageHosts: hosts })
    setSaving(false)
    if (result.ok) {
      setSaved(true)
      onSaved()
      return
    }
    const code = result.error ?? ''
    const badList = code.includes('host') || code === 'invalid_request'
    setError(badList ? IMAGE_HOSTS_INVALID_TEXT : IMAGE_HOSTS_SAVE_FAILED_TEXT)
  }

  return { hosts, draft, error, saved, saving, setDraft, addHost, removeHost, save }
}

function HostList({ hosts, onRemove }: { hosts: string[]; onRemove: (host: string) => void }) {
  if (hosts.length === 0) {
    return <p className="mt-3 text-sm text-me-charcoal/60">名单还是空的。</p>
  }
  return (
    <ul data-testid="image-hosts" className="mt-3 space-y-1">
      {hosts.map((host) => (
        <li
          key={host}
          className="flex items-center justify-between gap-2 text-sm font-semibold text-me-charcoal"
        >
          <span className="min-w-0 break-all">{host}</span>
          <button
            type="button"
            aria-label={`移除 ${host}`}
            onClick={() => onRemove(host)}
            className={smallButtonClass}
          >
            移除
          </button>
        </li>
      ))}
    </ul>
  )
}

function AddHostRow({
  draft,
  onDraftChange,
  onAdd,
}: {
  draft: string
  onDraftChange: (value: string) => void
  onAdd: () => void
}) {
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <input
          aria-label="新的图片来源域名"
          placeholder="images.example.com"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          className={`min-w-0 flex-1 ${inputClass}`}
        />
        <button type="button" onClick={onAdd} className={smallButtonClass}>
          加入
        </button>
      </div>
      <p className="mt-1 text-xs text-me-charcoal/60">{IMAGE_HOSTS_HELP}</p>
    </div>
  )
}

function SuggestionList({
  suggestions,
  hosts,
  onAdd,
}: {
  suggestions: ImageHostSuggestion[]
  hosts: string[]
  onAdd: (host: string) => void
}) {
  const pending = suggestions.filter((s) => !hosts.includes(s.host))
  if (pending.length === 0) return null
  return (
    <div data-testid="image-host-suggestions" className="mt-4">
      <p className="text-sm font-semibold text-me-charcoal">
        目录里已经在用、但还不在名单里的图片来源：
      </p>
      <ul className="mt-2 space-y-1">
        {pending.map((s) => (
          <li
            key={s.host}
            className="flex items-center justify-between gap-2 text-sm text-me-charcoal"
          >
            <span className="min-w-0 break-all">
              {s.host}（{s.count} 张）
            </span>
            <button
              type="button"
              aria-label={`把 ${s.host} 加入名单`}
              onClick={() => onAdd(s.host)}
              className={smallButtonClass}
            >
              加入名单
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function CatalogImageHostsCard(props: {
  clientId: string
  settings: CatalogSettings
  suggestions?: ImageHostSuggestion[]
  onSaved: () => void
}): JSX.Element {
  const { clientId, settings, suggestions, onSaved } = props
  const state = useImageHosts(clientId, settings, onSaved)

  return (
    <section className="rounded-xl border border-black/10 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-black text-me-charcoal">允许的图片来源</h2>
      <p className="mt-1 text-xs text-me-charcoal/60">
        外部图片只有来自这份名单里的域名（或客户自己的官网域名）才能填进团里。
      </p>
      <HostList hosts={state.hosts} onRemove={state.removeHost} />
      <AddHostRow
        draft={state.draft}
        onDraftChange={state.setDraft}
        onAdd={() => state.addHost(state.draft)}
      />
      <SuggestionList
        suggestions={suggestions ?? []}
        hosts={state.hosts}
        onAdd={state.addHost}
      />
      {state.error ? (
        <p role="alert" className="mt-3 text-sm font-semibold text-[#C2453A]">
          {state.error}
        </p>
      ) : null}
      {state.saved ? (
        <p role="status" className="mt-3 text-sm font-semibold text-[#456F35]">
          {IMAGE_HOSTS_SAVED_TEXT}
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => void state.save()}
        disabled={state.saving}
        className={`${BRAND_BUTTON_CLASS} mt-4 rounded-lg px-4 py-2 text-sm font-black disabled:cursor-not-allowed disabled:opacity-40`}
      >
        {state.saving ? '正在保存…' : '保存图片来源'}
      </button>
    </section>
  )
}
