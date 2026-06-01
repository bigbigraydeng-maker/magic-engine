'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { CampaignBrief, CampaignKeywordSnapshot } from '@/types/magic-engine'

interface Props {
  clientId: string
}

export function CampaignPanel({ clientId }: Props) {
  const [campaigns, setCampaigns] = useState<CampaignBrief[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  const fetchCampaigns = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/campaign?status=active`)
      if (res.ok) {
        const { campaigns: list } = await res.json()
        setCampaigns(list ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { fetchCampaigns() }, [fetchCampaigns])

  const handleCreated = (c: CampaignBrief) => {
    setCampaigns(prev => [c, ...prev])
    setShowForm(false)
  }

  const handleArchived = (id: string) => {
    setCampaigns(prev => prev.filter(c => c.id !== id))
  }

  const handleUpdated = (updated: CampaignBrief) => {
    setCampaigns(prev => prev.map(c => c.id === updated.id ? updated : c))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <p className="text-sm text-me-charcoal/45 animate-pulse">Loading campaigns…</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-me-charcoal/90">推广活动</h2>
          <p className="text-xs text-me-charcoal/55 mt-0.5">
            当前运行中的推广，内容生成时可选择注入对应活动上下文
          </p>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="text-sm bg-me-ochre hover:bg-me-ochre/90 text-white px-4 py-2 rounded-lg transition-colors"
        >
          {showForm ? '取消' : '+ 新建活动'}
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <CreateCampaignForm
          clientId={clientId}
          onCreated={handleCreated}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Campaign list */}
      {campaigns.length === 0 && !showForm ? (
        <div className="bg-white rounded-xl border border-dashed border-black/10 py-14 text-center">
          <p className="text-2xl mb-2">🎯</p>
          <p className="text-sm font-medium text-me-charcoal/60">暂无进行中的推广活动</p>
          <p className="text-xs text-me-charcoal/45 mt-1">新建活动后，内容生成时可选择注入推广上下文</p>
        </div>
      ) : (
        <div className="space-y-4">
          {campaigns.map(c => (
            <CampaignCard
              key={c.id}
              campaign={c}
              clientId={clientId}
              onArchived={handleArchived}
              onUpdated={handleUpdated}
            />
          ))}
        </div>
      )}

      {/* Archived toggle */}
      <ArchivedCampaigns clientId={clientId} />
    </div>
  )
}

// ─── Create Form ──────────────────────────────────────────────────────────────

function CreateCampaignForm({
  clientId,
  onCreated,
  onCancel,
}: {
  clientId: string
  onCreated: (c: CampaignBrief) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [validFrom, setValidFrom] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    if (!title.trim()) { setError('请填写活动名称'); return }
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/clients/${clientId}/campaign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          valid_from: validFrom || null,
          valid_until: validUntil || null,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      onCreated(json.campaign)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-me-ochre/30 p-5 space-y-4">
      <h3 className="text-sm font-semibold text-me-charcoal/75">新建推广活动</h3>

      <div className="grid grid-cols-1 gap-3">
        <Field label="活动名称 *" required>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="例：Q2 新西兰团队游推广"
            className={INPUT_CLASS}
          />
        </Field>

        <Field label="推广描述">
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="简述推广目的、核心卖点、目标客群…"
            rows={3}
            className={`${INPUT_CLASS} resize-none`}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="开始日期">
            <input type="date" value={validFrom} onChange={e => setValidFrom(e.target.value)} className={INPUT_CLASS} />
          </Field>
          <Field label="结束日期">
            <input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} className={INPUT_CLASS} />
          </Field>
        </div>
      </div>

      {error && <p className="text-xs text-[#C2453A]">{error}</p>}

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="text-sm text-me-charcoal/55 hover:text-me-charcoal/75 px-4 py-2">取消</button>
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="text-sm bg-me-ochre hover:bg-me-ochre/90 text-white px-4 py-2 rounded-lg disabled:opacity-50 transition-colors"
        >
          {saving ? '创建中…' : '创建活动'}
        </button>
      </div>
    </div>
  )
}

// ─── Campaign Card ────────────────────────────────────────────────────────────

const CAMPAIGN_COLORS = [
  'border-l-[#3E6E8C]',
  'border-l-[#5C8A4A]',
  'border-l-me-ochre',
  'border-l-me-gold',
  'border-l-[#C2453A]',
]

function CampaignCard({
  campaign,
  clientId,
  onArchived,
  onUpdated,
}: {
  campaign: CampaignBrief
  clientId: string
  onArchived: (id: string) => void
  onUpdated: (c: CampaignBrief) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [enriching, setEnriching] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [uploadingFile, setUploadingFile] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [msg, setMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // Keyword enrichment — seeds come automatically from Master Brief
  const [enrichDb, setEnrichDb] = useState('au')

  // Edit mode
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(campaign.title)
  const [editDescription, setEditDescription] = useState(campaign.description ?? '')
  const [editFrom, setEditFrom] = useState(campaign.valid_from ?? '')
  const [editUntil, setEditUntil] = useState(campaign.valid_until ?? '')
  const [saving, setSaving] = useState(false)

  const handleSaveEdit = async () => {
    if (!editTitle.trim()) return
    setSaving(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/campaign/${campaign.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTitle.trim(),
          description: editDescription.trim() || null,
          valid_from: editFrom || null,
          valid_until: editUntil || null,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      onUpdated(json.campaign)
      setEditing(false)
      setMsg('✓ 已保存')
    } catch (err) {
      setMsg(`✗ ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  const colorClass = CAMPAIGN_COLORS[
    campaign.id.charCodeAt(0) % CAMPAIGN_COLORS.length
  ]

  const dateLabel = (() => {
    if (campaign.valid_from && campaign.valid_until) {
      return `${campaign.valid_from} → ${campaign.valid_until}`
    }
    if (campaign.valid_from) return `${campaign.valid_from} 起`
    if (campaign.valid_until) return `至 ${campaign.valid_until}`
    return ''
  })()

  const keywords = (campaign.semrush_keywords ?? []) as CampaignKeywordSnapshot[]

  const handleEnrich = async () => {
    setEnriching(true)
    setMsg('')
    try {
      const res = await fetch(`/api/clients/${clientId}/campaign/${campaign.id}/enrich`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ db: enrichDb }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      onUpdated(json.campaign)
      const seedsLabel = json.seeds_used?.join(', ') ?? ''
      setMsg(`✓ 获取到 ${json.keywords_found} 个关键词（种子词：${seedsLabel}）`)
    } catch (err) {
      setMsg(`✗ ${(err as Error).message}`)
    } finally {
      setEnriching(false)
    }
  }

  const handleAddUrl = async () => {
    const url = urlInput.trim()
    if (!url) return
    try {
      const newUrls = [...(campaign.source_urls ?? []), url]
      const res = await fetch(`/api/clients/${clientId}/campaign/${campaign.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_urls: newUrls }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? 'Failed to save URL')
      onUpdated(json.campaign)
      setUrlInput('')
    } catch (err) {
      setMsg(`✗ 添加失败: ${(err as Error).message}`)
    }
  }

  const handleFileUpload = async (file: File) => {
    setUploadingFile(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const uploadRes = await fetch(`/api/clients/${clientId}/campaign/upload`, {
        method: 'POST', body: fd,
      })
      const uploadJson = await uploadRes.json()
      if (!uploadJson.success) throw new Error(uploadJson.error)

      const newFiles = [...(campaign.source_file_urls ?? []), uploadJson.storage_path]
      const patchRes = await fetch(`/api/clients/${clientId}/campaign/${campaign.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_file_urls: newFiles }),
      })
      const patchJson = await patchRes.json()
      if (patchJson.success) onUpdated(patchJson.campaign)
    } catch (err) {
      setMsg(`✗ 上传失败: ${(err as Error).message}`)
    } finally {
      setUploadingFile(false)
    }
  }

  const handleArchive = async () => {
    if (!confirm(`归档活动「${campaign.title}」？归档后内容生成将不再注入此活动上下文。`)) return
    setArchiving(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/campaign/${campaign.id}/archive`, { method: 'POST' })
      const json = await res.json()
      if (json.success) onArchived(campaign.id)
    } finally {
      setArchiving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm(`永久删除活动「${campaign.title}」？此操作不可撤销，相关内容草稿不受影响。`)) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/campaign/${campaign.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (json.success) onArchived(campaign.id) // reuse remove-from-list callback
      else setMsg(`✗ 删除失败: ${json.error}`)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className={`bg-white rounded-xl border border-black/10 border-l-4 ${colorClass} overflow-hidden`}>
      {/* Header */}
      <div className="flex items-start justify-between px-5 py-4">
        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="space-y-2 pr-2">
              <input
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                placeholder="活动名称"
                className={`${INPUT_CLASS} text-sm font-semibold`}
              />
              <textarea
                value={editDescription}
                onChange={e => setEditDescription(e.target.value)}
                placeholder="推广描述（可选）"
                rows={2}
                className={`${INPUT_CLASS} text-xs resize-none`}
              />
              <div className="grid grid-cols-2 gap-2">
                <input type="date" value={editFrom} onChange={e => setEditFrom(e.target.value)}
                  className={`${INPUT_CLASS} text-xs`} />
                <input type="date" value={editUntil} onChange={e => setEditUntil(e.target.value)}
                  className={`${INPUT_CLASS} text-xs`} />
              </div>
              <div className="flex gap-2">
                <button onClick={handleSaveEdit} disabled={saving || !editTitle.trim()}
                  className="text-xs bg-me-ochre hover:bg-me-ochre/90 text-white px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors">
                  {saving ? '保存中…' : '保存'}
                </button>
                <button onClick={() => { setEditing(false); setEditTitle(campaign.title); setEditDescription(campaign.description ?? ''); setEditFrom(campaign.valid_from ?? ''); setEditUntil(campaign.valid_until ?? '') }}
                  className="text-xs text-me-charcoal/55 hover:text-me-charcoal/75 px-3 py-1.5">
                  取消
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-me-charcoal/90">{campaign.title}</span>
                <span className="text-xs bg-[#5C8A4A]/12 text-[#5C8A4A] px-2 py-0.5 rounded-full font-medium">
                  进行中
                </span>
                {dateLabel && (
                  <span className="text-xs text-me-charcoal/45">{dateLabel}</span>
                )}
                <button onClick={() => setEditing(true)}
                  className="text-xs text-me-charcoal/45 hover:text-me-ochre transition-colors ml-1">
                  ✏️ 编辑
                </button>
              </div>
              {campaign.description && (
                <p className="text-xs text-me-charcoal/55 mt-1 line-clamp-2">{campaign.description}</p>
              )}
              <div className="flex items-center gap-3 mt-2 text-xs text-me-charcoal/45">
                <span>{(campaign.source_urls ?? []).length} 个网址</span>
                <span>{(campaign.source_file_urls ?? []).length} 个文件</span>
                <span>{keywords.length} 个关键词</span>
              </div>
            </>
          )}
        </div>
        <button
          onClick={() => setExpanded(v => !v)}
          className="text-xs text-me-charcoal/45 hover:text-me-charcoal/60 ml-3 flex-shrink-0"
        >
          {expanded ? '收起 ▲' : '展开 ▼'}
        </button>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-black/[.06] px-5 py-4 space-y-5">

          {/* Source URLs */}
          <div>
            <p className="text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide mb-2">
              产品 / 落地页网址
            </p>
            <div className="space-y-1.5 mb-2">
              {(campaign.source_urls ?? []).map((url, i) => (
                <a key={i} href={url} target="_blank" rel="noreferrer"
                  className="block text-xs text-me-ochre hover:underline truncate">
                  {url}
                </a>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddUrl()}
                placeholder="https://…"
                className={`${INPUT_CLASS} flex-1 text-xs`}
              />
              <button
                onClick={handleAddUrl}
                disabled={!urlInput.trim()}
                className="text-xs bg-me-charcoal/85 text-white px-3 py-1.5 rounded-lg disabled:opacity-40 hover:bg-me-charcoal/90 transition-colors"
              >
                添加
              </button>
            </div>
          </div>

          {/* File uploads */}
          <div>
            <p className="text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide mb-2">
              资料文件（PDF / Word / TXT）
            </p>
            <div className="space-y-1 mb-2">
              {(campaign.source_file_urls ?? []).map((f, i) => (
                <p key={i} className="text-xs text-me-charcoal/60 font-mono truncate">{f.split('/').pop()}</p>
              ))}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.doc,.docx,.txt"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f) }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploadingFile}
              className="text-xs border border-black/10 text-me-charcoal/60 hover:bg-me-ivory px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
            >
              {uploadingFile ? '上传中…' : '+ 上传文件'}
            </button>
          </div>

          {/* Keyword Enrichment */}
          <div>
            <p className="text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide mb-1">
              推广关键词
            </p>
            <p className="text-xs text-me-charcoal/45 mb-2">
              种子词自动来自 Master Brief，点「拉取」即可
            </p>
            <div className="flex gap-2 mb-2">
              <select
                value={enrichDb}
                onChange={e => setEnrichDb(e.target.value)}
                className="border border-black/10 rounded-lg px-2 py-1.5 text-xs text-me-charcoal/75 bg-white focus:outline-none focus:ring-2 focus:ring-me-ochre"
              >
                <option value="au">AU</option>
                <option value="nz">NZ</option>
                <option value="us">US</option>
                <option value="gb">UK</option>
                <option value="ca">CA</option>
              </select>
              <button
                onClick={handleEnrich}
                disabled={enriching}
                className="text-xs bg-me-ochre hover:bg-me-ochre/90 text-white px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {enriching ? '获取中…' : '🔍 拉取'}
              </button>
            </div>
            {keywords.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {keywords.slice(0, 20).map((k, i) => (
                  <span
                    key={i}
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      k.type === 'question'
                        ? 'bg-me-ochre/10 text-me-ochre'
                        : 'bg-me-ochre/10 text-me-ochre'
                    }`}
                    title={`Vol: ${k.volume} | KD: ${k.kd} | ${k.intent}`}
                  >
                    {k.type === 'question' ? '❓ ' : ''}{k.keyword}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-me-charcoal/45 italic">
                点击「拉取」从 Keyword Intelligence 获取推广相关词
              </p>
            )}
          </div>

          {/* ── Visual Direction ─────────────────────────────── */}
          <VisualDirectionSection
            campaign={campaign}
            clientId={clientId}
            onUpdated={onUpdated}
          />

          {msg && (
            <p className={`text-xs ${msg.startsWith('✓') ? 'text-[#5C8A4A]' : 'text-[#C2453A]'}`}>
              {msg}
            </p>
          )}

          {/* Archive / Delete */}
          <div className="flex justify-end items-center gap-4 pt-1 border-t border-black/[.04]">
            <button
              onClick={handleArchive}
              disabled={archiving || deleting}
              className="text-xs text-me-charcoal/45 hover:text-me-ochre transition-colors disabled:opacity-50"
            >
              {archiving ? '归档中…' : '归档活动'}
            </button>
            <button
              onClick={handleDelete}
              disabled={archiving || deleting}
              className="text-xs text-[#C2453A]/80 hover:text-[#C2453A] font-medium transition-colors disabled:opacity-50"
            >
              {deleting ? '删除中…' : '🗑 永久删除'}
            </button>
          </div>
        </div>
      )}

    </div>
  )
}

