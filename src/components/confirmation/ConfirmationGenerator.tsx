'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import ConfirmationDocument from './ConfirmationDocument'
import { emptyConfirmation, sampleConfirmation } from '@/lib/confirmation/defaults'
import { HERO_CHOICES } from '@/lib/tailor-made/hero-rules'
import { MAX_COVER_TITLE, heroLabel, resolveHeroName } from '@/lib/confirmation/cover'
import { parseConfirmation, validateConfirmation } from '@/lib/confirmation/validate'
import { EMPTY_DAY, EMPTY_HOTEL, type ConfirmationData } from '@/lib/confirmation/types'

const draftKey = (clientId: string) => `confirmation-draft-v1:${clientId}`
/** Logos are remembered per client separately, so 「清空」 or a new upload does not lose them. */
const logosKey = (clientId: string) => `confirmation-logos-v1:${clientId}`

/** Shrink an uploaded logo in the browser (max 600×240) and return a PNG data URI. */
async function shrinkLogo(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image()
      i.onload = () => ok(i)
      i.onerror = () => fail(new Error('这张图打不开，请换 PNG 或 JPG'))
      i.src = url
    })
    const k = Math.min(1, 600 / img.naturalWidth, 240 / img.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * k))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * k))
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}
const input = 'w-full rounded-md border border-[#D1D5DB] bg-white px-2.5 py-1.5 text-sm focus:border-[#B61E2E] focus:outline-none'
const btn = 'rounded-md px-3 py-2 text-sm font-medium transition'

