'use client'

/**
 * StudioArticleWorkbench — the editable + AI-conversation workbench for a
 * generated SEO article.
 *
 * Design law (every Magic Engine content surface): Master Brief / Campaign is
 * the base, but the FDE — who talks directly to the client — must always have
 * (a) a manual edit channel and (b) an AI modify/recommend channel. This is
 * NOT a vending machine; it is a collaboration surface.
 *
 *   Left column  — editable title / meta description / body (save on blur → PATCH)
 *   Right column — AI conversation: FDE instructs, Claude refines (→ refine API)
 *
 * Mirrors the Reels Studio editable-fields + chat pattern.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import type { ChatMessage } from '@/lib/blog/refiner'

const API_KEY = process.env.NEXT_PUBLIC_INTERNAL_API_KEY ?? ''

// ─── Shared article shape ─────────────────────────────────────────────────────

export interface ArticlePost {
  id: string
  title: string
  meta_title: string
  meta_description: string
  html_body: string
  word_count: number | null
  cost_usd: number | null
  status: string
  featured_image_url: string | null
  featured_image_prompt: string | null
}

/** Map a raw blog_posts API row to the workbench's ArticlePost shape. */
export function toArticlePost(p: Record<string, unknown>): ArticlePost {
  return {
    id:               String(p.id ?? ''),
    title:            String(p.title ?? ''),
    meta_title:       String(p.meta_title ?? ''),
    meta_description: String(p.meta_description ?? ''),
    html_body:        String(p.html_body ?? ''),
    word_count:       typeof p.word_count === 'number' ? p.word_count : null,
    cost_usd:         typeof p.cost_usd === 'number' ? p.cost_usd : null,
    status:           String(p.status ?? 'draft'),
    featured_image_url:    typeof p.featured_image_url === 'string' ? p.featured_image_url : null,
    featured_image_prompt: typeof p.featured_image_prompt === 'string' ? p.featured_image_prompt : null,
  }
}

// ─── Editable field (textarea, save on blur) ──────────────────────────────────

function EditableField({ label, value, rows, saving, onSave }: {
  label: string
  value: string
  rows: number
  saving: boolean
  onSave: (v: string) => void
}) {
  const [local, setLocal] = useState(value)
  const [dirty, setDirty] = useState(false)

  // Sync from props only when the field is NOT being actively edited, so an AI
  // refinement that lands mid-edit never clobbers unsaved FDE input.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!dirty) setLocal(value) }, [value])

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-semibold text-gray-700">{label}</label>
        {dirty && (
          <button
            onClick={() => { onSave(local); setDirty(false) }}
            disabled={saving}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        )}
      </div>
      <textarea
        value={local}
        rows={rows}
        onChange={e => { setLocal(e.target.value); setDirty(e.target.value !== value) }}
        onBlur={() => { if (dirty) { onSave(local); setDirty(false) } }}
        className="w-full text-sm text-gray-800 border-none outline-none resize-none leading-relaxed placeholder-gray-300"
      />
    </div>
  )
}

// ─── Main workbench ───────────────────────────────────────────────────────────

interface Props {
  clientId: string
  post: ArticlePost
  executionItemId?: string
  onPostUpdated: (post: ArticlePost) => void
  onRegenerate: () => void
}

