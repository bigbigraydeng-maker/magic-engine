'use client'

import { useId, useState } from 'react'
import type { CatalogSettings, SettingsErrorCode, SettingsRequest } from '@/lib/tour-catalog/catalog-contract'
import { BRAND_BUTTON_CLASS, isHexColor } from './catalog-brand'

export const SETTINGS_ERROR_TEXTS: Record<SettingsErrorCode, string> = {
  invalid_request: '填写的内容不完整，请检查后再保存',
  invalid_color: '颜色要写成 # 加 6 位，例如 #336699',
  invalid_logo_url: 'logo 地址必须以 https:// 开头',
  logo_not_on_client_domain: 'logo 地址必须在这个客户自己的官网域名下',
  save_failed: '没有保存成功，请稍后再试',
}

export function settingsErrorText(code: string | undefined): string {
  if (code && code in SETTINGS_ERROR_TEXTS) {
    return SETTINGS_ERROR_TEXTS[code as SettingsErrorCode]
  }
  return SETTINGS_ERROR_TEXTS.save_failed
}

export const CONNECT_CONFIRM_TEXT =
  '打开后，页面会告诉使用者上架就会改动官网。只有真的接通了才打开。确定吗？'
export const SETTINGS_SAVED_TEXT = '已保存'

const INPUT_CLASS =
  'rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal focus:outline-none focus:ring-2 focus:ring-me-ochre/40'
const SECONDARY_BUTTON_CLASS =
  'rounded-lg border border-black/10 bg-white px-3 py-1 text-sm font-semibold text-me-charcoal hover:bg-me-ivory'
const PRIMARY_BUTTON_CLASS = `${BRAND_BUTTON_CLASS} rounded-lg px-4 py-2 text-sm font-black disabled:cursor-not-allowed disabled:opacity-40`

interface ColorFieldProps {
  label: string
  pickerLabel: string
  clearLabel: string
  value: string
  onChange: (value: string) => void
  helpText?: string
}

function ColorField(props: ColorFieldProps) {
  const { label, pickerLabel, clearLabel, value, onChange, helpText } = props
  const inputId = useId()
  return (
    <div className="min-w-0">
      <label htmlFor={inputId} className="block text-sm font-semibold text-me-charcoal">
        {label}
      </label>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <input
          id={inputId}
          type="text"
          placeholder="#RRGGBB"
          className={`min-w-0 flex-1 ${INPUT_CLASS}`}
          value={value}
          onChange={event => onChange(event.target.value)}
        />
        <input
          type="color"
          aria-label={pickerLabel}
          className="h-9 w-12 rounded-lg border border-black/10 bg-white"
          value={isHexColor(value) ? value : '#000000'}
          onChange={event => onChange(event.target.value)}
        />
        <button type="button" className={SECONDARY_BUTTON_CLASS} aria-label={clearLabel} onClick={() => onChange('')}>
          清空
        </button>
      </div>
      {helpText ? <p className="mt-1 text-xs text-me-charcoal/55">{helpText}</p> : null}
    </div>
  )
}

interface SettingsFormValues {
  logoUrl: string
  brandPrimary: string
  brandSecondary: string
  channelsConnected: boolean
}

export function validateSettings(values: SettingsFormValues): string | null {
  const trimmedPrimary = values.brandPrimary.trim()
  const trimmedSecondary = values.brandSecondary.trim()
  const trimmedLogo = values.logoUrl.trim()
  if (trimmedPrimary && !isHexColor(trimmedPrimary)) return SETTINGS_ERROR_TEXTS.invalid_color
  if (trimmedSecondary && !isHexColor(trimmedSecondary)) return SETTINGS_ERROR_TEXTS.invalid_color
  if (trimmedLogo && !trimmedLogo.startsWith('https://')) return SETTINGS_ERROR_TEXTS.invalid_logo_url
  return null
}

function buildSettingsRequest(values: SettingsFormValues, imageHosts: string[]): SettingsRequest {
  return {
    // Not edited on this card: sent back as they are, otherwise saving the brand would empty the list.
    imageHosts,
    logoUrl: values.logoUrl.trim() || null,
    brandPrimary: values.brandPrimary.trim() || null,
    brandSecondary: values.brandSecondary.trim() || null,
    channelsConnected: values.channelsConnected,
  }
}

export async function putSettings(clientId: string, body: SettingsRequest): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/clients/${clientId}/tour-catalog/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const parsed = (await res.json().catch(() => ({}))) as { error?: string }
      return { ok: false, error: parsed.error }
    }
    return { ok: true }
  } catch {
    return { ok: false, error: 'save_failed' }
  }
}

