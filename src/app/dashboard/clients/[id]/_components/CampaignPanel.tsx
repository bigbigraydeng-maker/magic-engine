'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { CampaignBrief, CampaignKeywordSnapshot } from '@/types/magic-engine'
import { PromptPreviewModal } from './PromptPreviewModal'
import type { PreviewPost } from './PromptPreviewModal'

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
        <p className="text-sm text-gray-400 animate-pulse">Loading campaigns…</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">推广活动</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            当前运行中的推广，内容生成时可选择注入对应活动上下文
          </p>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition-colors"
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
        <div className="bg-white rounded-xl border border-dashed border-gray-200 py-14 text-center">
          <p className="text-2xl mb-2">🎯</p>
          <p className="text-sm font-medium text-gray-600">暂无进行中的推广活动</p>
          <p className="text-xs text-gray-400 mt-1">新建活动后，内容生成时可选择注入推广上下文</p>
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
    <div className="bg-white rounded-xl border border-indigo-200 p-5 space-y-4">
      <h3 className="text-sm font-semibold text-gray-800">新建推广活动</h3>

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

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2">取消</button>
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg disabled:opacity-50 transition-colors"
        >
          {saving ? '创建中…' : '创建活动'}
        </button>
      </div>
    </div>
  )
}

// ─── Campaign Card ────────────────────────────────────────────────────────────

