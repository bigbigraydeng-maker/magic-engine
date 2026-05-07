'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';

interface Client {
  id: string;
  name: string;
}

interface ContentPost {
  id: string;
  client_id: string;
  title: string;
  route: string;
  platforms: string[];
  status: string;
  caption?: string;
  script?: string;
  hashtags?: string[];
  visual_brief?: string;
  scheduled_at?: string | null;
  created_at: string;
  clients?: { name: string } | null;
}

const statusColors: Record<string, string> = {
  draft:     'bg-yellow-100 text-yellow-800',
  approved:  'bg-green-100 text-green-800',
  scheduled: 'bg-blue-100 text-blue-800',
  published: 'bg-gray-100 text-gray-700',
  rejected:  'bg-red-100 text-red-800',
};

const statusDotColors: Record<string, string> = {
  draft:     'bg-yellow-400',
  approved:  'bg-green-500',
  scheduled: 'bg-blue-500',
  published: 'bg-gray-400',
  rejected:  'bg-red-400',
};

const routeColors: Record<string, string> = {
  route_a: 'bg-purple-100 text-purple-700',
  route_b: 'bg-orange-100 text-orange-700',
  route_c: 'bg-teal-100 text-teal-700',
};

const routeLabels: Record<string, string> = {
  route_a: 'Route A',
  route_b: 'Route B',
  route_c: 'Route C',
};

const RATIO_OPTIONS = [
  { value: '1:1',  label: '方形 1:1 (通用)' },
  { value: '4:5',  label: '竖版 4:5 (Instagram 动态)' },
  { value: '9:16', label: '故事 9:16 (TikTok / Reels)' },
  { value: '16:9', label: '横版 16:9 (YouTube)' },
];

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

type ViewMode = 'list' | 'calendar';

function isNewPost(created_at: string) {
  return Date.now() - new Date(created_at).getTime() < 60 * 60 * 1000;
}

function suggestRatio(platforms: string[]): string {
  if (platforms.includes('tiktok')) return '9:16';
  if (platforms.includes('youtube')) return '16:9';
  if (platforms.includes('twitter')) return '16:9';
  if (platforms.includes('instagram')) return '4:5';
  if (platforms.includes('facebook')) return '4:5';
  return '1:1';
}

function getCalendarDays(year: number, month: number): (number | null)[] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  // Monday-first week: Mon=0, Tue=1 … Sun=6
  const startOffset = (firstDay.getDay() + 6) % 7;
  const totalCells = startOffset + lastDay.getDate();
  const rows = Math.ceil(totalCells / 7);
  const cells: (number | null)[] = [];
  for (let i = 0; i < rows * 7; i++) {
    const day = i - startOffset + 1;
    cells.push(day >= 1 && day <= lastDay.getDate() ? day : null);
  }
  return cells;
}

function ymd(iso: string): string {
  return iso.slice(0, 10);
}

// ── Calendar day cell ─────────────────────────────────────────────────────────

