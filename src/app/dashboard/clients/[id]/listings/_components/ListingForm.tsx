'use client'

/**
 * 建档 / 编辑一套房的表单。
 *
 * 下拉的取值全部来自 lib/listings/constants —— 跟后端校验同一份,不在这里
 * 手写字符串字面量,否则前端能选后端不认。
 *
 * 表单只管收集和提交,不自己判断合法性(除了「地址不能空」这条即时反馈):
 * 真正的闸门在后端,前端再校验一遍只会出现两套规则慢慢走偏。
 */

import { useState } from 'react'
import {
  PROPERTY_TYPE_OPTIONS,
  PRICE_BAND_OPTIONS,
  LISTING_STATUS_OPTIONS,
  DEFAULT_LISTING_STATUS,
} from '@/lib/listings/constants'
import type { ListingWithCount } from '@/lib/listings/queries'

interface Props {
  clientId: string
  /** 传了就是编辑,不传就是新建。 */
  existing?: ListingWithCount | null
  onSaved: (listing: ListingWithCount) => void
  onCancel: () => void
}

interface FormState {
  address_line: string
  suburb: string
  city: string
  property_type: string
  bedrooms: string
  price_band: string
  status: string
  listed_on: string
  delisted_on: string
  sold_on: string
  sold_price: string
  external_ref: string
  vendor_notes: string
}

function initialState(existing?: ListingWithCount | null): FormState {
  return {
    address_line:  existing?.address_line ?? '',
    suburb:        existing?.suburb ?? '',
    city:          existing?.city ?? '',
    property_type: existing?.property_type ?? '',
    bedrooms:      existing?.bedrooms != null ? String(existing.bedrooms) : '',
    price_band:    existing?.price_band ?? '',
    status:        existing?.status ?? DEFAULT_LISTING_STATUS,
    listed_on:     existing?.listed_on ?? '',
    delisted_on:   existing?.delisted_on ?? '',
    sold_on:       existing?.sold_on ?? '',
    sold_price:    existing?.sold_price != null ? String(existing.sold_price) : '',
    external_ref:  existing?.external_ref ?? '',
    vendor_notes:  existing?.vendor_notes ?? '',
  }
}

const INPUT_CLS =
  'w-full rounded-lg border border-black/12 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal focus:border-me-ochre focus:outline-none focus:ring-2 focus:ring-me-ochre/20'
const LABEL_CLS = 'mb-1 block text-[11px] font-black uppercase tracking-[.1em] text-me-charcoal/45'

