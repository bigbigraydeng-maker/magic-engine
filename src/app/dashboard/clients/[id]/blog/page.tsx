'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { BlogOpportunity, ContentAuditResult } from '@/types/magic-engine';

interface KeywordSuggestion {
  keyword: string;
  volume: number;
  kd: number;
  intent: string | null;
  tier: 'A' | 'B';
}


interface BlogPostSummary {
  id: string;
  mode: string;
  topic: string;
  source_query_text: string | null;
  title: string;
  meta_title: string;
  word_count: number | null;
  status: string;
  featured_image_url: string | null;
  cost_usd: number | null;
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  draft:      'bg-amber-100 text-amber-700',
  approved:   'bg-blue-100 text-blue-700',
  published:  'bg-green-100 text-green-700',
  rejected:   'bg-gray-100 text-gray-500',
  generating: 'bg-purple-100 text-purple-700',
  failed:     'bg-red-100 text-red-700',
};

const WEAKNESS_COLORS = (score: number) =>
  score >= 0.8 ? 'text-red-600 bg-red-50 border-red-200' :
  score >= 0.5 ? 'text-amber-600 bg-amber-50 border-amber-200' :
                 'text-yellow-600 bg-yellow-50 border-yellow-200';

const POLL_INTERVAL_MS = 5000;

