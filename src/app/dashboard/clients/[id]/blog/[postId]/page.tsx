'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { GeoChecklist } from './_components/GeoChecklist';
import { PublishToWebsitePanel } from './_components/PublishToWebsitePanel';
import { buildBlogHtml, computeGeoChecklist } from '@/lib/blog/html-builder';
import type { BlogPost } from '@/types/magic-engine';


const STATUS_COLORS: Record<string, string> = {
  draft:      'bg-amber-100 text-amber-700',
  approved:   'bg-blue-100 text-blue-700',
  published:  'bg-green-100 text-green-700',
  rejected:   'bg-gray-100 text-gray-500',
  generating: 'bg-purple-100 text-purple-700',
  failed:     'bg-red-100 text-red-700',
};

/**
 * /dashboard/clients/[id]/blog/[postId]
 * Blog post viewer: two-column layout — rendered preview (left) + checklist (right).
 * Reference: ROADMAP.md P7.3.9–P7.3.12
 */
export default function BlogPostPage() {
  const params = useParams();
  const clientId = params.id as string;
  const postId   = params.postId as string;

  const [post, setPost]           = useState<BlogPost | null>(null);
  const [clientName, setClientName] = useState('');
  const [loading, setLoading]     = useState(true);
  const [showGeoBlock, setShowGeoBlock] = useState(false);
  const [copied, setCopied]       = useState<'html' | 'text' | null>(null);
  const [saving, setSaving]       = useState(false);
  const [actionMsg, setActionMsg] = useState('');
  const [actionOk, setActionOk]   = useState<boolean | null>(null);

  const flash = (msg: string, ok: boolean) => {
    setActionMsg(msg); setActionOk(ok);
    setTimeout(() => { setActionMsg(''); setActionOk(null); }, 5000);
  };

  const fetchPost = useCallback(async () => {
    setLoading(true);
    try {
      const [clientRes, postRes] = await Promise.all([
        fetch(`/api/clients/${clientId}`),
        fetch(`/api/clients/${clientId}/blog/${postId}`),
      ]);
      if (clientRes.ok) {
        const j = await clientRes.json();
        setClientName(j.client?.name ?? '');
      }
      if (postRes.ok) {
        const j = await postRes.json();
        setPost(j.post ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, [clientId, postId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchPost(); }, [fetchPost]);

  // Poll every 5 s while still generating
  useEffect(() => {
    if (!post || post.status !== 'generating') return
    const timer = setInterval(() => {
      fetch(`/api/clients/${clientId}/blog/${postId}`)
        .then(r => r.ok ? r.json() : null)
        .then(j => { if (j?.post) setPost(j.post) })
        .catch(() => {})
    }, 5000)
    return () => clearInterval(timer)
  }, [post?.status, clientId, postId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStatusChange = async (newStatus: string) => {
    if (!post) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/blog/${postId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error ?? 'Update failed');
      setPost(j.post);
      flash(`✓ Marked as ${newStatus}`, true);
    } catch (err: unknown) {
      flash(err instanceof Error ? err.message : 'Update failed', false);
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async (type: 'html' | 'text') => {
    if (!post) return;
    const { full_html, body_only } = buildBlogHtml(post);
    const content = type === 'html' ? full_html : body_only.replace(/<[^>]+>/g, '\n').trim();
    try {
      await navigator.clipboard.writeText(content);
      setCopied(type);
      setTimeout(() => setCopied(null), 2500);
    } catch {
      // ignore
    }
  };

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-64" />
          <div className="grid grid-cols-2 gap-6">
            <div className="h-[600px] bg-gray-200 rounded-xl" />
            <div className="h-[400px] bg-gray-200 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (post?.status === 'generating') {
    return (
      <div className="p-6 max-w-lg">
        <Link href={`/dashboard/clients/${clientId}/blog`}
          className="text-gray-400 hover:text-gray-600 text-sm block mb-4">
          ← Blog Posts
        </Link>
        <div className="rounded-xl border border-purple-200 bg-purple-50 p-6 flex items-start gap-4">
          <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-purple-900">文章生成中…</p>
            <p className="text-xs text-purple-700 mt-1">
              AI 正在撰写「{post.topic}」，通常需要 30–90 秒。页面将自动刷新。
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (post?.status === 'failed') {
    return (
      <div className="p-6 max-w-lg">
        <Link href={`/dashboard/clients/${clientId}/blog`}
          className="text-gray-400 hover:text-gray-600 text-sm block mb-4">
          ← Blog Posts
        </Link>
        <div className="rounded-xl border border-red-200 bg-red-50 p-6">
          <p className="text-sm font-semibold text-red-900">❌ 生成失败</p>
          <p className="text-xs text-red-700 mt-1">话题：「{post.topic}」。请返回执行看板重新生成。</p>
        </div>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="p-6">
        <p className="text-gray-500">Post not found.</p>
        <Link href={`/dashboard/clients/${clientId}/blog`}
          className="text-indigo-600 hover:underline text-sm mt-2 block">
          ← Back to Blog Posts
        </Link>
      </div>
    );
  }

  const checks = computeGeoChecklist(post, clientName);
  const { body_only } = buildBlogHtml(post);

  // Compose HTML for iframe preview (adds minimal styling)
  const previewHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${post.meta_title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         max-width: 720px; margin: 0 auto; padding: 24px; color: #111; line-height: 1.7; }
  h1 { font-size: 1.75rem; font-weight: 700; margin-bottom: 0.5rem; }
  h2 { font-size: 1.25rem; font-weight: 600; margin-top: 2rem; margin-bottom: 0.5rem; }
  h3 { font-size: 1rem; font-weight: 600; margin-top: 1.5rem; }
  p  { margin: 0.75rem 0; }
  ul, ol { padding-left: 1.5rem; }
  .me-blog-hero { margin: 0 0 1.75rem; }
  .me-blog-hero img { width: 100%; height: auto; border-radius: 12px; display: block; }
  .faq { background: #f8fafc; border-radius: 8px; padding: 16px 20px; margin-top: 2rem; }
  .faq h2, .faq h3 { margin-top: 0.5rem; }
  .geo-block-highlight { background: #fef9c3; border: 1px solid #fde047;
                         padding: 12px; margin-top: 2rem; border-radius: 6px;
                         font-size: 0.75rem; color: #78350f; }
</style>
</head>
<body>
${body_only}
${showGeoBlock && post.geo_html_snapshot
  ? `<div class="geo-block-highlight">
       <strong>🤖 GEO Directive Block (team-visible only)</strong>
       <pre style="white-space: pre-wrap; margin-top: 8px;">${post.geo_html_snapshot.replace(/<[^>]+>/g, '').trim()}</pre>
     </div>`
  : ''}
</body>
</html>`;

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Link href={`/dashboard/clients/${clientId}/blog`}
          className="text-gray-400 hover:text-gray-600 text-sm flex-shrink-0">
          ← Blog Posts
        </Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-lg font-semibold text-gray-900 truncate max-w-lg">
          {post.title || post.topic}
        </h1>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[post.status] ?? 'bg-gray-100 text-gray-500'}`}>
          {post.status}
        </span>
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-2 flex-wrap bg-white border border-gray-200 rounded-xl px-5 py-3">
        <div className="flex items-center gap-2">
          <button onClick={() => handleCopy('html')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              copied === 'html' ? 'bg-green-500 text-white border-green-500'
                               : 'border-gray-300 text-gray-700 hover:border-indigo-400 hover:text-indigo-700'
            }`}>
            {copied === 'html' ? '✓ Copied!' : 'Copy HTML'}
          </button>
          <button onClick={() => handleCopy('text')}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              copied === 'text' ? 'bg-green-500 text-white border-green-500'
                                : 'border-gray-300 text-gray-700 hover:border-indigo-400 hover:text-indigo-700'
            }`}>
            {copied === 'text' ? '✓ Copied!' : 'Copy Text'}
          </button>
          <PublishToWebsitePanel
            clientId={clientId}
            postId={postId}
            onSuccess={(_, result) => {
              if (result.prUrl) flash(`✓ PR #${result.prNumber} 已创建`, true);
              else flash('✓ 已发布到网站', true);
            }}
          />
          <button onClick={() => setShowGeoBlock(v => !v)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              showGeoBlock ? 'bg-indigo-100 text-indigo-700 border-indigo-300'
                           : 'border-gray-300 text-gray-600 hover:border-indigo-300'
            }`}>
            {showGeoBlock ? '🤖 Hide GEO Block' : '🤖 Show GEO Block'}
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {actionMsg && (
            <span className={`text-xs font-medium ${actionOk ? 'text-green-600' : 'text-red-600'}`}>
              {actionMsg}
            </span>
          )}
          {post.status === 'draft' && (
            <button onClick={() => handleStatusChange('approved')} disabled={saving}
              className="px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg transition-colors">
              {saving ? '…' : '✓ Approve'}
            </button>
          )}
          {post.status === 'approved' && (
            <button onClick={() => handleStatusChange('published')} disabled={saving}
              className="px-3 py-1.5 text-xs font-semibold bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white rounded-lg transition-colors">
              {saving ? '…' : '⚡ Mark Published'}
            </button>
          )}
          {post.status !== 'rejected' && (
            <button onClick={() => handleStatusChange('rejected')} disabled={saving}
              className="px-3 py-1.5 text-xs font-medium border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40 rounded-lg transition-colors">
              {saving ? '…' : 'Reject'}
            </button>
          )}
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left: rendered preview (2/3 width) */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Preview</h3>
              <div className="flex items-center gap-3 text-xs text-gray-400">
                {post.word_count && <span>{post.word_count} words</span>}
                {post.cost_usd && <span>Cost: ${post.cost_usd.toFixed(4)}</span>}
                {post.source_query_text && (
                  <span className="text-indigo-500">
                    🎯 &quot;{post.source_query_text}&quot;
                  </span>
                )}
              </div>
            </div>
            <iframe
              srcDoc={previewHtml}
              sandbox="allow-same-origin"
              className="w-full border-0"
              style={{ height: '700px' }}
              title="Blog post preview"
            />
          </div>
        </div>

        {/* Right: checklist + meta (1/3 width) */}
        <div className="space-y-4 lg:sticky lg:top-6">
          <GeoChecklist checks={checks} />

          {/* SEO meta info */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
            <h3 className="text-sm font-semibold text-gray-900">SEO Metadata</h3>
            <div>
              <p className="text-xs font-medium text-gray-500 mb-0.5">Meta Title</p>
              <p className="text-xs text-gray-800">{post.meta_title || '—'}</p>
              <p className="text-xs text-gray-400">{post.meta_title.length} chars</p>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 mb-0.5">Meta Description</p>
              <p className="text-xs text-gray-800">{post.meta_description || '—'}</p>
              <p className="text-xs text-gray-400">{post.meta_description.length} chars</p>
            </div>
            {post.slug && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-0.5">Slug</p>
                <p className="text-xs text-gray-800 font-mono">/blog/{post.slug}</p>
              </div>
            )}
            {post.featured_image_prompt && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-0.5">Image Prompt</p>
                <p className="text-xs text-gray-600 italic">{post.featured_image_prompt}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