export function ListingForm({ clientId, existing, onSaved, onCancel }: Props) {
  const [form, setForm]     = useState<FormState>(() => initialState(existing))
  const [saving, setSaving] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  const isEdit = !!existing
  const set = <K extends keyof FormState>(key: K, value: string) =>
    setForm(prev => ({ ...prev, [key]: value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setErrMsg(null)
    try {
      const url = isEdit ? `/api/listings/${existing.id}` : `/api/clients/${clientId}/listings`
      const res = await fetch(url, {
        method:  isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(form),
      })
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(error ?? `HTTP ${res.status}`)
      }
      const { listing } = (await res.json()) as { listing: ListingWithCount }
      // 编辑接口不回人数(它不查 contacts),沿用原来那个数,别把已有的数字冲成 0。
      onSaved({ ...listing, contact_count: listing.contact_count ?? existing?.contact_count ?? 0 })
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-black/10 bg-white p-5 shadow-sm"
    >
      <h2 className="mb-4 font-display text-lg font-black text-me-charcoal">
        {isEdit ? '编辑这套房' : '建一套新房'}
      </h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={LABEL_CLS} htmlFor="lf-address">门牌 + 街道（必填）</label>
          <input
            id="lf-address"
            className={INPUT_CLS}
            value={form.address_line}
            onChange={e => set('address_line', e.target.value)}
            placeholder="30 Kiteroa Place"
            required
          />
        </div>

        <div>
          <label className={LABEL_CLS} htmlFor="lf-suburb">郊区</label>
          <input
            id="lf-suburb"
            className={INPUT_CLS}
            value={form.suburb}
            onChange={e => set('suburb', e.target.value)}
            placeholder="Rothesay Bay"
          />
        </div>

        <div>
          <label className={LABEL_CLS} htmlFor="lf-city">城市</label>
          <input
            id="lf-city"
            className={INPUT_CLS}
            value={form.city}
            onChange={e => set('city', e.target.value)}
            placeholder="Auckland"
          />
        </div>

        <div>
          <label className={LABEL_CLS} htmlFor="lf-type">房型</label>
          <select
            id="lf-type"
            className={INPUT_CLS}
            value={form.property_type}
            onChange={e => set('property_type', e.target.value)}
          >
            <option value="">（未填）</option>
            {PROPERTY_TYPE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={LABEL_CLS} htmlFor="lf-beds">卧室数</label>
          <input
            id="lf-beds"
            type="number"
            min={0}
            max={100}
            step={1}
            className={INPUT_CLS}
            value={form.bedrooms}
            onChange={e => set('bedrooms', e.target.value)}
            placeholder="4"
          />
        </div>

        <div>
          <label className={LABEL_CLS} htmlFor="lf-band">价格档</label>
          <select
            id="lf-band"
            className={INPUT_CLS}
            value={form.price_band}
            onChange={e => set('price_band', e.target.value)}
          >
            <option value="">（未填）</option>
            {PRICE_BAND_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <p className="mt-1 text-[11px] font-semibold text-me-charcoal/40">
            只存档位不存具体数字 —— 很多房子不公开要价，编一个数字比留档位更糟。
          </p>
        </div>

        <div>
          <label className={LABEL_CLS} htmlFor="lf-status">现在到哪一步</label>
          <select
            id="lf-status"
            className={INPUT_CLS}
            value={form.status}
            onChange={e => set('status', e.target.value)}
          >
            {LISTING_STATUS_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <p className="mt-1 text-[11px] font-semibold text-me-charcoal/40">
            {LISTING_STATUS_OPTIONS.find(o => o.value === form.status)?.hint ?? ''}
          </p>
        </div>

        <div>
          <label className={LABEL_CLS} htmlFor="lf-listed">上市日期</label>
          <input
            id="lf-listed"
            type="date"
            className={INPUT_CLS}
            value={form.listed_on}
            onChange={e => set('listed_on', e.target.value)}
          />
        </div>

        <div>
          <label className={LABEL_CLS} htmlFor="lf-delisted">撤下日期</label>
          <input
            id="lf-delisted"
            type="date"
            className={INPUT_CLS}
            value={form.delisted_on}
            onChange={e => set('delisted_on', e.target.value)}
          />
        </div>

        <div>
          <label className={LABEL_CLS} htmlFor="lf-soldon">成交日期</label>
          <input
            id="lf-soldon"
            type="date"
            className={INPUT_CLS}
            value={form.sold_on}
            onChange={e => set('sold_on', e.target.value)}
          />
        </div>

        <div>
          <label className={LABEL_CLS} htmlFor="lf-soldprice">成交价</label>
          <input
            id="lf-soldprice"
            type="number"
            min={0}
            step="0.01"
            className={INPUT_CLS}
            value={form.sold_price}
            onChange={e => set('sold_price', e.target.value)}
            placeholder="卖掉之后才填"
          />
        </div>

        <div>
          <label className={LABEL_CLS} htmlFor="lf-ref">外部编号</label>
          <input
            id="lf-ref"
            className={INPUT_CLS}
            value={form.external_ref}
            onChange={e => set('external_ref', e.target.value)}
            placeholder="客户自己系统里的编号，对账用"
          />
        </div>

        <div className="sm:col-span-2">
          <label className={LABEL_CLS} htmlFor="lf-notes">备注</label>
          <textarea
            id="lf-notes"
            rows={3}
            className={INPUT_CLS}
            value={form.vendor_notes}
            onChange={e => set('vendor_notes', e.target.value)}
            placeholder="卖家情况、内部提醒⋯⋯只给自己人看"
          />
        </div>
      </div>

      {errMsg && (
        <p className="mt-4 rounded-lg border border-[#C2453A]/30 bg-[#C2453A]/8 px-3 py-2 text-xs font-bold text-[#C2453A]">
          ⚠ {errMsg}
        </p>
      )}

      <div className="mt-5 flex items-center gap-3">
        <button
          type="submit"
          disabled={saving || form.address_line.trim().length === 0}
          className="rounded-lg bg-me-charcoal px-5 py-2 text-sm font-black text-white hover:bg-me-charcoal/85 disabled:cursor-not-allowed disabled:bg-black/20"
        >
          {saving ? '保存中…' : isEdit ? '保存修改' : '建档'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="text-xs font-bold text-me-charcoal/50 hover:text-me-charcoal"
        >
          取消
        </button>
      </div>
    </form>
  )
}