export default function ClientBlogPage() {
  const params = useParams();
  const clientId = params.id as string;

  const [opportunities, setOpportunities] = useState<BlogOpportunity[]>([]);
  const [posts, setPosts] = useState<BlogPostSummary[]>([]);
  const [clientName, setClientName] = useState('');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState('');
  const [actionOk, setActionOk] = useState<boolean | null>(null);
  const [upgradeRec, setUpgradeRec] = useState<{
    opp: BlogOpportunity;
    audit: ContentAuditResult;
  } | null>(null);

  const [freeFormOpen, setFreeFormOpen] = useState(false);
  const [selectedKeyword, setSelectedKeyword] = useState<KeywordSuggestion | null>(null);
  const [seoKeywords, setSeoKeywords] = useState<KeywordSuggestion[]>([]);
  const [keywordsLoading, setKeywordsLoading] = useState(false);
  const [freeMode, setFreeMode] = useState<'unified' | 'geo_only'>('unified');
  const [freeWordCount, setFreeWordCount] = useState(1200);
  const [freeGenerating, setFreeGenerating] = useState(false);

  const flash = (msg: string, ok: boolean) => {
    setActionMsg(msg);
    setActionOk(ok);
    setTimeout(() => { setActionMsg(''); setActionOk(null); }, 8000);
  };

  const fetchAll = useCallback(async () => {
    try {
      const [clientRes, opRes, postsRes] = await Promise.all([
        fetch(`/api/clients/${clientId}`),
        fetch(`/api/clients/${clientId}/blog/opportunities`),
        fetch(`/api/clients/${clientId}/blog?limit=50`),
      ]);
      if (clientRes.ok) {
        const j = await clientRes.json();
        setClientName(j.client?.name ?? clientId);
      }
      if (opRes.ok) {
        const j = await opRes.json();
        setOpportunities(j.opportunities ?? []);
      }
      if (postsRes.ok) {
        const j = await postsRes.json();
        setPosts(j.posts ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  const fetchKeywordSuggestions = useCallback(async () => {
    setKeywordsLoading(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/blog/keyword-suggestions`);
      if (res.ok) {
        const j = await res.json();
        setSeoKeywords(j.suggestions ?? []);
      }
    } finally {
      setKeywordsLoading(false);
    }
  }, [clientId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useEffect(() => { fetchKeywordSuggestions(); }, [fetchKeywordSuggestions]);

  // Auto-poll while any post is generating
  const hasGenerating = posts.some(p => p.status === 'generating');
  useEffect(() => {
    if (!hasGenerating) return;
    const timer = setInterval(() => { void fetchAll(); }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasGenerating, fetchAll]);

  const handleFreeGenerate = async () => {
    if (!selectedKeyword) return;
    const kw = selectedKeyword.keyword;
    setFreeGenerating(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/blog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: freeMode,
          topic: kw,
          source_query_text: kw,
          word_count_target: freeWordCount,
          skip_audit: false,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error ?? 'Generation failed');

      if (j.action === 'upgrade' && j.audit) {
        setUpgradeRec({
          opp: { query_id: kw, query_text: kw, weakness_score: 0, engines_missing: [], total_runs_checked: 0, last_run_at: null, mode: 'seo_only' },
          audit: j.audit as ContentAuditResult,
        });
        setActionMsg('');
        setActionOk(null);
      } else {
        // action === 'queued'
        setSelectedKeyword(null);
        setFreeFormOpen(false);
        flash('⏳ 正在后台生成，稍后可在下方查看结果', true);
        await fetchAll();
      }
    } catch (err: unknown) {
      flash(err instanceof Error ? err.message : 'Generation failed', false);
    } finally {
      setFreeGenerating(false);
    }
  };

  const handleGenerate = async (opp: BlogOpportunity, skipAudit = false) => {
    setGenerating(opp.query_id);
    setUpgradeRec(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/blog`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'geo_only',
          topic: opp.query_text,
          source_query_id: opp.query_id,
          source_query_text: opp.query_text,
          word_count_target: 1000,
          skip_audit: skipAudit,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error ?? 'Generation failed');

      if (j.action === 'upgrade' && j.audit) {
        setUpgradeRec({ opp, audit: j.audit as ContentAuditResult });
        setActionMsg('');
        setActionOk(null);
      } else {
        flash('⏳ 正在后台生成，稍后可在下方查看结果', true);
        await fetchAll();
      }
    } catch (err: unknown) {
      flash(err instanceof Error ? err.message : 'Generation failed', false);
    } finally {
      setGenerating(null);
    }
  };

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="animate-pulse space-y-3">
          <div className="h-7 bg-gray-200 rounded w-48" />
          <div className="grid grid-cols-2 gap-4">
            {[1,2,3,4].map(i => <div key={i} className="h-28 bg-gray-200 rounded-xl" />)}
          </div>
        </div>
      </div>
    );
  }

  const generatingCount = posts.filter(p => p.status === 'generating').length;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Link href={`/dashboard/clients/${clientId}`}
          className="text-gray-400 hover:text-gray-600 text-sm flex-shrink-0">
          ← {clientName}
        </Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-2xl font-bold text-gray-900">Blog Posts</h1>
        {generatingCount > 0 && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
            {generatingCount} 正在生成
          </span>
        )}
        {actionMsg && (
          <span className={`text-sm font-medium ml-2 ${actionOk ? 'text-green-600' : 'text-red-600'}`}>
            {actionMsg}
          </span>
        )}
      </div>

      {/* ── Free Keyword Generation ───────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200">
        <button
          onClick={() => setFreeFormOpen(v => !v)}
          className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors rounded-xl"
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">✍️</span>
            <div>
              <p className="text-sm font-semibold text-gray-900">Generate Article from Keyword</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Uses active Master Brief + current Campaign — results stay on-brand &amp; on-campaign
              </p>
            </div>
          </div>
          <span className="text-gray-400 text-sm">{freeFormOpen ? '▲' : '▼'}</span>
        </button>

        {freeFormOpen && (
          <div className="border-t border-gray-100 px-5 py-4 space-y-4">
            {/* Keyword selector */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-gray-600">
                  Select Keyword <span className="text-red-500">*</span>
                </label>
                {seoKeywords.length > 0 && (
                  <span className="text-[10px] text-gray-400">
                    From SEO Gap Analysis · {seoKeywords.length} opportunities
                  </span>
                )}
              </div>

              {keywordsLoading ? (
                <div className="flex gap-2 flex-wrap">
                  {[1,2,3,4,5].map(i => (
                    <div key={i} className="h-8 w-36 bg-gray-100 animate-pulse rounded-full" />
                  ))}
                </div>
              ) : seoKeywords.length === 0 ? (
                <div className="bg-gray-50 border border-dashed border-gray-200 rounded-lg px-4 py-3 text-sm text-gray-500 text-center">
                  No SEO keyword suggestions yet.{' '}
                  <Link
                    href={`/dashboard/clients/${clientId}/seo-gap`}
                    className="text-indigo-600 hover:text-indigo-800 font-medium"
                  >
                    Run SEO Gap Analysis →
                  </Link>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {seoKeywords.map(kw => {
                    const isSelected = selectedKeyword?.keyword === kw.keyword;
                    const intentColor = kw.intent === 'transactional' ? 'bg-green-100 text-green-700'
                      : kw.intent === 'informational' ? 'bg-blue-100 text-blue-700'
                      : 'bg-gray-100 text-gray-600';
                    return (
                      <button
                        key={kw.keyword}
                        onClick={() => setSelectedKeyword(isSelected ? null : kw)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                          isSelected
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                            : 'bg-white text-gray-700 border-gray-200 hover:border-indigo-400 hover:text-indigo-700'
                        }`}
                      >
                        {isSelected && <span>✓</span>}
                        <span>{kw.keyword}</span>
                        {kw.volume > 0 && (
                          <span className={`px-1 rounded text-[10px] font-semibold ${isSelected ? 'bg-indigo-500 text-white' : 'bg-gray-100 text-gray-500'}`}>
                            {kw.volume >= 1000 ? `${(kw.volume/1000).toFixed(1)}k` : kw.volume}
                          </span>
                        )}
                        {kw.intent && (
                          <span className={`px-1 rounded text-[10px] ${isSelected ? 'bg-indigo-500 text-white' : intentColor}`}>
                            {kw.intent.slice(0,4)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {selectedKeyword && (
                <p className="text-xs text-indigo-600 mt-2 font-medium">
                  Selected: &ldquo;{selectedKeyword.keyword}&rdquo; · Vol {selectedKeyword.volume} · KD {selectedKeyword.kd}
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-4">
              {/* Mode */}
              <div className="flex-1 min-w-[160px]">
                <label className="block text-xs font-semibold text-gray-600 mb-1">Mode</label>
                <div className="flex gap-2">
                  {([['unified', '🔀 SEO + GEO'], ['geo_only', '🤖 GEO only']] as const).map(([val, label]) => (
                    <button
                      key={val}
                      onClick={() => setFreeMode(val)}
                      className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium border transition-colors ${
                        freeMode === val
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-gray-400 mt-1">
                  {freeMode === 'unified' ? 'SEO keywords + AI entity signals' : 'AI visibility signals only'}
                </p>
              </div>

              {/* Word count */}
              <div className="flex-1 min-w-[120px]">
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Target words
                </label>
                <select
                  value={freeWordCount}
                  onChange={e => setFreeWordCount(Number(e.target.value))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-800 focus:border-indigo-500 focus:outline-none"
                >
                  <option value={800}>~800</option>
                  <option value={1000}>~1,000</option>
                  <option value={1200}>~1,200</option>
                  <option value={1500}>~1,500</option>
                  <option value={2000}>~2,000</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={() => void handleFreeGenerate()}
                disabled={freeGenerating || !selectedKeyword}
                className="px-5 py-2 text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded-lg transition-colors"
              >
                {freeGenerating ? '⏳ 提交中…' : '✨ Generate'}
              </button>
              <p className="text-[11px] text-gray-400">
                后台生成，提交后即可离开此页面
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Content Audit: Upgrade Recommendation ─────────────────── */}
      {upgradeRec && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-5 space-y-3">
          <div className="flex items-start gap-3">
            <span className="text-2xl flex-shrink-0">🔄</span>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-amber-900 text-sm">
                Existing Content Detected — Upgrade Recommended
              </p>
              <p className="text-xs text-amber-700 mt-1">{upgradeRec.audit.reason}</p>
              {upgradeRec.audit.existing_url && (
                <a
                  href={upgradeRec.audit.existing_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-indigo-600 hover:underline mt-1 block truncate"
                >
                  📄 {upgradeRec.audit.existing_title ?? upgradeRec.audit.existing_url}
                </a>
              )}
              <p className="text-xs text-amber-600 mt-2">
                Confidence: {Math.round(upgradeRec.audit.confidence * 100)}% ·
                {upgradeRec.audit.discovered_urls.length} articles scanned
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={() => handleGenerate(upgradeRec.opp, true)}
              disabled={!!generating}
              className="px-4 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-lg transition-colors"
            >
              {generating ? '⏳ 提交中…' : '✨ Generate New Anyway'}
            </button>
            <button
              onClick={() => setUpgradeRec(null)}
              className="px-4 py-2 text-xs font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-lg transition-colors"
            >
              Dismiss
            </button>
            {upgradeRec.audit.existing_url && (
              <a
                href={upgradeRec.audit.existing_url}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300 hover:border-gray-400 rounded-lg transition-colors"
              >
                Open Existing Article →
              </a>
            )}
          </div>
        </div>
      )}

      {/* ── AI Weak Spot Topics ────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              🎯 AI Weak Spot Topics
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Queries where AI systems are not recommending {clientName}. Each is a blog opportunity.
            </p>
          </div>
          <span className="text-xs text-gray-400">{opportunities.length} topics</span>
        </div>

        {opportunities.length === 0 ? (
          <div className="bg-gray-50 border border-gray-200 rounded-xl px-5 py-8 text-center text-sm text-gray-500">
            No weak spots detected yet — run the AI Visibility Tracker first to generate topics.
            <div className="mt-3">
              <Link href={`/dashboard/ai-visibility/${clientId}`}
                className="text-indigo-600 hover:text-indigo-800 font-medium">
                → Go to AI Visibility Tracker
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {opportunities.map(opp => {
              const isGenerating = generating === opp.query_id;
              const scoreLabel = opp.weakness_score >= 0.8 ? '🔴 Critical'
                : opp.weakness_score >= 0.5 ? '🟡 High' : '🟠 Medium';
              return (
                <div key={opp.query_id}
                  className={`bg-white rounded-xl border p-4 flex flex-col gap-3 ${WEAKNESS_COLORS(opp.weakness_score)}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-gray-900 leading-snug flex-1">
                      &quot;{opp.query_text}&quot;
                    </p>
                    <span className="text-xs font-semibold flex-shrink-0">{scoreLabel}</span>
                  </div>
                  <div className="text-xs text-gray-500 space-y-0.5">
                    <p>Missed by: {opp.engines_missing.join(', ') || 'all engines'}</p>
                    <p>Weak in {Math.round(opp.weakness_score * 100)}% of {opp.total_runs_checked} runs</p>
                  </div>
                  <button
                    onClick={() => handleGenerate(opp)}
                    disabled={!!generating}
                    className="mt-auto w-full py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-lg transition-colors"
                  >
                    {isGenerating ? '⏳ 提交中…' : '✨ Generate Blog Post'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Generated Posts ───────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-gray-900">
            📝 Generated Posts
          </h2>
          <div className="flex items-center gap-3">
            {hasGenerating && (
              <span className="text-xs text-purple-600 flex items-center gap-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
                每 5 秒自动刷新
              </span>
            )}
            <span className="text-xs text-gray-400">{posts.length} posts</span>
          </div>
        </div>

        {posts.length === 0 ? (
          <div className="bg-gray-50 border border-dashed border-gray-300 rounded-xl px-5 py-8 text-center text-sm text-gray-400">
            No posts yet. Click &quot;✨ Generate Blog Post&quot; on any topic above to start.
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
            {posts.map(post => {
              const isPostGenerating = post.status === 'generating';
              const isPostFailed = post.status === 'failed';

              const inner = (
                <div className={`flex items-center gap-4 px-5 py-4 ${!isPostGenerating && !isPostFailed ? 'hover:bg-gray-50 group' : ''} transition-colors`}>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold truncate ${
                      isPostGenerating ? 'text-purple-700' :
                      isPostFailed ? 'text-red-600' :
                      'text-gray-900 group-hover:text-indigo-700'
                    }`}>
                      {isPostGenerating
                        ? <span className="flex items-center gap-2">
                            <svg className="animate-spin h-3.5 w-3.5 text-purple-500 flex-shrink-0" viewBox="0 0 24 24" fill="none">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                            </svg>
                            {post.topic}
                          </span>
                        : (post.title || post.topic)
                      }
                    </p>
                    {post.source_query_text && (
                      <p className="text-xs text-gray-400 mt-0.5 truncate">
                        Topic: &quot;{post.source_query_text}&quot;
                      </p>
                    )}
                    {isPostGenerating && (
                      <p className="text-[10px] text-purple-500 mt-0.5">AI 正在撰写中，完成后自动显示…</p>
                    )}
                    {isPostFailed && (
                      <p className="text-[10px] text-red-500 mt-0.5">生成失败，请重新触发</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0 text-xs text-gray-500">
                    {post.word_count && <span>{post.word_count} words</span>}
                    {post.cost_usd && <span>${post.cost_usd.toFixed(4)}</span>}
                    <span className={`px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[post.status] ?? 'bg-gray-100 text-gray-500'}`}>
                      {post.status === 'generating' ? '生成中' :
                       post.status === 'failed' ? '失败' : post.status}
                    </span>
                    {!isPostGenerating && !isPostFailed && (
                      <span className="text-gray-300 group-hover:text-indigo-400">→</span>
                    )}
                  </div>
                </div>
              );

              if (isPostGenerating || isPostFailed) {
                return <div key={post.id}>{inner}</div>;
              }

              return (
                <Link key={post.id} href={`/dashboard/clients/${clientId}/blog/${post.id}`}>
                  {inner}
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