function CalendarCell({
  day, year, month, posts, onOpen,
}: {
  day: number | null;
  year: number;
  month: number;
  posts: ContentPost[];
  onOpen: (post: ContentPost) => void;
}) {
  const today = new Date();
  const isToday = day !== null
    && today.getFullYear() === year
    && today.getMonth() === month
    && today.getDate() === day;

  const dayStr = day
    ? `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    : '';

  const dayPosts = day
    ? posts.filter(p => p.scheduled_at && ymd(p.scheduled_at) === dayStr)
    : [];

  const visible = dayPosts.slice(0, 3);
  const hiddenCount = dayPosts.length - visible.length;

  return (
    <div className={`min-h-[96px] border-b border-r border-gray-100 p-1.5 ${
      day ? 'bg-white hover:bg-gray-50/60' : 'bg-gray-50/40'
    }`}>
      {day && (
        <>
          <div className={`text-xs font-semibold mb-1 w-6 h-6 flex items-center justify-center rounded-full ${
            isToday ? 'bg-indigo-600 text-white' : 'text-gray-500'
          }`}>
            {day}
          </div>
          <div className="space-y-0.5">
            {visible.map(post => (
              <button
                key={post.id}
                onClick={() => onOpen(post)}
                title={post.title}
                className={`w-full text-left text-[10px] leading-tight px-1.5 py-0.5 rounded flex items-center gap-1 truncate group ${statusColors[post.status] ?? 'bg-gray-100 text-gray-600'}`}
              >
                <span className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${statusDotColors[post.status] ?? 'bg-gray-400'}`} />
                <span className="truncate">{post.title}</span>
              </button>
            ))}
            {hiddenCount > 0 && (
              <div className="text-[10px] text-gray-400 px-1">+{hiddenCount} more</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ContentBoardPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [posts, setPosts] = useState<ContentPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedClient, setSelectedClient] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('draft');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [calYear, setCalYear] = useState(() => new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth());
  const [modalPost, setModalPost] = useState<ContentPost | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);

  // Batch selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batching, setBatching] = useState(false);
  const [batchMsg, setBatchMsg] = useState('');
  const [batchTargetStatus, setBatchTargetStatus] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Modal edit state
  const [editMode, setEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editScript, setEditScript] = useState('');
  const [editCaption, setEditCaption] = useState('');
  const [editHashtags, setEditHashtags] = useState('');
  const [editVisualBrief, setEditVisualBrief] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  // Modal image preview state
  const [previewRatio, setPreviewRatio] = useState('1:1');
  const [previewStatus, setPreviewStatus] = useState<'idle' | 'generating' | 'done' | 'failed'>('idle');
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  useEffect(() => {
    fetch('/api/clients').then(r => r.json()).then(d => setClients(d.clients ?? []));
  }, []);

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    setSelectedIds(new Set());
    setBatchMsg('');
    try {
      const params = new URLSearchParams();
      if (selectedClient) params.set('client_id', selectedClient);
      // Calendar mode: always fetch approved+scheduled so dates are populated
      const statusToFetch = viewMode === 'calendar' ? 'approved,scheduled' : selectedStatus;
      if (statusToFetch) params.set('status', statusToFetch);
      const res = await fetch(`/api/content/posts?${params}`);
      const json = await res.json();
      setPosts(json.posts ?? []);
    } finally {
      setLoading(false);
    }
  }, [selectedClient, selectedStatus, viewMode]);

  useEffect(() => { fetchPosts(); }, [fetchPosts]);

  // Switch to calendar mode → auto-set status to approved+scheduled
  const handleViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    if (mode === 'calendar') setSelectedStatus('approved,scheduled');
  };

  // ── Modal helpers ─────────────────────────────────────────────────────────

  const openModal = (post: ContentPost) => {
    setModalPost(post);
    setEditMode(false);
    setEditTitle(post.title);
    setEditScript(post.script ?? '');
    setEditCaption(post.caption ?? '');
    setEditHashtags((post.hashtags ?? []).join(' '));
    setEditVisualBrief(post.visual_brief ?? '');
    setSaveMsg('');
    setPreviewRatio(suggestRatio(post.platforms));
    setPreviewStatus('idle');
    setPreviewImageUrl(null);
    setPreviewError('');
    if (pollRef.current) clearInterval(pollRef.current);
  };

  const closeModal = () => {
    setModalPost(null);
    setEditMode(false);
    setSaveMsg('');
    setPreviewStatus('idle');
    setPreviewImageUrl(null);
    setPreviewError('');
    if (pollRef.current) clearInterval(pollRef.current);
  };

  // ── Save edits ────────────────────────────────────────────────────────────

  const handleSaveEdit = async () => {
    if (!modalPost) return;
    setSavingEdit(true);
    setSaveMsg('');
    try {
      const body = {
        title: editTitle,
        script: editScript,
        caption: editCaption,
        hashtags: editHashtags.split(/\s+/).filter(Boolean),
        visual_brief: editVisualBrief,
      };
      const res = await fetch(`/api/posts/${modalPost.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);

      const updated: ContentPost = {
        ...modalPost,
        title: editTitle,
        script: editScript || undefined,
        caption: editCaption || undefined,
        hashtags: editHashtags.split(/\s+/).filter(Boolean),
        visual_brief: editVisualBrief || undefined,
      };
      setModalPost(updated);
      setPosts(prev => prev.map(p => p.id === updated.id ? updated : p));
      setSaveMsg('✓ 已保存');
      setEditMode(false);
    } catch (err) {
      setSaveMsg(`✗ ${(err as Error).message}`);
    } finally {
      setSavingEdit(false);
    }
  };

  // ── Image preview generation ──────────────────────────────────────────────

  const handleGeneratePreview = async () => {
    if (!modalPost) return;
    setPreviewStatus('generating');
    setPreviewImageUrl(null);
    setPreviewError('');
    if (pollRef.current) clearInterval(pollRef.current);

    try {
      const res = await fetch('/api/visual/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          post_id: modalPost.id,
          client_id: modalPost.client_id,
          aspect_ratio: previewRatio,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      const assetId: string = json.asset_id;

      pollRef.current = setInterval(async () => {
        try {
          const pr = await fetch(`/api/visual/status/${assetId}`);
          const pj = await pr.json();
          const a = pj.asset;
          if (a?.generation_status === 'ready') {
            clearInterval(pollRef.current!);
            setPreviewStatus('done');
            setPreviewImageUrl(a.storage_url || a.provider_url || null);
          } else if (a?.generation_status === 'failed') {
            clearInterval(pollRef.current!);
            setPreviewStatus('failed');
            setPreviewError(a.error_message || '生成失败，请重试');
          }
        } catch { /* transient */ }
      }, 5000);
    } catch (err) {
      setPreviewStatus('failed');
      setPreviewError((err as Error).message);
    }
  };

  // ── Selection helpers ─────────────────────────────────────────────────────

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds(selectedIds.size === posts.length ? new Set() : new Set(posts.map(p => p.id)));
  };

  const batchUpdate = async (ids: string[], status: string) => {
    if (ids.length === 0) return;
    const prevPosts = posts;
    setPosts(prev => {
      const mapped = prev.map(p => ids.includes(p.id) ? { ...p, status } : p);
      // Remove posts that no longer match the active status filter
      if (!selectedStatus) return mapped;
      const allowed = selectedStatus.split(',');
      return mapped.filter(p => allowed.includes(p.status));
    });
    setSelectedIds(new Set());
    setBatchTargetStatus('');
    setBatching(true);
    setBatchMsg('');
    try {
      const res = await fetch('/api/posts/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_ids: ids, action: 'updateStatus', status }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      const label = ({ draft: '草稿', approved: '已批准', scheduled: '已排期', published: '已发布', rejected: '已拒绝' } as Record<string, string>)[status] ?? status;
      setBatchMsg(`✓ 已更新 ${json.updated} 条至"${label}"`);
    } catch (err) {
      setPosts(prevPosts);
      setSelectedIds(new Set(ids));
      setBatchMsg(`✗ ${(err as Error).message}`);
    } finally {
      setBatching(false);
    }
  };

  const handleBatchDelete = async () => {
    const ids = Array.from(selectedIds);
    setShowDeleteConfirm(false);
    const prevPosts = posts;
    const prevSelectedIds = new Set(selectedIds);
    setPosts(prev => prev.filter(p => !ids.includes(p.id)));
    setSelectedIds(new Set());
    setBatching(true);
    setBatchMsg('');
    try {
      const res = await fetch('/api/posts/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_ids: ids, action: 'delete' }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setBatchMsg(`✓ 已删除 ${json.deleted} 条内容`);
    } catch (err) {
      setPosts(prevPosts);
      setSelectedIds(prevSelectedIds);
      setBatchMsg(`✗ ${(err as Error).message}`);
    } finally {
      setBatching(false);
    }
  };

  const handleSyncAirtable = async (post: ContentPost) => {
    setSyncing(post.id);
    try {
      await fetch('/api/airtable/sync-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: selectedClient, post_ids: [post.id] }),
      });
    } finally { setSyncing(null); }
  };

  const allSelected = posts.length > 0 && selectedIds.size === posts.length;
  const someSelected = selectedIds.size > 0;

  // Calendar days
  const calDays = getCalendarDays(calYear, calMonth);
  const prevMonth = () => {
    if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11); }
    else setCalMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0); }
    else setCalMonth(m => m + 1);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">内容板</h1>
          <p className="text-sm text-gray-500 mt-1">{posts.length} 条内容</p>
        </div>
        <Link
          href="/dashboard/content/generate"
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          + 生成内容
        </Link>
      </div>

      {/* View toggle + filters */}
      <div className="flex gap-3 flex-wrap items-center">
        {/* View toggle */}
        <div className="flex rounded-lg border border-gray-200 bg-white overflow-hidden">
          <button
            onClick={() => handleViewMode('list')}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              viewMode === 'list'
                ? 'bg-indigo-600 text-white'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            ☰ 列表
          </button>
          <button
            onClick={() => handleViewMode('calendar')}
            className={`px-3 py-1.5 text-sm font-medium transition-colors border-l border-gray-200 ${
              viewMode === 'calendar'
                ? 'bg-indigo-600 text-white'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            📅 日历
          </button>
        </div>

        {/* Client filter */}
        <select
          value={selectedClient}
          onChange={e => setSelectedClient(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
        >
          <option value="">全部客户</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        {/* Status filter — only shown in list mode */}
        {viewMode === 'list' && (
          <select
            value={selectedStatus}
            onChange={e => setSelectedStatus(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
          >
            <option value="draft">草稿（待审批）</option>
            <option value="approved">已批准</option>
            <option value="scheduled">已排期</option>
            <option value="published">已发布</option>
            <option value="rejected">已拒绝</option>
            <option value="">全部</option>
          </select>
        )}

        {viewMode === 'calendar' && (
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded">
            日历显示：已批准 + 已排期
          </span>
        )}
      </div>

      {batchMsg && (
        <p className={`text-sm px-1 ${batchMsg.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>
          {batchMsg}
        </p>
      )}

      {/* Batch action bar */}
      {someSelected && viewMode === 'list' && (
        <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 flex-wrap gap-y-2">
          <span className="text-sm font-medium text-indigo-700">已选 {selectedIds.size} 条</span>
          <div className="flex gap-2 ml-auto flex-wrap">
            <select
              value={batchTargetStatus}
              onChange={e => setBatchTargetStatus(e.target.value)}
              className="border border-indigo-300 rounded-lg px-3 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              <option value="">— 修改状态 —</option>
              <option value="draft">草稿</option>
              <option value="approved">已批准</option>
              <option value="scheduled">已排期</option>
              <option value="published">已发布</option>
              <option value="rejected">已拒绝</option>
            </select>
            <button
              onClick={() => batchTargetStatus && batchUpdate(Array.from(selectedIds), batchTargetStatus)}
              disabled={!batchTargetStatus || batching}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-4 py-1.5 rounded-lg disabled:opacity-50 transition-colors font-medium"
            >
              {batching ? '处理中…' : '应用'}
            </button>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              disabled={batching}
              className="bg-red-500 hover:bg-red-600 text-white text-sm px-4 py-1.5 rounded-lg disabled:opacity-50 transition-colors font-medium"
            >
              🗑 删除 ({selectedIds.size})
            </button>
            <button onClick={() => setSelectedIds(new Set())} className="text-sm text-gray-500 hover:text-gray-700 px-2">取消</button>
          </div>
        </div>
      )}

      {/* ── CALENDAR VIEW ─────────────────────────────────────────────────── */}
      {viewMode === 'calendar' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* Month navigation */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <button onClick={prevMonth} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-600">
              ‹
            </button>
            <h2 className="text-sm font-semibold text-gray-800">
              {MONTH_NAMES[calMonth]} {calYear}
            </h2>
            <button onClick={nextMonth} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-600">
              ›
            </button>
          </div>

          {/* Legend */}
          <div className="flex gap-3 px-4 py-2 border-b border-gray-100 flex-wrap">
            {Object.entries(statusDotColors).map(([s, col]) => (
              <span key={s} className="flex items-center gap-1 text-xs text-gray-500">
                <span className={`w-2 h-2 rounded-full ${col}`} />
                {s === 'draft' ? '草稿' : s === 'approved' ? '已批准' : s === 'scheduled' ? '已排期' : s === 'published' ? '已发布' : '已拒绝'}
              </span>
            ))}
          </div>

          {/* Weekday headers */}
          <div className="grid grid-cols-7 border-b border-gray-100">
            {WEEKDAYS.map(d => (
              <div key={d} className="text-center text-xs font-medium text-gray-400 py-2 border-r border-gray-100 last:border-r-0">
                {d}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          {loading ? (
            <div className="py-20 text-center text-gray-400 text-sm">加载中…</div>
          ) : (
            <div className="grid grid-cols-7">
              {calDays.map((day, idx) => (
                <CalendarCell
                  key={idx}
                  day={day}
                  year={calYear}
                  month={calMonth}
                  posts={posts}
                  onOpen={openModal}
                />
              ))}
            </div>
          )}

          {/* Unscheduled posts */}
          {!loading && (() => {
            const unscheduled = posts.filter(p => !p.scheduled_at);
            if (unscheduled.length === 0) return null;
            return (
              <div className="border-t border-gray-100 px-4 py-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  未排期 ({unscheduled.length})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {unscheduled.map(p => (
                    <button
                      key={p.id}
                      onClick={() => openModal(p)}
                      title={p.title}
                      className={`text-xs px-2.5 py-1 rounded-full max-w-[180px] truncate ${statusColors[p.status] ?? 'bg-gray-100 text-gray-600'}`}
                    >
                      {p.title}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── LIST VIEW ─────────────────────────────────────────────────────── */}
      {viewMode === 'list' && (
        loading ? (
          <div className="py-12 text-center text-gray-400">加载中…</div>
        ) : posts.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 py-16 text-center text-gray-400">
            <p className="text-lg mb-2">暂无内容</p>
            {selectedStatus === 'draft' && (
              <p className="text-sm text-gray-400">前往客户推广活动，批量生成内容草稿</p>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 px-1">
              <input type="checkbox" checked={allSelected} onChange={toggleSelectAll}
                className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
              <span className="text-xs text-gray-500">{allSelected ? '取消全选' : `全选 (${posts.length})`}</span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {posts.map(post => (
                <div
                  key={post.id}
                  className={`bg-white rounded-xl border p-5 hover:shadow-md transition-shadow cursor-pointer ${
                    selectedIds.has(post.id) ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-gray-200'
                  }`}
                  onClick={() => toggleSelect(post.id)}
                >
                  <div className="flex items-start gap-3">
                    <input type="checkbox" checked={selectedIds.has(post.id)}
                      onChange={() => toggleSelect(post.id)} onClick={e => e.stopPropagation()}
                      className="mt-0.5 w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-1.5 flex-1 min-w-0">
                          <h3 className="text-sm font-semibold text-gray-900 leading-snug">{post.title}</h3>
                          {isNewPost(post.created_at) && (
                            <span className="flex-shrink-0 text-xs bg-emerald-500 text-white px-1.5 py-0.5 rounded font-bold tracking-wide">NEW</span>
                          )}
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${statusColors[post.status] ?? 'bg-gray-100 text-gray-600'}`}>
                          {post.status === 'draft' ? '草稿' : post.status === 'approved' ? '已批准' : post.status === 'scheduled' ? '已排期' : post.status === 'published' ? '已发布' : post.status === 'rejected' ? '已拒绝' : post.status}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${routeColors[post.route] ?? 'bg-gray-100 text-gray-600'}`}>
                          {routeLabels[post.route] ?? post.route}
                        </span>
                        {post.platforms?.map(p => (
                          <span key={p} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded capitalize">{p}</span>
                        ))}
                      </div>
                      {post.caption && <p className="text-xs text-gray-500 mt-3 line-clamp-2">{post.caption}</p>}
                      {post.scheduled_at && (
                        <p className="text-xs text-blue-500 mt-2">
                          📅 {new Date(post.scheduled_at).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                      )}
                      <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
                        <span className="text-xs text-gray-400">{new Date(post.created_at).toLocaleDateString()}</span>
                        <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                          <button onClick={() => openModal(post)} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">查看详情</button>
                          <span className="text-gray-300">·</span>
                          <button onClick={() => handleSyncAirtable(post)} disabled={syncing === post.id}
                            className="text-xs text-gray-500 hover:text-gray-700 font-medium disabled:opacity-50">
                            {syncing === post.id ? '同步中…' : '↑ Airtable'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )
      )}

      {/* ── Detail Modal ──────────────────────────────────────────────────── */}
      {modalPost && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={closeModal}>
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>

            {/* Modal header */}
            <div className="sticky top-0 bg-white rounded-t-2xl border-b border-gray-100 px-6 py-4 flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-gray-900 truncate">{modalPost.title}</h2>
                  {isNewPost(modalPost.created_at) && (
                    <span className="text-xs bg-emerald-500 text-white px-1.5 py-0.5 rounded font-bold tracking-wide flex-shrink-0">NEW</span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">
                  {new Date(modalPost.created_at).toLocaleString()} · {modalPost.clients?.name ?? ''}
                  {modalPost.scheduled_at && (
                    <span className="ml-2 text-blue-500">📅 {new Date(modalPost.scheduled_at).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {!editMode ? (
                  <button onClick={() => setEditMode(true)}
                    className="text-xs text-indigo-600 hover:text-indigo-800 border border-indigo-200 hover:border-indigo-400 px-3 py-1.5 rounded-lg font-medium transition-colors">
                    ✏️ 编辑
                  </button>
                ) : (
                  <button onClick={() => { setEditMode(false); setSaveMsg(''); }}
                    className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 px-3 py-1.5 rounded-lg font-medium transition-colors">
                    取消
                  </button>
                )}
                <button onClick={closeModal} className="text-gray-400 hover:text-gray-600 text-xl leading-none w-7 h-7 flex items-center justify-center">×</button>
              </div>
            </div>

            {/* Modal body */}
            <div className="px-6 py-4 space-y-4 text-sm">
              {/* Script */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Script</p>
                {editMode ? (
                  <textarea value={editScript} onChange={e => setEditScript(e.target.value)} rows={5}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-y" />
                ) : modalPost.script ? (
                  <p className="text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-lg p-3 text-xs">{modalPost.script}</p>
                ) : <p className="text-gray-400 italic text-xs">（无）</p>}
              </div>

              {/* Caption */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Caption</p>
                {editMode ? (
                  <textarea value={editCaption} onChange={e => setEditCaption(e.target.value)} rows={4}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-y" />
                ) : modalPost.caption ? (
                  <p className="text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-lg p-3 text-xs">{modalPost.caption}</p>
                ) : <p className="text-gray-400 italic text-xs">（无）</p>}
              </div>

              {/* Hashtags */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Hashtags</p>
                {editMode ? (
                  <input type="text" value={editHashtags} onChange={e => setEditHashtags(e.target.value)}
                    placeholder="#tag1 #tag2 #tag3（空格分隔）"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                ) : modalPost.hashtags?.length ? (
                  <p className="text-indigo-600 text-xs">{modalPost.hashtags.join(' ')}</p>
                ) : <p className="text-gray-400 italic text-xs">（无）</p>}
              </div>

              {/* Visual Brief */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Visual Brief</p>
                {editMode ? (
                  <textarea value={editVisualBrief} onChange={e => setEditVisualBrief(e.target.value)} rows={3}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-y" />
                ) : modalPost.visual_brief ? (
                  <p className="text-gray-700 bg-gray-50 rounded-lg p-3 text-xs">{modalPost.visual_brief}</p>
                ) : <p className="text-gray-400 italic text-xs">（无）</p>}
              </div>

              {/* Save button */}
              {editMode && (
                <div className="flex items-center gap-3 pt-1">
                  <button onClick={handleSaveEdit} disabled={savingEdit}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm px-5 py-2 rounded-lg font-medium transition-colors disabled:opacity-50">
                    {savingEdit ? '保存中…' : '💾 保存修改'}
                  </button>
                  {saveMsg && <span className={`text-xs ${saveMsg.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>{saveMsg}</span>}
                </div>
              )}
              {!editMode && saveMsg && (
                <p className={`text-xs ${saveMsg.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>{saveMsg}</p>
              )}

              {/* Image Preview */}
              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">图片预览生成</p>
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <label className="text-xs text-gray-600 font-medium whitespace-nowrap">比例：</label>
                  <select value={previewRatio} onChange={e => setPreviewRatio(e.target.value)}
                    className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white">
                    {RATIO_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <button onClick={handleGeneratePreview} disabled={previewStatus === 'generating'}
                    className="bg-violet-600 hover:bg-violet-700 text-white text-xs px-4 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 whitespace-nowrap">
                    {previewStatus === 'generating' ? (
                      <span className="flex items-center gap-1.5">
                        <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                        </svg>
                        生成中…
                      </span>
                    ) : '✨ 生成预览图'}
                  </button>
                </div>
                {previewStatus === 'generating' && (
                  <p className="text-xs text-gray-400">Visual Studio 生成中，通常 1-3 分钟，请耐心等待…</p>
                )}
                {previewStatus === 'failed' && (
                  <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    <p className="text-xs text-red-600">{previewError}</p>
                    <button onClick={handleGeneratePreview} className="text-xs text-red-700 underline mt-1">重试</button>
                  </div>
                )}
                {previewStatus === 'done' && previewImageUrl && (
                  <div className="mt-2">
                    <img src={previewImageUrl} alt="Generated preview" className="w-full max-w-sm mx-auto rounded-xl border border-gray-200 shadow-sm" />
                    <div className="flex gap-3 mt-2 justify-center">
                      <a href={previewImageUrl} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 hover:underline">↗ 查看原图</a>
                      <button onClick={handleGeneratePreview} className="text-xs text-gray-500 hover:text-gray-700">↻ 重新生成</button>
                    </div>
                  </div>
                )}
              </div>

              {/* Quick approve/reject */}
              {modalPost.status === 'draft' && (
                <div className="flex gap-2 pt-2 border-t border-gray-100">
                  <button onClick={() => { const id = modalPost.id; closeModal(); batchUpdate([id], 'approved'); }} disabled={batching}
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white text-sm py-2 rounded-lg font-medium transition-colors disabled:opacity-50">
                    ✓ 批准此条
                  </button>
                  <button onClick={() => { const id = modalPost.id; closeModal(); batchUpdate([id], 'rejected'); }} disabled={batching}
                    className="flex-1 bg-red-500 hover:bg-red-600 text-white text-sm py-2 rounded-lg font-medium transition-colors disabled:opacity-50">
                    ✕ 拒绝此条
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirm Dialog ─────────────────────────────────────────── */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowDeleteConfirm(false)}>
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-gray-900 mb-2">确认删除内容</h3>
            <p className="text-sm text-gray-600 mb-1">
              即将永久删除 <strong>{selectedIds.size}</strong> 条内容，此操作不可撤销。
            </p>
            <p className="text-xs text-gray-400 mb-5">已发布至平台的内容不会被自动撤回。</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 border border-gray-300 text-gray-700 text-sm py-2 rounded-lg hover:bg-gray-50 font-medium transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleBatchDelete}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white text-sm py-2 rounded-lg font-medium transition-colors"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