// ─── Archived campaigns (collapsed by default) ────────────────────────────────

function ArchivedCampaigns({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false)
  const [archived, setArchived] = useState<CampaignBrief[]>([])
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/campaign?status=archived`)
      if (res.ok) {
        const { campaigns } = await res.json()
        setArchived(campaigns ?? [])
      }
    } finally {
      setLoading(false)
    }
  }

  const toggle = () => {
    if (!open && archived.length === 0) load()
    setOpen(v => !v)
  }

  return (
    <div>
      <button
        onClick={toggle}
        className="text-xs text-me-charcoal/45 hover:text-me-charcoal/60 transition-colors"
      >
        {open ? '▲ 隐藏已归档活动' : '▼ 查看已归档活动'}
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          {loading && <p className="text-xs text-me-charcoal/45 animate-pulse">加载中…</p>}
          {!loading && archived.length === 0 && (
            <p className="text-xs text-me-charcoal/45">暂无归档活动</p>
          )}
          {archived.map(c => (
            <div key={c.id} className="bg-me-ivory rounded-lg border border-black/[.06] px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-me-charcoal/55">{c.title}</p>
                {c.valid_from && (
                  <p className="text-xs text-me-charcoal/45">{c.valid_from} → {c.valid_until ?? '—'}</p>
                )}
              </div>
              <span className="text-xs bg-me-ivory text-me-charcoal/55 px-2 py-0.5 rounded-full">归档</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Visual Direction Section ─────────────────────────────────────────────────

function VisualDirectionSection({
  campaign,
  clientId,
  onUpdated,
}: {
  campaign: CampaignBrief
  clientId: string
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
  const [dirty,      setDirty]      = useState(false)

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
      setMsg(`✗ 上传失败: ${(err as Error).message}`)
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
      setMsg('AI generated visual direction -- please review before saving')
    } catch (err) {
      setMsg(`Error: ${(err as Error).message}`)
    } finally {
      setGenerating(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setMsg('')
    try {
      const res = await fetch(`/api/clients/${clientId}/campaign/${campaign.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vi_input_notes:     inputNotes.trim() || null,
          vi_input_file_urls: inputFiles.map(f => f.storagePath),
          vi_mood:           draft.vi_mood.trim()           || null,
          vi_color_accent:   draft.vi_color_accent.trim()   || null,
          vi_specific_dos:   draft.vi_specific_dos.trim()
            ? draft.vi_specific_dos.split('\n').map((s: string) => s.trim()).filter(Boolean)
            : null,
          vi_specific_donts: draft.vi_specific_donts.trim()
            ? draft.vi_specific_donts.split('\n').map((s: string) => s.trim()).filter(Boolean)
            : null,
          vi_reference_note: draft.vi_reference_note.trim() || null,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      onUpdated(json.campaign)
      setDirty(false)
      setMsg('Saved')
    } catch (err) {
      setMsg(`Error: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border border-black/[.06] rounded-xl overflow-hidden">
      <div className="flex items-center justify-between bg-me-ivory px-4 py-3">
        <div>
          <p className="text-xs font-semibold text-me-charcoal/75 uppercase tracking-wide">
            Visual Direction
          </p>
          <p className="text-xs text-me-charcoal/45 mt-0.5">
            Inherits brand visual DNA and specialises for this campaign. AI-generated, manually adjustable.
          </p>
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="flex items-center gap-1.5 text-xs bg-me-ochre hover:bg-me-ochre/90 text-white px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors whitespace-nowrap"
        >
          {generating ? (
            <>
              <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              Generating...
            </>
          ) : (
            <>{hasExisting ? 'AI Regenerate' : 'AI Generate'}</>
          )}
        </button>
      </div>

      {/* ── Campaign Visual Inputs ── */}
      <div className="px-4 pt-4 pb-3 space-y-2 border-b border-black/[.06] bg-me-ochre/10/40">
        <p className="text-xs font-semibold text-me-charcoal/60 uppercase tracking-wide">
          活动视觉要点 <span className="font-normal normal-case text-me-charcoal/45">— 填写后点 AI Generate，系统将结合品牌 DNA 生成方向</span>
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
      </div>

      {/* ── AI-generated / manually editable fields ── */}
      <div className="px-4 py-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-me-charcoal/55 mb-1">Visual Mood</label>
            <input
              value={draft.vi_mood}
              onChange={e => update('vi_mood', e.target.value)}
              placeholder="e.g. Autumn imperial Beijing, misty morning, sense of history"
              className={`${INPUT_CLASS} text-xs`}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-me-charcoal/55 mb-1">Campaign Accent Colour</label>
            <input
              value={draft.vi_color_accent}
              onChange={e => update('vi_color_accent', e.target.value)}
              placeholder="e.g. Harvest gold #C9A84C"
              className={`${INPUT_CLASS} text-xs`}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-me-charcoal/55 mb-1">
              Visual Dos <span className="text-me-charcoal/45 font-normal">(one per line)</span>
            </label>
            <textarea
              value={draft.vi_specific_dos}
              onChange={e => update('vi_specific_dos', e.target.value)}
              placeholder={"Autumn foliage\nMorning mist atmosphere\nAncient architecture close-ups"}
              rows={3}
              className={`${INPUT_CLASS} text-xs resize-none`}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-me-charcoal/55 mb-1">
              Visual Don'ts <span className="text-me-charcoal/45 font-normal">(one per line)</span>
            </label>
            <textarea
              value={draft.vi_specific_donts}
              onChange={e => update('vi_specific_donts', e.target.value)}
              placeholder={"Summer green foliage\nModern city backgrounds"}
              rows={3}
              className={`${INPUT_CLASS} text-xs resize-none`}
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-me-charcoal/55 mb-1">
            Image Generation Reference <span className="text-me-charcoal/45 font-normal">(English, for ChatGPT / Midjourney)</span>
          </label>
          <input
            value={draft.vi_reference_note}
            onChange={e => update('vi_reference_note', e.target.value)}
            placeholder="e.g. Warm cinematic autumn travel photography, Palace Museum editorial style, harvest gold tones"
            className={`${INPUT_CLASS} text-xs`}
          />
        </div>

        <div className="flex items-center justify-between pt-1">
          {msg ? (
            <p className={`text-xs ${msg === 'Saved' || msg.startsWith('AI') ? 'text-[#5C8A4A]' : 'text-[#C2453A]'}`}>{msg}</p>
          ) : <span />}
          {dirty && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-xs bg-me-charcoal/90 hover:bg-me-charcoal/85 text-white px-4 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : 'Save Visual Direction'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// --- Helpers ---

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div>
      <label className="block text-xs font-medium text-me-charcoal/60 mb-1">
        {label}{required && <span className="text-[#C2453A] ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

const INPUT_CLASS = 'w-full bg-me-ivory border border-black/10 rounded-lg px-3 py-2 text-sm text-me-charcoal/90 placeholder-me-charcoal/45 focus:outline-none focus:ring-2 focus:ring-me-ochre focus:bg-white transition-colors'