export function StudioArticleWorkbench({ clientId, post, executionItemId, onPostUpdated, onRegenerate }: Props) {
  const [savingField, setSavingField]   = useState<string | null>(null)
  const [opError, setOpError]           = useState('')
  const [bodyEditMode, setBodyEditMode] = useState(false)
  const [bodyLocal, setBodyLocal]       = useState(post.html_body)
  const [bodyDirty, setBodyDirty]       = useState(false)

  // Hero image panel state
  const [imgPrompt, setImgPrompt]           = useState(() => post.featured_image_prompt ?? '')
  const [imgGenerating, setImgGenerating]   = useState(false)
  const [imgError, setImgError]             = useState('')
  const [showPromptEdit, setShowPromptEdit] = useState(false)

  // Publish to GitHub state
  const [publishing, setPublishing]   = useState(false)
  const [publishedPr, setPublishedPr] = useState<{ url: string; number: number } | null>(null)
  const [publishError, setPublishError] = useState('')

  // Chat state — kept client-side; the refine API is stateless re: history.
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput]     = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // Same guard as EditableField — never discard an in-flight manual HTML edit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!bodyDirty) setBodyLocal(post.html_body) }, [post.html_body])
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chatHistory])

  // ── Manual edit → PATCH ─────────────────────────────────────────────────────
  const patchField = useCallback(async (patch: Record<string, string>, label: string) => {
    setSavingField(label)
    setOpError('')
    try {
      const res = await fetch(`/api/clients/${clientId}/blog/${post.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify(patch),
      })
      const j = await res.json()
      if (res.ok && j.success && j.post) {
        onPostUpdated(toArticlePost(j.post))
      } else {
        setOpError(j.error ?? '保存失败')
      }
    } catch {
      setOpError('保存失败，请重试')
    } finally {
      setSavingField(null)
    }
  }, [clientId, post.id, onPostUpdated])

  // ── Publish to GitHub → PR ──────────────────────────────────────────────────
  const publishToGitHub = async () => {
    setPublishing(true)
    setPublishError('')
    try {
      const res = await fetch(`/api/clients/${clientId}/cms/publish-blog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({
          blog_post_id:      post.id,
          execution_item_id: executionItemId,
        }),
      })
      const j = await res.json()
      if (!res.ok || !j.success) throw new Error(j.error ?? '推送失败')
      setPublishedPr({ url: j.pr_url, number: j.pr_number })
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : '推送失败，请重试')
    } finally {
      setPublishing(false)
    }
  }

  // ── Hero image generation ───────────────────────────────────────────────────
  const generateHeroImage = async () => {
    setImgGenerating(true)
    setImgError('')
    try {
      const promptOverride = imgPrompt.trim()
      const res = await fetch(`/api/clients/${clientId}/blog/${post.id}/image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify(
          promptOverride && promptOverride !== post.featured_image_prompt
            ? { prompt_override: promptOverride }
            : {}
        ),
      })
      const j = await res.json()
      if (!res.ok || !j.success || !j.post) throw new Error(j.error ?? '生成失败')
      onPostUpdated(toArticlePost(j.post))
    } catch (e) {
      setImgError(e instanceof Error ? e.message : '生成失败')
    } finally {
      setImgGenerating(false)
    }
  }

  // ── AI conversation → refine ────────────────────────────────────────────────
  const sendChat = async () => {
    const msg = chatInput.trim()
    if (!msg || chatLoading) return
    setChatInput('')
    setChatLoading(true)
    setOpError('')
    const priorHistory = chatHistory  // snapshot before appending the new turn
    setChatHistory(h => [...h, { role: 'user', content: msg }])
    try {
      const res = await fetch(`/api/clients/${clientId}/blog/${post.id}/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({ message: msg, history: priorHistory }),
      })
      const j = await res.json()
      if (!res.ok || !j.success || !j.post) throw new Error(j.error ?? '修改失败')
      onPostUpdated(toArticlePost(j.post))
      setChatHistory(h => [...h, { role: 'assistant', content: j.assistant_reply ?? '已更新。' }])
    } catch (e) {
      setChatHistory(h => [...h, {
        role: 'assistant',
        content: `⚠ ${e instanceof Error ? e.message : '修改失败'} —— 请重试。`,
      }])
    } finally {
      setChatLoading(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* Status strip */}
      <div className="flex items-center gap-3 flex-wrap bg-green-50 border border-green-200 rounded-xl px-4 py-2.5">
        <span className="text-sm font-semibold text-green-900">✅ 草稿已生成 · 可直接编辑或让 AI 修改</span>
        <span className="text-xs text-gray-500">
          {post.word_count != null && <>{post.word_count} 字 · </>}
          {post.cost_usd != null && <>成本 ${post.cost_usd.toFixed(4)}</>}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {publishedPr ? (
            <a
              href={publishedPr.url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 text-xs font-semibold bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
            >
              ✓ PR #{publishedPr.number} 已创建 →
            </a>
          ) : (
            <button
              onClick={() => void publishToGitHub()}
              disabled={publishing}
              className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg transition-colors"
            >
              {publishing ? '推送中…' : '📤 推送到网站'}
            </button>
          )}
          <Link
            href={`/dashboard/clients/${clientId}/blog/${post.id}`}
            className="px-3 py-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800 border border-indigo-200 hover:border-indigo-400 rounded-lg transition-colors"
          >
            查看全文 →
          </Link>
          <button
            onClick={onRegenerate}
            className="px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
          >
            再生成一篇
          </button>
        </div>
      </div>

      {publishError && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{publishError}</p>
      )}
      {opError && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{opError}</p>
      )}

      {/* Two-column workbench */}
      <div className="flex gap-4 items-start">
        {/* Left — editable article */}
        <div className="flex-1 min-w-0 space-y-3">
          <EditableField
            label="📰 标题"
            value={post.title}
            rows={2}
            saving={savingField === 'title'}
            onSave={v => patchField({ title: v }, 'title')}
          />
          <EditableField
            label="🔖 Meta 描述（≤155 字符）"
            value={post.meta_description}
            rows={3}
            saving={savingField === 'meta_description'}
            onSave={v => patchField({ meta_description: v }, 'meta_description')}
          />

          {/* Hero image panel */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-gray-700">🖼 头图配图</label>
              <button
                onClick={() => setShowPromptEdit(v => !v)}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                {showPromptEdit ? '收起提示词' : '✏️ 编辑提示词'}
              </button>
            </div>

            {post.featured_image_url ? (
              <div className="mb-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={post.featured_image_url}
                  alt={post.title}
                  className="w-full rounded-lg object-cover max-h-52"
                />
              </div>
            ) : (
              <div className="border-2 border-dashed border-gray-200 rounded-lg h-20 flex items-center justify-center mb-2">
                <p className="text-xs text-gray-400">尚未生成头图</p>
              </div>
            )}

            {showPromptEdit && (
              <textarea
                value={imgPrompt}
                onChange={e => setImgPrompt(e.target.value)}
                rows={3}
                placeholder="图片提示词（自动基于文章内容 + 品牌视觉 DNA + Campaign 生成）"
                className="w-full text-xs text-gray-700 border border-gray-200 rounded-lg p-2 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500 mb-2"
              />
            )}

            {imgError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 mb-2">{imgError}</p>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={() => void generateHeroImage()}
                disabled={imgGenerating}
                className="px-4 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded-lg transition-colors"
              >
                {imgGenerating
                  ? '⏳ 生成中（约 20 秒）…'
                  : post.featured_image_url
                    ? '🔄 重新生成'
                    : '✨ 生成配图'}
              </button>
              <p className="text-[11px] text-gray-400">基于 Master Brief 视觉 DNA + 当前 Campaign</p>
            </div>
          </div>

          {/* Body — preview / raw HTML edit */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-gray-700">📄 正文</label>
              <div className="flex items-center gap-2">
                {bodyEditMode && bodyDirty && (
                  <button
                    onClick={() => { patchField({ html_body: bodyLocal }, 'html_body'); setBodyDirty(false) }}
                    disabled={savingField === 'html_body'}
                    className="text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
                  >
                    {savingField === 'html_body' ? '保存中…' : '保存'}
                  </button>
                )}
                <button
                  onClick={() => setBodyEditMode(v => !v)}
                  className="text-xs font-medium text-gray-500 hover:text-indigo-600 transition-colors"
                >
                  {bodyEditMode ? '👁 预览' : '✏️ 编辑 HTML'}
                </button>
              </div>
            </div>
            {bodyEditMode ? (
              <textarea
                value={bodyLocal}
                rows={20}
                onChange={e => { setBodyLocal(e.target.value); setBodyDirty(e.target.value !== post.html_body) }}
                onBlur={() => {
                  if (bodyDirty) { patchField({ html_body: bodyLocal }, 'html_body'); setBodyDirty(false) }
                }}
                className="w-full text-xs font-mono text-gray-700 border border-gray-200 rounded-lg p-3 outline-none resize-y leading-relaxed"
              />
            ) : (
              // Internal-only surface (FDE dashboard). html_body is AI-generated or
              // FDE-edited HTML, size-capped server-side; rendered for its own author.
              <div
                className="prose prose-sm max-w-none max-h-[520px] overflow-y-auto"
                dangerouslySetInnerHTML={{ __html: post.html_body }}
              />
            )}
          </div>
        </div>

        {/* Right — AI conversation */}
        <div className="w-80 flex-shrink-0 flex flex-col bg-white rounded-xl border border-gray-200 overflow-hidden sticky top-0">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">✏️ AI 修改 / 建议</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              把从客户那听来的要求告诉 AI —— 它会改文章
            </p>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-[200px] max-h-[60vh]">
            {chatHistory.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-2xl mb-2">💬</p>
                <p className="text-xs text-gray-400">例如：</p>
                <p className="text-xs text-gray-400 mt-1">「开头重写，突出 20 年家庭游经验」</p>
                <p className="text-xs text-gray-400 mt-1">「语气更温暖，客户说现在太官方」</p>
                <p className="text-xs text-gray-400 mt-1">「加一段小团游的优势」</p>
              </div>
            ) : (
              chatHistory.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                    m.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700'
                  }`}>
                    {m.content}
                  </div>
                </div>
              ))
            )}
            {chatLoading && (
              <div className="flex justify-start">
                <div className="bg-gray-100 text-gray-400 text-xs rounded-xl px-3 py-2 animate-pulse">
                  AI 正在修改文章…
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="px-4 py-3 border-t border-gray-100">
            <div className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendChat() }
                }}
                placeholder="告诉 AI 怎么改…"
                disabled={chatLoading}
                className="flex-1 text-xs text-gray-900 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
              />
              <button
                onClick={() => void sendChat()}
                disabled={chatLoading || !chatInput.trim()}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white px-3 py-2 rounded-lg text-sm transition-colors"
              >
                →
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