export default function ConfirmationGenerator({ clientId }: { clientId: string }) {
  const [d, setD] = useState<ConfirmationData>(() => emptyConfirmation())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [restored, setRestored] = useState(false)
  const [reading, setReading] = useState(false)
  const [notes, setNotes] = useState<string[]>([])
  const [heroSrc, setHeroSrc] = useState<string | null>(null)
  /** which picture heroSrc currently holds; printing waits until it matches the chosen one */
  const [heroSrcName, setHeroSrcName] = useState<string | null>(null)
  const heroCache = useRef<Record<string, string>>({})

  // Per-browser convenience only: restore an unfinished draft.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey(clientId))
      const parsed = raw ? parseConfirmation(JSON.parse(raw)) : null
      const savedLogos = parseConfirmation({ ...emptyConfirmation(), logos: JSON.parse(localStorage.getItem(logosKey(clientId)) || 'null') ?? undefined })
      const logos = savedLogos.ok ? savedLogos.data.logos : emptyConfirmation().logos
      if (parsed?.ok) setD(parsed.data.logos.left || parsed.data.logos.right ? parsed.data : { ...parsed.data, logos })
      else setD((p) => ({ ...p, logos }))
    } catch {
      /* ignore */
    }
    setRestored(true)
  }, [clientId])
  useEffect(() => {
    if (!restored) return // never overwrite a saved draft with the blank template before it is read
    try {
      localStorage.setItem(draftKey(clientId), JSON.stringify(d))
      localStorage.setItem(logosKey(clientId), JSON.stringify(d.logos))
    } catch {
      /* ignore */
    }
  }, [d, restored, clientId])

  // Cover picture for the preview: same pictures Tailor-made uses, fetched once per name.
  const heroName = useMemo(() => resolveHeroName(d), [d])
  const photo = d.cover.style === 'photo'
  useEffect(() => {
    if (!photo) return
    const cached = heroCache.current[heroName]
    if (cached) {
      setHeroSrc(cached)
      setHeroSrcName(heroName)
      return
    }
    let live = true
    fetch(`/api/clients/${clientId}/tailor-made/heroes?name=${encodeURIComponent(heroName)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { dataUri?: string } | null) => {
        if (!live || !j?.dataUri) return
        heroCache.current[heroName] = j.dataUri
        setHeroSrc(j.dataUri)
        setHeroSrcName(heroName)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [heroName, photo, clientId])

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

  async function uploadAndFill(file: File) {
    setMessage(null)
    setNotes([])
    // anything the staff typed (other than tips/cover, which are kept) would be replaced
    const strip = (x: ConfirmationData) => JSON.stringify({ ...x, tips: [], cover: null, logos: null })
    const hasContent = strip(d) !== strip(emptyConfirmation())
    if (hasContent && !confirm('上传后会用文件里读出来的内容覆盖现在已填的内容（封面和小贴士不动）。继续？')) return
    setReading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/api/clients/${clientId}/confirmation/extract`, { method: 'POST', body: form, credentials: 'include' })
      const j = (await res.json().catch(() => ({}))) as { error?: string; data?: unknown; notes?: string[]; logos?: string[] }
      if (!res.ok) throw new Error(j.error || `读取失败（${res.status}）`)
      const parsed = parseConfirmation(j.data)
      if (!parsed.ok) throw new Error('读出来的内容格式不对，请重试或手动填写')
      // keep what the file does not carry: the 14 tips and the cover choice
      const fileLogos = (j.logos ?? []).filter((x) => typeof x === 'string')
      setD((prev) => ({
        ...parsed.data,
        tips: prev.tips,
        cover: prev.cover,
        logos: fileLogos.length ? { left: fileLogos[0] ?? '', right: fileLogos[1] ?? '' } : prev.logos,
      }))
      setNotes(['内容是 AI 从文件里读出来的，请逐项核对再生成。', ...(j.notes ?? [])])
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '读取失败')
    } finally {
      setReading(false)
    }
  }

  function printPdf() {
    setMessage(null)
    if (errors.length) return setMessage(`还不能生成：${errors.join('；')}`)
    if (photo && heroSrcName !== heroName) return setMessage('封面图还在加载，请等几秒再点「下载 PDF」')
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
        #confirmation-doc, #confirmation-doc * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        #confirmation-doc { position: absolute; left: 0; top: 0; width: 100%; max-width: none; }
        @page { margin: 12mm; }
      }`}</style>

      {/* locked while a file is being read, so nothing typed meanwhile is silently replaced */}
      <fieldset disabled={reading} className="m-0 min-w-0 space-y-5 border-0 p-0 print:hidden disabled:opacity-60">
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`${btn} bg-[#B61E2E] text-white hover:opacity-90`} onClick={printPdf}>下载 PDF</button>
          <button type="button" disabled={busy} className={`${btn} bg-[#1F2937] text-white hover:opacity-90 disabled:opacity-50`} onClick={downloadWord}>
            {busy ? '生成中…' : '下载 Word（可再改）'}
          </button>
          <button type="button" className={`${btn} border border-[#D1D5DB] bg-white`} onClick={() => setD((p) => ({ ...sampleConfirmation(), logos: p.logos }))}>载入示例</button>
          <button type="button" className={`${btn} border border-[#D1D5DB] bg-white`} onClick={() => confirm('清空当前内容？（logo 会保留）') && setD((p) => ({ ...emptyConfirmation(), logos: p.logos }))}>清空</button>
        </div>
        {(message || errors.length > 0) && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {message ?? `还差：${errors.join('；')}`}
          </div>
        )}

        <Box title="上传文件，自动填表">
          <p className="text-xs text-[#6B7280]">上传一份旧的确认单或行程（Word .docx / PDF / 文本），系统读出团号、航班、每天行程、酒店等，帮你填好；你核对后再生成。</p>
          <input
            type="file"
            accept=".docx,.pdf,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
            disabled={reading}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[#B61E2E] file:px-3 file:py-2 file:text-sm file:font-medium file:text-white disabled:opacity-50"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void uploadAndFill(f)
            }}
          />
          {reading && <p className="text-sm text-[#B61E2E]">正在读取文件，通常 20–60 秒，请别关页面…</p>}
          {notes.length > 0 && (
            <ul className="list-disc space-y-1 rounded-md border border-[#D6A756] bg-[#FBF7F0] py-2 pl-6 pr-3 text-sm text-[#23201C]">
              {notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
        </Box>

        <Box title="封面">
          <Field label="封面样式">
            <select className={input} value={d.cover.style} onChange={(e) => set('cover', { ...d.cover, style: e.target.value === 'banner' ? 'banner' : 'photo' })}>
              <option value="photo">图片封面（和 Tailor-made 一样：大图 + 米色信息面板）</option>
              <option value="banner">简洁红条（不带图片，不单独占一页）</option>
            </select>
          </Field>
          {photo && (
            <Field label={d.cover.hero === 'auto' ? `封面图片：自动，系统按行程选了「${heroLabel(heroName)}」` : '封面图片'}>
              <select className={input} value={d.cover.hero} onChange={(e) => set('cover', { ...d.cover, hero: e.target.value })}>
                <option value="auto">自动（按行程选）</option>
                {HERO_CHOICES.map((c) => (
                  <option key={c.name} value={c.name}>{c.label}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="封面大标题（最多 40 个字，一行放下；留空 = Welcome to China! 欢迎到中国！）">
            <input className={input} maxLength={MAX_COVER_TITLE} value={d.cover.title} onChange={(e) => set('cover', { ...d.cover, title: e.target.value.slice(0, MAX_COVER_TITLE) })} placeholder="Beijing Highlights" />
          </Field>
        </Box>

        <Box title="Logo（每页页眉，左右各一个；会记住，下次不用再传）">
          {(['left', 'right'] as const).map((side) => (
            <div key={side} className="flex items-center gap-3">
              <span className="w-12 shrink-0 text-xs font-medium text-[#4B5563]">{side === 'left' ? '左边' : '右边'}</span>
              {d.logos[side] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={d.logos[side]} alt="" className="h-10 w-auto max-w-[140px] rounded border border-[#E5E7EB] bg-white object-contain p-1" />
              ) : (
                <span className="text-xs text-[#9CA3AF]">未上传</span>
              )}
              <label className="cursor-pointer text-sm text-[#B61E2E]">
                {d.logos[side] ? '换一张' : '上传'}
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ''
                    if (!f) return
                    try {
                      const uri = await shrinkLogo(f)
                      set('logos', { ...d.logos, [side]: uri })
                    } catch (err) {
                      setMessage(err instanceof Error ? err.message : '这张图用不了')
                    }
                  }}
                />
              </label>
              {d.logos[side] && (
                <button type="button" className="text-sm text-[#6B7280]" onClick={() => set('logos', { ...d.logos, [side]: '' })}>去掉</button>
              )}
            </div>
          ))}
          {d.logos.left || d.logos.right ? (
            <button type="button" className="text-xs text-[#6B7280]" onClick={() => set('logos', { left: d.logos.right, right: d.logos.left })}>左右对调</button>
          ) : null}
        </Box>

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
                <input className={input} type="number" min={0} max={5} title="星级，0 = 不显示" value={h.stars} onChange={(e) => set('hotels', setAt(d.hotels, i, { ...h, stars: Number(e.target.value) }))} />
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
      </fieldset>

      <section>
        <p className="mb-2 text-xs uppercase tracking-widest text-[#6B7280] print:hidden">预览（所见即所得，下载 PDF 就是这个样子）</p>
        <ConfirmationDocument data={d} heroSrc={heroSrc} />
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