const CAMPAIGN_COLORS = [
  'border-l-blue-500',
  'border-l-emerald-500',
  'border-l-purple-500',
  'border-l-amber-500',
  'border-l-rose-500',
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
  const [uploadingFile, setUploadingFile] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [msg, setMsg] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // SEMrush enrichment inputs
  const [seedKeyword, setSeedKeyword] = useState(campaign.title)
  const [semrushDb, setSemrushDb] = useState('au')

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

  // Batch generation state
  const [batchPlatforms, setBatchPlatforms] = useState<string[]>(['facebook', 'tiktok'])
  const [directionNote, setDirectionNote] = useState('')
  const [routeACount, setRouteACount] = useState(3)
  const [routeCCount, setRouteCCount] = useState(2)
  const [generating, setGenerating] = useState(false)
  const [genResult, setGenResult] = useState<{ count: number } | null>(null)
  const totalPosts = routeACount + routeCCount

  // Prompt preview modal state
  const [previewLoading, setPreviewLoading] = useState(false)
  const [showPromptModal, setShowPromptModal] = useState(false)
  const [previewData, setPreviewData] = useState<{ system_prompt: string; posts: PreviewPost[] } | null>(null)

  const handlePreviewPrompts = async () => {
    if (totalPosts < 1) { setMsg('✗ 请设置至少 1 条'); return }
    setPreviewLoading(true)
    setMsg('')
    try {
      const res = await fetch(
        `/api/clients/${clientId}/campaign/${campaign.id}/preview-prompt`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platforms: batchPlatforms,
            direction_note: directionNote.trim() || campaign.title,
            route_a_count: routeACount,
            route_c_count: routeCCount,
          }),
        }
      )
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setPreviewData(json)
      setShowPromptModal(true)
    } catch (err) {
      setMsg(`✗ ${(err as Error).message}`)
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleBatchGenerate = async (systemPromptOverride?: string, userPromptsOverride?: string[]) => {
    if (totalPosts < 1) { setMsg('✗ 请设置至少 1 条'); return }
    setGenerating(true)
    setShowPromptModal(false)
    setMsg('')
    setGenResult(null)
    try {
      const hasOverrides = systemPromptOverride !== undefined || userPromptsOverride !== undefined
      const res = await fetch(
        `/api/clients/${clientId}/campaign/${campaign.id}/batch-generate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platforms: batchPlatforms,
            direction_note: directionNote.trim() || campaign.title,
            route_a_count: routeACount,
            route_c_count: routeCCount,
            ...(hasOverrides ? {
              prompt_overrides: {
                system_prompt: systemPromptOverride,
                post_user_prompts: userPromptsOverride,
              },
            } : {}),
          }),
        }
      )
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setGenResult({ count: json.saved })
      setMsg(`✓ 已生成 ${json.saved} 条草稿，请前往内容板检查审批`)
    } catch (err) {
      setMsg(`✗ ${(err as Error).message}`)
    } finally {
      setGenerating(false)
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
        body: JSON.stringify({ seed_keyword: seedKeyword.trim() || campaign.title, db: semrushDb }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      onUpdated(json.campaign)
      setMsg(`✓ 获取到 ${json.keywords_found} 个关键词`)
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

  return (
    <div className={`bg-white rounded-xl border border-gray-200 border-l-4 ${colorClass} overflow-hidden`}>
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
                  className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors">
                  {saving ? '保存中…' : '保存'}
                </button>
                <button onClick={() => { setEditing(false); setEditTitle(campaign.title); setEditDescription(campaign.description ?? ''); setEditFrom(campaign.valid_from ?? ''); setEditUntil(campaign.valid_until ?? '') }}
                  className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5">
                  取消
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-gray-900">{campaign.title}</span>
                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                  进行中
                </span>
                {dateLabel && (
                  <span className="text-xs text-gray-400">{dateLabel}</span>
                )}
                <button onClick={() => setEditing(true)}
                  className="text-xs text-gray-400 hover:text-indigo-600 transition-colors ml-1">
                  ✏️ 编辑
                </button>
              </div>
              {campaign.description && (
                <p className="text-xs text-gray-500 mt-1 line-clamp-2">{campaign.description}</p>
              )}
              <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                <span>{(campaign.source_urls ?? []).length} 个网址</span>
                <span>{(campaign.source_file_urls ?? []).length} 个文件</span>
                <span>{keywords.length} 个关键词</span>
              </div>
            </>
          )}
        </div>
        <button
          onClick={() => setExpanded(v => !v)}
          className="text-xs text-gray-400 hover:text-gray-600 ml-3 flex-shrink-0"
        >
          {expanded ? '收起 ▲' : '展开 ▼'}
        </button>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-5">

          {/* Source URLs */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              产品 / 落地页网址
            </p>
            <div className="space-y-1.5 mb-2">
              {(campaign.source_urls ?? []).map((url, i) => (
                <a key={i} href={url} target="_blank" rel="noreferrer"
                  className="block text-xs text-indigo-600 hover:underline truncate">
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
                className="text-xs bg-gray-800 text-white px-3 py-1.5 rounded-lg disabled:opacity-40 hover:bg-gray-900 transition-colors"
              >
                添加
              </button>
            </div>
          </div>

          {/* File uploads */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              资料文件（PDF / Word / TXT）
            </p>
            <div className="space-y-1 mb-2">
              {(campaign.source_file_urls ?? []).map((f, i) => (
                <p key={i} className="text-xs text-gray-600 font-mono truncate">{f.split('/').pop()}</p>
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
              className="text-xs border border-gray-200 text-gray-600 hover:bg-gray-50 px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
            >
              {uploadingFile ? '上传中…' : '+ 上传文件'}
            </button>
          </div>

          {/* SEMrush Keywords */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              SEMrush 关键词
            </p>
            {/* Seed keyword + DB selector */}
            <div className="flex gap-2 mb-2">
              <input
                value={seedKeyword}
                onChange={e => setSeedKeyword(e.target.value)}
                placeholder="搜索词，例：China tour New Zealand"
                className={`${INPUT_CLASS} flex-1 text-xs`}
              />
              <select
                value={semrushDb}
                onChange={e => setSemrushDb(e.target.value)}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="au">AU</option>
                <option value="us">US</option>
                <option value="gb">UK</option>
                <option value="nz">NZ</option>
                <option value="ca">CA</option>
              </select>
              <button
                onClick={handleEnrich}
                disabled={enriching || !seedKeyword.trim()}
                className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors whitespace-nowrap"
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
                        ? 'bg-amber-50 text-amber-700'
                        : 'bg-indigo-50 text-indigo-700'
                    }`}
                    title={`Vol: ${k.volume} | KD: ${k.kd} | ${k.intent}`}
                  >
                    {k.type === 'question' ? '❓ ' : ''}{k.keyword}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400 italic">
                点击「拉取关键词」从 SEMrush 获取推广相关词
              </p>
            )}
          </div>

          {/* ── Batch Generation ─────────────────────────────── */}
          <div className="bg-gray-50 rounded-xl p-4 space-y-4 border border-gray-100">
            <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
              🚀 批量生成内容
            </p>

            {/* Direction note */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">内容方向 / 口号</label>
              <textarea
                value={directionNote}
                onChange={e => setDirectionNote(e.target.value)}
                placeholder={`默认使用活动标题："${campaign.title}"`}
                rows={2}
                className={`${INPUT_CLASS} resize-none text-xs`}
              />
            </div>

            {/* Platforms */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">发布平台</label>
              <div className="flex gap-2">
                {['facebook', 'tiktok', 'instagram'].map(p => (
                  <button
                    key={p}
                    onClick={() => setBatchPlatforms(prev =>
                      prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
                    )}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border-2 transition-colors capitalize ${
                      batchPlatforms.includes(p)
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                        : 'border-gray-200 text-gray-500 bg-white'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Post counts */}
            <div>
              <p className="text-xs text-gray-400 mb-2">
                数字 = 总生成条数（每条同时发布到所选全部平台）
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    🔑 关键词文章（总条数）
                  </label>
                  <input
                    type="number"
                    min={0} max={20}
                    value={routeACount}
                    onChange={e => setRouteACount(Math.max(0, Math.min(20, parseInt(e.target.value) || 0)))}
                    className={`${INPUT_CLASS} text-center`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    💡 自由话题（总条数）
                  </label>
                  <input
                    type="number"
                    min={0} max={20}
                    value={routeCCount}
                    onChange={e => setRouteCCount(Math.max(0, Math.min(20, parseInt(e.target.value) || 0)))}
                    className={`${INPUT_CLASS} text-center`}
                  />
                </div>
              </div>
            </div>

            <button
              onClick={handlePreviewPrompts}
              disabled={previewLoading || generating || totalPosts < 1 || batchPlatforms.length === 0}
              className="w-full py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 transition-colors"
            >
              {previewLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  准备 Prompt 预览…
                </span>
              ) : generating ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  生成中…（共 {totalPosts} 条）
                </span>
              ) : `预览 Prompt → 生成 ${totalPosts} 条`}
            </button>

            {genResult && (
              <div className="flex flex-col gap-1.5">
                <a
                  href="/dashboard/content"
                  className="block text-center text-xs text-indigo-600 hover:underline"
                >
                  ✓ 已生成 {genResult.count} 条草稿 → 前往内容板审批 ↗
                </a>
                <a
                  href={`/dashboard/clients/${clientId}/execution`}
                  className="block text-center text-xs text-gray-500 hover:text-indigo-600 hover:underline"
                >
                  ← 返回执行看板
                </a>
              </div>
            )}
          </div>

          {msg && (
            <p className={`text-xs ${msg.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>
              {msg}
            </p>
          )}

          {/* Archive */}
          <div className="flex justify-end pt-1 border-t border-gray-50">
            <button
              onClick={handleArchive}
              disabled={archiving}
              className="text-xs text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
            >
              {archiving ? '归档中…' : '归档活动'}
            </button>
          </div>
        </div>
      )}

      {/* Prompt Preview Modal */}
      {showPromptModal && previewData && (
        <PromptPreviewModal
          systemPrompt={previewData.system_prompt}
          posts={previewData.posts}
          generating={generating}
          onConfirm={(sp, ups) => handleBatchGenerate(sp, ups)}
          onCancel={() => setShowPromptModal(false)}
        />
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
        className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
      >
        {open ? '▲ 隐藏已归档活动' : '▼ 查看已归档活动'}
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          {loading && <p className="text-xs text-gray-400 animate-pulse">加载中…</p>}
          {!loading && archived.length === 0 && (
            <p className="text-xs text-gray-400">暂无归档活动</p>
          )}
          {archived.map(c => (
            <div key={c.id} className="bg-gray-50 rounded-lg border border-gray-100 px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">{c.title}</p>
                {c.valid_from && (
                  <p className="text-xs text-gray-400">{c.valid_from} → {c.valid_until ?? '—'}</p>
                )}
              </div>
              <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">归档</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

const INPUT_CLASS = 'w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-colors'