function useBrandSettingsForm(clientId: string, settings: CatalogSettings, onSaved: () => void) {
  const [logoUrl, setLogoUrl] = useState(settings.logoUrl ?? '')
  const [brandPrimary, setBrandPrimary] = useState(settings.brandPrimary ?? '')
  const [brandSecondary, setBrandSecondary] = useState(settings.brandSecondary ?? '')
  const [channelsConnected, setChannelsConnected] = useState(settings.channelsConnected)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  function toggleConnected(next: boolean) {
    if (next && !window.confirm(CONNECT_CONFIRM_TEXT)) return
    setChannelsConnected(next)
  }

  async function save() {
    const values: SettingsFormValues = { logoUrl, brandPrimary, brandSecondary, channelsConnected }
    const validationError = validateSettings(values)
    if (validationError) {
      setSaved(false)
      setError(validationError)
      return
    }
    setError(null)
    setSaved(false)
    setSaving(true)
    const result = await putSettings(clientId, buildSettingsRequest(values, settings.imageHosts ?? []))
    setSaving(false)
    if (!result.ok) return setError(settingsErrorText(result.error))
    setSaved(true)
    onSaved()
  }

  return {
    logoUrl,
    setLogoUrl,
    brandPrimary,
    setBrandPrimary,
    brandSecondary,
    setBrandSecondary,
    channelsConnected,
    toggleConnected,
    error,
    saved,
    saving,
    save,
  }
}

function LogoField(props: { value: string; onChange: (value: string) => void }) {
  const logoId = useId()
  return (
    <div className="min-w-0">
      <label htmlFor={logoId} className="block text-sm font-semibold text-me-charcoal">
        logo 地址
      </label>
      <input
        id={logoId}
        type="url"
        placeholder="https://"
        className={`mt-1 w-full ${INPUT_CLASS}`}
        value={props.value}
        onChange={event => props.onChange(event.target.value)}
      />
      <p className="mt-1 text-xs text-me-charcoal/55">必须是 https，并且在这个客户自己的官网域名下</p>
    </div>
  )
}

function ConnectSwitch(props: { checked: boolean; onChange: (next: boolean) => void }) {
  const connectId = useId()
  return (
    <div className="flex items-start gap-2">
      <input
        id={connectId}
        type="checkbox"
        className="mt-1 h-4 w-4"
        checked={props.checked}
        onChange={event => props.onChange(event.target.checked)}
      />
      <label htmlFor={connectId} className="text-sm font-semibold text-me-charcoal">
        官网等渠道已经接通，读的是这里的上架内容
      </label>
    </div>
  )
}

function SaveFeedback(props: { error: string | null; saved: boolean }) {
  return (
    <>
      {props.error ? (
        <p role="alert" className="mt-3 text-sm font-semibold text-[#C2453A]">
          {props.error}
        </p>
      ) : null}
      {props.saved ? (
        <p role="status" className="mt-3 text-sm font-semibold text-[#456F35]">
          {SETTINGS_SAVED_TEXT}
        </p>
      ) : null}
    </>
  )
}

export function CatalogBrandSettingsCard(props: {
  clientId: string
  settings: CatalogSettings
  onSaved: () => void
}): JSX.Element {
  const { clientId, settings, onSaved } = props
  const form = useBrandSettingsForm(clientId, settings, onSaved)

  return (
    <section className="rounded-xl border border-black/10 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-black text-me-charcoal">页面品牌与状态</h2>

      <div className="mt-4 space-y-4">
        <LogoField value={form.logoUrl} onChange={form.setLogoUrl} />

        <ColorField
          label="主色"
          pickerLabel="主色取色器"
          clearLabel="清空主色"
          value={form.brandPrimary}
          onChange={form.setBrandPrimary}
        />

        <ColorField
          label="辅助色"
          pickerLabel="辅助色取色器"
          clearLabel="清空辅助色"
          value={form.brandSecondary}
          onChange={form.setBrandSecondary}
          helpText="辅助色只用于细线和小标签"
        />

        <ConnectSwitch checked={form.channelsConnected} onChange={form.toggleConnected} />
      </div>

      <SaveFeedback error={form.error} saved={form.saved} />

      <div className="mt-4">
        <button
          type="button"
          className={PRIMARY_BUTTON_CLASS}
          disabled={form.saving}
          onClick={() => void form.save()}
        >
          {form.saving ? '正在保存…' : '保存'}
        </button>
      </div>
    </section>
  )
}
