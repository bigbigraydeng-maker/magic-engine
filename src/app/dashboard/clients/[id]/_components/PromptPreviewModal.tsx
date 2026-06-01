'use client'

import { useState } from 'react'

export interface PreviewPost {
  index: number
  route: 'route_a' | 'route_c'
  input: string
  user_prompt: string
}

interface Props {
  systemPrompt: string
  posts: PreviewPost[]
  generating: boolean
  onConfirm: (systemPrompt: string, userPrompts: string[]) => void
  onCancel: () => void
}

export function PromptPreviewModal({ systemPrompt, posts, generating, onConfirm, onCancel }: Props) {
  const [editedSystem, setEditedSystem] = useState(systemPrompt)
  const [editedPosts, setEditedPosts] = useState<string[]>(posts.map(p => p.user_prompt))

  const updatePost = (i: number, value: string) =>
    setEditedPosts(prev => prev.map((p, idx) => (idx === i ? value : p)))

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl max-h-[92vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="px-6 py-4 border-b border-black/[.06] flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-me-charcoal/90">Prompt 预览 · 共 {posts.length} 条</h2>
            <p className="text-xs text-me-charcoal/45 mt-0.5">
              确认 AI 将接收的指令，可在此编辑后再生成
            </p>
          </div>
          <button
            onClick={onCancel}
            className="text-me-charcoal/45 hover:text-me-charcoal/60 transition-colors text-xl leading-none"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6 min-h-0">

          {/* System prompt */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide">
                系统 Prompt
              </span>
              <span className="text-xs text-me-charcoal/45">（品牌底稿 + 活动上下文）</span>
            </div>
            <textarea
              value={editedSystem}
              onChange={e => setEditedSystem(e.target.value)}
              rows={8}
              className="w-full bg-me-ivory border border-black/10 rounded-xl px-3 py-2.5 text-xs text-me-charcoal/75 font-mono resize-y focus:outline-none focus:ring-2 focus:ring-me-ochre focus:bg-white transition-colors leading-relaxed"
            />
          </section>

          {/* Per-post user prompts */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide">
                每条内容的 User Prompt
              </span>
            </div>
            <div className="space-y-3">
              {posts.map((post, i) => (
                <div key={i} className="rounded-xl border border-black/[.06] bg-me-ivory p-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      post.route === 'route_a'
                        ? 'bg-me-ochre/10 text-me-ochre'
                        : 'bg-me-gold/20 text-me-ochre'
                    }`}>
                      {post.route === 'route_a' ? '🔑 关键词' : '💡 话题'} #{i + 1}
                    </span>
                    <span className="text-xs text-me-charcoal/45 font-mono truncate max-w-[220px]">
                      {post.input}
                    </span>
                  </div>
                  <textarea
                    value={editedPosts[i] ?? ''}
                    onChange={e => updatePost(i, e.target.value)}
                    rows={3}
                    className="w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-xs text-me-charcoal/75 font-mono resize-y focus:outline-none focus:ring-2 focus:ring-me-ochre transition-colors leading-relaxed"
                  />
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-black/[.06] flex items-center justify-between flex-shrink-0">
          <p className="text-xs text-me-charcoal/45">编辑后的 Prompt 将直接发送给 Content Engine</p>
          <div className="flex items-center gap-3">
            <button
              onClick={onCancel}
              className="text-sm text-me-charcoal/55 hover:text-me-charcoal/75 px-4 py-2 transition-colors"
            >
              取消
            </button>
            <button
              onClick={() => onConfirm(editedSystem, editedPosts)}
              disabled={generating}
              className="text-sm bg-me-ochre hover:bg-me-ochre/90 text-white px-5 py-2 rounded-xl font-semibold disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              {generating ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  生成中…
                </>
              ) : `确认生成 ${posts.length} 条`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
