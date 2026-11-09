'use client'

/**
 * 发信设置里的「目录」四个框（模板代号 / 版本号 / 网址 / 有效期），和保存时 providers 的组装。
 * 设计稿：docs/specs/2026-11-09-crm-catalogue-send-b0-b3-design-v0.md §3.7
 *
 * providers 里面板不认识的键原样带回去：以后服务端加新的 provider，旧面板保存一次也不会把它悄悄删掉。
 */

import React from 'react'

export interface StoredCatalogue {
  template_key: string
  version_label: string
  url: string
  valid_until: string
}

export interface CatalogueForm {
  catalogueTemplateKey: string
  catalogueVersionLabel: string
  catalogueUrl: string
  catalogueValidUntil: string
}

export const EMPTY_CATALOGUE_FORM: CatalogueForm = {
  catalogueTemplateKey: '',
  catalogueVersionLabel: '',
  catalogueUrl: '',
  catalogueValidUntil: '',
}

const KNOWN_PROVIDER_KEYS = ['published_tours', 'catalogue']

function isStoredCatalogue(value: unknown): value is StoredCatalogue {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return ['template_key', 'version_label', 'url', 'valid_until'].every((k) => typeof v[k] === 'string')
}

export function catalogueFormFrom(providers: Record<string, unknown>): CatalogueForm {
  const c = providers.catalogue
  if (!isStoredCatalogue(c)) return EMPTY_CATALOGUE_FORM
  return {
    catalogueTemplateKey: c.template_key,
    catalogueVersionLabel: c.version_label,
    catalogueUrl: c.url,
    catalogueValidUntil: c.valid_until,
  }
}

/** The provider keys this panel has no fields for, kept exactly as they were loaded. */
export function otherProviders(providers: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(providers).filter(([key]) => !KNOWN_PROVIDER_KEYS.includes(key)))
}

/** All four empty = no catalogue. Any one filled = send all four, and let the server say what is wrong. */
export function catalogueFromForm(form: CatalogueForm): StoredCatalogue | null {
  const out: StoredCatalogue = {
    template_key: form.catalogueTemplateKey.trim(),
    version_label: form.catalogueVersionLabel.trim(),
    url: form.catalogueUrl.trim(),
    valid_until: form.catalogueValidUntil.trim(),
  }
  return Object.values(out).every((v) => v === '') ? null : out
}

const FIELDS: Array<{ key: keyof CatalogueForm; label: string; placeholder: string; type: 'text' | 'date' }> = [
  { key: 'catalogueTemplateKey', label: '目录信用哪个模板（模板代号）', placeholder: '例如 catalogue-send', type: 'text' },
  { key: 'catalogueVersionLabel', label: '手册版本号', placeholder: '例如 v9', type: 'text' },
  { key: 'catalogueUrl', label: '手册网址', placeholder: 'https://…', type: 'text' },
  { key: 'catalogueValidUntil', label: '有效期到（含当天）', placeholder: '', type: 'date' },
]

export function CatalogueFields(props: {
  form: CatalogueForm
  onChange: (key: keyof CatalogueForm, value: string) => void
}): JSX.Element {
  return (
    <div className="space-y-2">
      {FIELDS.map((f) => (
        <label key={f.key} className="block text-xs">
          <span className="mb-1 block font-bold text-me-charcoal/70">{f.label}</span>
          <input
            type={f.type}
            value={props.form[f.key]}
            onChange={(e) => props.onChange(f.key, e.target.value)}
            aria-label={f.label}
            placeholder={f.placeholder}
            className="w-full rounded-lg border border-me-stone bg-white px-2 py-1.5 text-sm"
          />
        </label>
      ))}
      <p className="text-xs text-me-charcoal/55">
        四个框都空 = 不开「一键发目录」。过了有效期，任何一封信都发不出这个网址，直到换上新手册。网址的域名要在上面的「允许的链接」里；目录信永远算进每周上限。注意：系统只拦这里填着的那个网址——换新手册网址、或清空这四个框之后，旧网址就不再被拦，所以旧文件要先从网上撤下。
      </p>
    </div>
  )
}
