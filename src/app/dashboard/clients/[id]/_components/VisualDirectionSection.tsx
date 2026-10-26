'use client'

import { useState, useRef } from 'react'
import type { CampaignBrief } from '@/types/magic-engine'
import { campaignSaveEchoed } from '@/lib/campaign/client-view'

const INPUT_CLASS = 'w-full bg-me-ivory border border-black/10 rounded-lg px-3 py-2 text-sm text-me-charcoal/90 placeholder-me-charcoal/65 focus:outline-none focus:ring-2 focus:ring-me-ochre focus:bg-white transition-colors'

function lineList(value: string): string[] | null {
  const items = value.split('\n').map(s => s.trim()).filter(Boolean)
  return items.length > 0 ? items : null
}

export function VisualDirectionSection({
  campaign,
  clientId,
  internal = false,
  onUpdated,
}: {
  campaign: CampaignBrief
  clientId: string
  /** Internal accounts can edit the AI-input notes. Clients cannot; those columns are not saved for them. */
  internal?: boolean
  onUpdated: (c: CampaignBrief) => void
}) {
  const hasExisting = !!(campaign.vi_mood || campaign.vi_color_accent || campaign.vi_specific_dos?.length)

  // Campaign visual inputs — drive AI generation
  const [inputNotes, setInputNotes] = useState(campaign.vi_input_notes ?? '')
  const [inputFiles, setInputFiles] = useState<{ storagePath: string; filename: string }[]>(
    (campaign.vi_input_file_urls ?? []).map(p => ({ storagePath: p, filename: p.split('/').pop() ?? p }))
  )
  const [uploadingInput, setUploadingInput] = useState(false)
  const inputFileRef = useRef<HTMLInputElement>(null)

  // Draft state populated by AI or manual edit
  const [draft, setDraft] = useState({
    vi_mood:           campaign.vi_mood           ?? '',
    vi_color_accent:   campaign.vi_color_accent   ?? '',
    vi_specific_dos:   (campaign.vi_specific_dos  ?? []).join('\n'),
    vi_specific_donts: (campaign.vi_specific_donts ?? []).join('\n'),
    vi_reference_note: campaign.vi_reference_note ?? '',
  })

  const [generating, setGenerating] = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [msg,        setMsg]        = useState('')
  const [msgTone,    setMsgTone]    = useState<'ok' | 'error'>('ok')
  const [dirty,      setDirty]      = useState(false)

  const say = (text: string, tone: 'ok' | 'error') => {
    setMsg(text)
    setMsgTone(tone)
  }

  const update = (key: string, value: string) => {
    setDraft(d => ({ ...d, [key]: value }))
    setDirty(true)
  }

  const handleInputFileUpload = async (file: File) => {
    setUploadingInput(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/clients/${clientId}/campaign/upload`, { method: 'POST', body: fd })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setInputFiles(prev => [...prev, { storagePath: json.storage_path, filename: file.name }])
      setDirty(true)
    } catch (err) {
      say(`上传失败：${(err as Error).message}`, 'error')
    } finally {
      setUploadingInput(false)
    }
  }

  const removeInputFile = (i: number) => {
    setInputFiles(prev => prev.filter((_, idx) => idx !== i))
    setDirty(true)
  }

  const handleGenerate = async () => {
    setGenerating(true)
    setMsg('')
    try {
      const res = await fetch(
        `/api/clients/${clientId}/campaign/${campaign.id}/generate-visual`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vi_input_notes: inputNotes.trim() || null,
            vi_input_file_urls: inputFiles.map(f => f.storagePath),
          }),
        }
      )
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      const g = json.generated
      setDraft({
        vi_mood:           g.vi_mood           ?? '',
        vi_color_accent:   g.vi_color_accent   ?? '',
        vi_specific_dos:   (g.vi_specific_dos  ?? []).join('\n'),
        vi_specific_donts: (g.vi_specific_donts ?? []).join('\n'),
        vi_reference_note: g.vi_reference_note ?? '',
      })
      setDirty(true)
      say('AI 已生成视觉方向，请先看一遍再保存', 'ok')
    } catch (err) {
      say(`出错了：${(err as Error).message}`, 'error')
    } finally {
      setGenerating(false)
    }
  }

  const handleSave = async () => {
    const payload: Record<string, unknown> = {
      vi_mood: draft.vi_mood.trim() || null,
      vi_color_accent: draft.vi_color_accent.trim() || null,
      vi_specific_dos: lineList(draft.vi_specific_dos),
      vi_specific_donts: lineList(draft.vi_specific_donts),
    }
    if (internal) {
      payload.vi_input_notes = inputNotes.trim() || null
      payload.vi_input_file_urls = inputFiles.map(f => f.storagePath)
      payload.vi_reference_note = draft.vi_reference_note.trim() || null
    }
    setSaving(true)
    setMsg('')
    try {
      const res = await fetch(`/api/clients/${clientId}/campaign/${campaign.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      if (!campaignSaveEchoed(payload, json.campaign)) {
        say('没有存上，请再试一次', 'error')
        return
      }
      onUpdated(json.campaign)
      setDirty(false)
      say('已保存', 'ok')
    } catch (err) {
      say(`出错了：${(err as Error).message}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border border-black/[.06] rounded-xl overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-me-ivory px-4 py-3">
        <div>
          <p className="text-xs font-semibold text-me-charcoal/75">视觉方向</p>
          <p className="text-xs text-me-charcoal/65 mt-0.5">
            沿用品牌的视觉风格，再按这次活动细化。可以让 AI 生成，也可以手动修改。
          </p>
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="flex items-center gap-1.5 text-xs bg-me-ochre hover:bg-me-ochre/90 text-me-charcoal px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors whitespace-nowrap"
        >
          {generating ? (
            <>
              <span className="w-3 h-3 border-2 border-me-charcoal/30 border-t-me-charcoal rounded-full animate-spin" />
              生成中…
            </>
          ) : (
            <>{hasExisting ? 'AI 重新生成' : 'AI 生成'}</>
          )}
        </button>
      </div>

      {/* Campaign visual inputs stay internal. Clients cannot see or save them. */}
      {internal && <div className="px-4 pt-4 pb-3 space-y-2 border-b border-black/[.06] bg-me-ochre/10/40">
        <p className="text-xs font-semibold text-me-charcoal/60 uppercase tracking-wide">
          活动视觉要点 <span className="font-normal normal-case text-me-charcoal/45">— 填写后点「AI 生成」，系统将结合品牌 DNA 生成方向</span>
        </p>
        <textarea
          value={inputNotes}
          onChange={e => { setInputNotes(e.target.value); setDirty(true) }}
          placeholder="描述本次活动的视觉元素：主色调、主题风格、特定场景、情绪基调…例：节日红金配色，温馨家庭聚餐场景，年味十足"
          rows={3}
          className={`${INPUT_CLASS} text-xs resize-none`}
        />
        <div className="flex items-center gap-2 flex-wrap">
          <input
            ref={inputFileRef}
            type="file"
            accept=".pdf,.doc,.docx,.txt"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleInputFileUpload(f) }}
          />
          <button
            onClick={() => inputFileRef.current?.click()}
            disabled={uploadingInput}
            className="text-xs border border-black/10 bg-white text-me-charcoal/60 hover:bg-me-ivory px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {uploadingInput ? '上传中…' : '+ 上传参考文件'}
          </button>
          <span className="text-xs text-me-charcoal/45">PDF / DOCX / TXT（活动创意简报、视觉参考等）</span>
        </div>
        {inputFiles.length > 0 && (
          <ul className="space-y-1">
            {inputFiles.map((f, i) => (
              <li key={i} className="flex items-center gap-2 text-xs text-me-charcoal/60 bg-white rounded px-2 py-1 border border-black/[.06]">
                <span className="truncate flex-1">{f.filename}</span>
                <button onClick={() => removeInputFile(i)} className="text-me-charcoal/45 hover:text-[#C2453A]">×</button>
              </li>
            ))}
          </ul>
        )}
      </div>}

      {/* ── AI-generated / manually editable fields ── */}
      <div className="px-4 py-4 space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-me-charcoal/70 mb-1">整体氛围</label>
            <input
              value={draft.vi_mood}
              onChange={e => update('vi_mood', e.target.value)}
              placeholder="例如：秋日清晨，薄雾，柔和自然光，有质感"
              className={`${INPUT_CLASS} text-xs`}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-me-charcoal/70 mb-1">活动主色</label>
            <input
              value={draft.vi_color_accent}
              onChange={e => update('vi_color_accent', e.target.value)}
              placeholder="例如：暖金色 #C9A84C"
              className={`${INPUT_CLASS} text-xs`}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-me-charcoal/70 mb-1">
              要做的 <span className="text-me-charcoal/65 font-normal">（每行一条）</span>
            </label>
            <textarea
              value={draft.vi_specific_dos}
              onChange={e => update('vi_specific_dos', e.target.value)}
              placeholder={"秋叶\n清晨薄雾\n建筑细节特写"}
              rows={3}
              className={`${INPUT_CLASS} text-xs resize-none`}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-me-charcoal/70 mb-1">
              不要做的 <span className="text-me-charcoal/65 font-normal">（每行一条）</span>
            </label>
            <textarea
              value={draft.vi_specific_donts}
              onChange={e => update('vi_specific_donts', e.target.value)}
              placeholder={"夏日绿叶\n杂乱的背景"}
              rows={3}
              className={`${INPUT_CLASS} text-xs resize-none`}
            />
          </div>
        </div>

        {internal && (
          <div>
            <label className="block text-xs font-medium text-me-charcoal/70 mb-1">
              出图参考说明 <span className="text-me-charcoal/65 font-normal">（英文，给 ChatGPT / Midjourney 用）</span>
            </label>
            <input
              value={draft.vi_reference_note}
              onChange={e => update('vi_reference_note', e.target.value)}
              placeholder="例如：Warm cinematic autumn photography, editorial style, golden tones"
              className={`${INPUT_CLASS} text-xs`}
            />
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          {msg ? (
            <p className={`text-xs ${msgTone === 'ok' ? 'text-[#5C8A4A]' : 'text-[#C2453A]'}`}>{msg}</p>
          ) : <span />}
          {dirty && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-xs bg-me-charcoal/90 hover:bg-me-charcoal/85 text-white px-4 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
            >
              {saving ? '保存中…' : '保存视觉方向'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
