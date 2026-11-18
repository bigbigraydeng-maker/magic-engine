'use client'

import { useEffect, useState } from 'react'
import ConfirmationDocument from './ConfirmationDocument'
import { emptyConfirmation, sampleConfirmation } from '@/lib/confirmation/defaults'
import { parseConfirmation, validateConfirmation } from '@/lib/confirmation/validate'
import { EMPTY_DAY, EMPTY_HOTEL, type ConfirmationData } from '@/lib/confirmation/types'

const draftKey = (clientId: string) => `confirmation-draft-v1:${clientId}`
const input = 'w-full rounded-md border border-[#D1D5DB] bg-white px-2.5 py-1.5 text-sm focus:border-[#B61E2E] focus:outline-none'
const btn = 'rounded-md px-3 py-2 text-sm font-medium transition'

export default function ConfirmationGenerator({ clientId }: { clientId: string }) {
  const [d, setD] = useState<ConfirmationData>(() => emptyConfirmation())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [restored, setRestored] = useState(false)

  // Per-browser convenience only: restore an unfinished draft.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey(clientId))
      const parsed = raw ? parseConfirmation(JSON.parse(raw)) : null
      if (parsed?.ok) setD(parsed.data)
    } catch {
      /* ignore */
    }
    setRestored(true)
  }, [clientId])
  useEffect(() => {
    if (!restored) return // never overwrite a saved draft with the blank template before it is read
    try {
      localStorage.setItem(draftKey(clientId), JSON.stringify(d))
    } catch {
      /* ignore */
    }
  }, [d, restored, clientId])

  const errors = validateConfirmation(d)
  const set = <K extends keyof ConfirmationData>(k: K, v: ConfirmationData[K]) => setD((p) => ({ ...p, [k]: v }))
  const setAt = <T,>(list: T[], i: number, v: T) => list.map((x, j) => (j === i ? v : x))
  const removeAt = <T,>(list: T[], i: number) => list.filter((_, j) => j !== i)

  async function downloadWord() {
    setMessage(null)
    if (errors.length) return setMessage(`还不能生成：${errors.join('；')}`)
    setBusy(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/confirmation/docx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(d),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error || `生成失败（${res.status}）`)
      }
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = `${d.tourCode}-confirmation.docx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '生成失败')
    } finally {
      setBusy(false)
    }
  }

  function printPdf() {
    setMessage(null)
    if (errors.length) return setMessage(`还不能生成：${errors.join('；')}`)
    const prev = document.title
    document.title = `${d.tourCode}-confirmation` // becomes the default PDF file name
    window.print()
    document.title = prev
  }

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,460px)_1fr]">
      <style>{`@media print {
        body * { visibility: hidden !important; }
        #confirmation-doc, #confirmation-doc * { visibility: visible !important; }
        #confirmation-doc { position: absolute; left: 0; top: 0; width: 100%; max-width: none; }
        @page { margin: 12mm; }
      }`}</style>

      <section className="space-y-5 print:hidden">
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`${btn} bg-[#B61E2E] text-white hover:opacity-90`} onClick={printPdf}>下载 PDF</button>
          <button type="button" disabled={busy} className={`${btn} bg-[#1F2937] text-white hover:opacity-90 disabled:opacity-50`} onClick={downloadWord}>
            {busy ? '生成中…' : '下载 Word（可再改）'}
          </button>
          <button type="button" className={`${btn} border border-[#D1D5DB] bg-white`} onClick={() => setD(sampleConfirmation())}>载入示例 CTS4270729</button>
          <button type="button" className={`${btn} border border-[#D1D5DB] bg-white`} onClick={() => confirm('清空当前内容？') && setD(emptyConfirmation())}>清空</button>
        </div>
        {(message || errors.length > 0) && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {message ?? `还差：${errors.join('；')}`}
          </div>
        )}

        <Box title="基本信息">
          <Field label="团号（只填一次，全文自动同步）">
            <input className={input} value={d.tourCode} onChange={(e) => set('tourCode', e.target.value.trim().toUpperCase())} placeholder="CTS4270729" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="出发日期"><input className={input} value={d.departureDate} onChange={(e) => set('departureDate', e.target.value)} placeholder="29-Jul-2027" /></Field>
            <Field label="人数"><input className={input} type="number" min={1} value={d.paxCount} onChange={(e) => set('paxCount', Number(e.target.value))} /></Field>
          </div>
          <Field label="地接社"><input className={input} value={d.groundOperator} onChange={(e) => set('groundOperator', e.target.value)} /></Field>
          <Field label="地接社电话"><input className={input} value={d.operatorTel} onChange={(e) => set('operatorTel', e.target.value)} /></Field>
          <Field label="房型"><input className={input} value={d.rooms} onChange={(e) => set('rooms', e.target.value)} /></Field>
          <Field label="导游说明"><input className={input} value={d.guideNote} onChange={(e) => set('guideNote', e.target.value)} /></Field>
          <Field label="接机牌名字（一行一个）"><textarea className={input} rows={3} value={d.pickupCardNames} onChange={(e) => set('pickupCardNames', e.target.value)} /></Field>
        </Box>

        <Box title="紧急联系人">
          {d.emergencyContacts.map((c, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <input className={input} value={c.name} placeholder="姓名" onChange={(e) => set('emergencyContacts', setAt(d.emergencyContacts, i, { ...c, name: e.target.value }))} />
              <input className={input} value={c.mobile} placeholder="电话" onChange={(e) => set('emergencyContacts', setAt(d.emergencyContacts, i, { ...c, mobile: e.target.value }))} />
              <button type="button" className="text-sm text-[#B61E2E]" onClick={() => set('emergencyContacts', removeAt(d.emergencyContacts, i))}>删</button>
            </div>
          ))}
          <button type="button" className="text-sm text-[#B61E2E]" onClick={() => set('emergencyContacts', [...d.emergencyContacts, { name: '', mobile: '' }])}>+ 加联系人</button>
        </Box>

        <Box title="航班（自订机票，一行一个航班原样写）">
          {d.flights.map((f, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto] gap-2">
              <input className={`${input} font-mono`} value={f.text} placeholder="CA 852Z 28JUL LGWPEK HK2 1235 0545 29JUL" onChange={(e) => set('flights', setAt(d.flights, i, { text: e.target.value }))} />
              <button type="button" className="text-sm text-[#B61E2E]" onClick={() => set('flights', removeAt(d.flights, i))}>删</button>
            </div>
          ))}
          <button type="button" className="text-sm text-[#B61E2E]" onClick={() => set('flights', [...d.flights, { text: '' }])}>+ 加航班</button>
        </Box>

        <Box title="每天行程">
          {d.days.map((day, i) => (
            <div key={i} className="space-y-2 rounded-md border border-[#E5E7EB] p-3">
              <div className="grid grid-cols-[90px_1fr_1fr_auto] gap-2">
                <input className={input} value={day.date} placeholder="29 Jul" onChange={(e) => set('days', setAt(d.days, i, { ...day, date: e.target.value }))} />
                <input className={input} value={day.route} placeholder="Arrive Beijing" onChange={(e) => set('days', setAt(d.days, i, { ...day, route: e.target.value }))} />
                <input className={input} value={day.overnight} placeholder="住宿城市" onChange={(e) => set('days', setAt(d.days, i, { ...day, overnight: e.target.value }))} />
                <button type="button" className="text-sm text-[#B61E2E]" onClick={() => set('days', removeAt(d.days, i))}>删</button>
              </div>
              <textarea className={input} rows={3} value={day.highlights} placeholder="当天亮点（一行一段）" onChange={(e) => set('days', setAt(d.days, i, { ...day, highlights: e.target.value }))} />
            </div>
          ))}
          <button type="button" className="text-sm text-[#B61E2E]" onClick={() => set('days', [...d.days, { ...EMPTY_DAY }])}>+ 加一天</button>
          <Field label="行程下方的备注（例如故宫门票说明）"><textarea className={input} rows={3} value={d.itineraryNote} onChange={(e) => set('itineraryNote', e.target.value)} /></Field>
        </Box>

        <Box title="酒店">
          {d.hotels.map((h, i) => (
            <div key={i} className="space-y-2 rounded-md border border-[#E5E7EB] p-3">
              <div className="grid grid-cols-[1fr_2fr_70px_auto] gap-2">
                <input className={input} value={h.city} placeholder="城市" onChange={(e) => set('hotels', setAt(d.hotels, i, { ...h, city: e.target.value }))} />
                <input className={input} value={h.name} placeholder="酒店英文名" onChange={(e) => set('hotels', setAt(d.hotels, i, { ...h, name: e.target.value }))} />
                <input className={input} type="number" min={1} max={5} value={h.stars} onChange={(e) => set('hotels', setAt(d.hotels, i, { ...h, stars: Number(e.target.value) }))} />
                <button type="button" className="text-sm text-[#B61E2E]" onClick={() => set('hotels', removeAt(d.hotels, i))}>删</button>
              </div>
              <input className={input} value={h.address} placeholder="英文地址" onChange={(e) => set('hotels', setAt(d.hotels, i, { ...h, address: e.target.value }))} />
              <input className={input} value={h.phone} placeholder="电话" onChange={(e) => set('hotels', setAt(d.hotels, i, { ...h, phone: e.target.value }))} />
              <textarea className={input} rows={3} value={h.chinese} placeholder="中文名 / 地址 / 电话（给司机看，一行一段）" onChange={(e) => set('hotels', setAt(d.hotels, i, { ...h, chinese: e.target.value }))} />
            </div>
          ))}
          <button type="button" className="text-sm text-[#B61E2E]" onClick={() => set('hotels', [...d.hotels, { ...EMPTY_HOTEL }])}>+ 加酒店</button>
        </Box>

        <Box title="包含 / 不包含（一行一条）">
          <Field label="包含"><textarea className={input} rows={5} value={d.inclusions.join('\n')} onChange={(e) => set('inclusions', e.target.value.split('\n'))} /></Field>
          <Field label="不包含"><textarea className={input} rows={5} value={d.exclusions.join('\n')} onChange={(e) => set('exclusions', e.target.value.split('\n'))} /></Field>
        </Box>

        <Box title="中国旅行小贴士（默认 14 条；天气和签证每次出团前请核对）">
          {d.tips.map((t, i) => (
            <details key={i} className="rounded-md border border-[#E5E7EB] px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium">{i + 1}. {t.title}</summary>
              <div className="mt-2 space-y-2">
                <input className={input} value={t.title} onChange={(e) => set('tips', setAt(d.tips, i, { ...t, title: e.target.value }))} />
                <textarea className={input} rows={6} value={t.body} onChange={(e) => set('tips', setAt(d.tips, i, { ...t, body: e.target.value }))} />
                <button type="button" className="text-sm text-[#B61E2E]" onClick={() => set('tips', removeAt(d.tips, i))}>删除这一条</button>
              </div>
            </details>
          ))}
          <button type="button" className="text-sm text-[#B61E2E]" onClick={() => set('tips', [...d.tips, { title: '', body: '' }])}>+ 加一条</button>
        </Box>
      </section>

      <section>
        <p className="mb-2 text-xs uppercase tracking-widest text-[#6B7280] print:hidden">预览（所见即所得，下载 PDF 就是这个样子）</p>
        <ConfirmationDocument data={d} />
      </section>
    </div>
  )
}

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-lg border border-[#E5E7EB] bg-white p-4">
      <legend className="px-1 text-sm font-semibold text-[#1F2937]">{title}</legend>
      {children}
    </fieldset>
  )
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-[#4B5563]">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  )
}
