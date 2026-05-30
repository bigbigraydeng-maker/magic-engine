'use client';

import { useState, useEffect } from 'react';

interface LocaleData {
  country: 'AU' | 'NZ';
  state_code: string | null;
  city: string | null;
  business_scope: 'local' | 'state' | 'national';
  locale_confirmed_at: string | null;
}

const AU_STATES: { code: string; label: string }[] = [
  { code: 'VIC', label: 'Victoria' },
  { code: 'NSW', label: 'New South Wales' },
  { code: 'QLD', label: 'Queensland' },
  { code: 'WA',  label: 'Western Australia' },
  { code: 'SA',  label: 'South Australia' },
  { code: 'TAS', label: 'Tasmania' },
  { code: 'ACT', label: 'Australian Capital Territory' },
  { code: 'NT',  label: 'Northern Territory' },
]

const NZ_REGIONS: { code: string; label: string }[] = [
  { code: 'AKL', label: 'Auckland' },
  { code: 'WLG', label: 'Wellington' },
  { code: 'CAN', label: 'Canterbury' },
  { code: 'WKO', label: 'Waikato' },
  { code: 'OTG', label: 'Otago' },
  { code: 'HKB', label: "Hawke's Bay" },
  { code: 'NLS', label: 'Nelson' },
  { code: 'MBR', label: 'Marlborough' },
  { code: 'STH', label: 'Southland' },
  { code: 'TRK', label: 'Taranaki' },
]

const SCOPE_OPTIONS: { value: 'local' | 'state' | 'national'; label: string; desc: string }[] = [
  { value: 'local',    label: '本地',  desc: '仅服务本城市/本区' },
  { value: 'state',    label: '州级',  desc: '服务整个州/省' },
  { value: 'national', label: '全国',  desc: '服务全澳/全新西兰' },
]

export function LocaleConfirmBanner({ clientId, onConfirmed }: {
  clientId: string
  onConfirmed?: () => void
}) {
  const [locale, setLocale] = useState<LocaleData | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  // Form state
  const [country, setCountry] = useState<'AU' | 'NZ'>('AU')
  const [stateCode, setStateCode] = useState<string>('')
  const [city, setCity] = useState<string>('')
  const [scope, setScope] = useState<'local' | 'state' | 'national'>('local')

  useEffect(() => {
    fetch(`/api/clients/${clientId}/locale`)
      .then(r => r.json())
      .then(d => {
        if (d.locale) {
          setLocale(d.locale)
          setCountry(d.locale.country ?? 'AU')
          setStateCode(d.locale.state_code ?? '')
          setCity(d.locale.city ?? '')
          setScope(d.locale.business_scope ?? 'local')
        }
      })
      .catch(() => {})
  }, [clientId])

  // Don't show if already confirmed or dismissed
  if (!locale || locale.locale_confirmed_at || dismissed) return null

  const stateOptions = country === 'AU' ? AU_STATES : NZ_REGIONS
  const stateLabel = country === 'AU' ? '州/地区' : '省/地区'

  async function handleConfirm() {
    setSaving(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/locale`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          country,
          state_code: stateCode || null,
          city:       city.trim() || null,
          business_scope: scope,
          confirm: true,
        }),
      })
      if (res.ok) {
        setShowModal(false)
        setLocale(prev => prev ? { ...prev, locale_confirmed_at: new Date().toISOString() } : prev)
        onConfirmed?.()
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {/* Banner */}
      <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
        <span className="text-amber-500 text-base">📍</span>
        <span className="text-amber-800 font-medium">
          请确认您的业务地域信息，帮助我们生成更准确的营销内容
        </span>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => setShowModal(true)}
            className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700"
          >
            去确认 →
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="rounded-md border border-amber-200 px-2 py-1.5 text-xs text-amber-600 hover:bg-amber-100"
          >
            稍后
          </button>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-1 text-lg font-black text-slate-900">请确认业务地域信息</h2>
            <p className="mb-5 text-sm text-slate-500">
              确认后，系统将自动注入当地节假日、季节信号和营销氛围，让 AI 生成的内容更贴近您的市场。
            </p>

            {/* Country */}
            <div className="mb-4">
              <label className="mb-1.5 block text-xs font-bold text-slate-600 uppercase tracking-wide">国家</label>
              <div className="flex gap-2">
                {(['AU','NZ'] as const).map(c => (
                  <button
                    key={c}
                    onClick={() => { setCountry(c); setStateCode('') }}
                    className={`flex-1 rounded-lg border py-2 text-sm font-bold transition-colors ${
                      country === c
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    {c === 'AU' ? '🇦🇺 Australia' : '🇳🇿 New Zealand'}
                  </button>
                ))}
              </div>
            </div>

            {/* State */}
            <div className="mb-4">
              <label className="mb-1.5 block text-xs font-bold text-slate-600 uppercase tracking-wide">{stateLabel}</label>
              <select
                value={stateCode}
                onChange={e => setStateCode(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none"
              >
                <option value="">— 请选择 —</option>
                {stateOptions.map(s => (
                  <option key={s.code} value={s.code}>{s.label}</option>
                ))}
              </select>
            </div>

            {/* City */}
            <div className="mb-4">
              <label className="mb-1.5 block text-xs font-bold text-slate-600 uppercase tracking-wide">城市</label>
              <input
                type="text"
                value={city}
                onChange={e => setCity(e.target.value)}
                placeholder="e.g. Melbourne, Auckland CBD"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-indigo-400 focus:outline-none"
              />
            </div>

            {/* Business scope */}
            <div className="mb-6">
              <label className="mb-1.5 block text-xs font-bold text-slate-600 uppercase tracking-wide">业务范围</label>
              <div className="flex gap-2">
                {SCOPE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setScope(opt.value)}
                    className={`flex-1 rounded-lg border px-2 py-2 text-center transition-colors ${
                      scope === opt.value
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <div className="text-sm font-bold">{opt.label}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                onClick={handleConfirm}
                disabled={saving}
                className="flex-1 rounded-lg bg-indigo-600 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? '保存中…' : '确认，信息正确 ✓'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
