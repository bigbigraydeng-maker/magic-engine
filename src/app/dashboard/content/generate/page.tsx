'use client';

import { useState, useEffect } from 'react';

interface Client {
  id: string;
  name: string;
  website_url?: string;
}

interface GeneratedPost {
  id?: string;
  title: string;
  script?: string;
  caption?: string;
  hashtags?: string[];
  visual_brief?: string;
}

type RouteTab = 'route_a' | 'route_b' | 'route_c';

const PLATFORMS = ['facebook', 'tiktok', 'instagram'];

export default function GenerateContentPage() {
  const [activeRoute, setActiveRoute] = useState<RouteTab>('route_a');
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<GeneratedPost[]>([]);
  const [error, setError] = useState('');
  const [saveMsg, setSaveMsg] = useState('');

  // Shared fields
  const [clientId, setClientId] = useState('');
  const [platforms, setPlatforms] = useState<string[]>(['facebook', 'tiktok']);

  // Route A
  const [keyword, setKeyword] = useState('');

  // Route B
  const [videoUrl, setVideoUrl] = useState('');

  // Route C
  const [topic, setTopic] = useState('');

  useEffect(() => {
    fetch('/api/clients').then(r => r.json()).then(d => {
      const list = d.clients ?? [];
      setClients(list);
      if (list.length === 1) setClientId(list[0].id);
    });
  }, []);

  const togglePlatform = (p: string) => {
    setPlatforms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setResults([]);
    setSaveMsg('');

    try {
      let endpoint = '';
      let body: Record<string, unknown> = { client_id: clientId, platforms };

      if (activeRoute === 'route_a') {
        endpoint = '/api/content/route-a';
        body = { ...body, keyword };
      } else if (activeRoute === 'route_b') {
        endpoint = '/api/content/route-b';
        body = { ...body, video_url: videoUrl };
      } else {
        endpoint = '/api/content/route-c';
        body = { ...body, topic };
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Generation failed');

      // Extract variants/posts from response
      const posts: GeneratedPost[] = json.variants ?? json.posts ?? json.saved_posts ?? [];
      setResults(posts);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (post: GeneratedPost) => {
    if (post.id) {
      setSaveMsg('Already saved ✓');
      return;
    }
    setSaveMsg('Saving...');
    try {
      const res = await fetch('/api/content/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...post, client_id: clientId, platforms, route: activeRoute }),
      });
      if (res.ok) setSaveMsg('Saved to library ✓');
      else setSaveMsg('Save failed');
    } catch {
      setSaveMsg('Save failed');
    }
    setTimeout(() => setSaveMsg(''), 3000);
  };

  const handlePushAirtable = async (post: GeneratedPost) => {
    if (!post.id) {
      alert('Save post first before syncing to Content Workspace');
      return;
    }
    await fetch('/api/airtable/sync-content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, post_ids: [post.id] }),
    });
    alert('Synced to Content Workspace!');
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Generate Content</h1>
        <p className="text-sm text-gray-500 mt-1">Choose a route and fill in the details</p>
      </div>

      {/* Route Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {([
          { key: 'route_a', label: 'Route A — SEO Keywords' },
          { key: 'route_b', label: 'Route B — Viral Rewrite' },
          { key: 'route_c', label: 'Route C — Master Brief' },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            onClick={() => { setActiveRoute(tab.key); setResults([]); setError(''); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeRoute === tab.key
                ? 'bg-white text-indigo-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Form */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Client */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Client *</label>
            <select
              required
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">— Select client —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Route-specific fields */}
          {activeRoute === 'route_a' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Keyword *</label>
              <input
                required
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="e.g. New Zealand travel packages"
              />
            </div>
          )}

          {activeRoute === 'route_b' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Video URL *</label>
              <input
                required
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="https://youtube.com/watch?v=... or TikTok URL"
              />
            </div>
          )}

          {activeRoute === 'route_c' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Content Topic *</label>
              <input
                required
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="e.g. Summer travel deals 2025"
              />
            </div>
          )}

          {/* Platforms */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Platforms</label>
            <div className="flex gap-3">
              {PLATFORMS.map((p) => (
                <label key={p} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={platforms.includes(p)}
                    onChange={() => togglePlatform(p)}
                    className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-sm text-gray-700 capitalize">{p}</span>
                </label>
              ))}
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                Generating...
              </>
            ) : (
              '⚡ Generate Content'
            )}
          </button>
        </form>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">Generated Results</h2>
            {saveMsg && <span className="text-sm text-green-600">{saveMsg}</span>}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {results.map((post, idx) => (
              <div key={idx} className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-indigo-600 uppercase tracking-wider">V{idx + 1}</span>
                  {post.id && <span className="text-xs text-green-600 font-medium">✓ Saved</span>}
                </div>
                <h3 className="text-sm font-semibold text-gray-900">{post.title}</h3>
                {post.script && (
                  <div>
                    <p className="text-xs text-gray-500 font-medium mb-1">Script</p>
                    <p className="text-xs text-gray-700 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap line-clamp-6">{post.script}</p>
                  </div>
                )}
                {post.caption && (
                  <div>
                    <p className="text-xs text-gray-500 font-medium mb-1">Caption</p>
                    <p className="text-xs text-gray-700 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap line-clamp-4">{post.caption}</p>
                  </div>
                )}
                {post.hashtags && post.hashtags.length > 0 && (
                  <p className="text-xs text-indigo-600">{post.hashtags.join(' ')}</p>
                )}
                {post.visual_brief && (
                  <div>
                    <p className="text-xs text-gray-500 font-medium mb-1">Visual Brief</p>
                    <p className="text-xs text-gray-600 italic">{post.visual_brief}</p>
                  </div>
                )}
                <div className="flex gap-2 pt-2 border-t border-gray-100">
                  <button
                    onClick={() => handleSave(post)}
                    className="flex-1 text-xs bg-indigo-600 text-white py-1.5 rounded-lg hover:bg-indigo-700 font-medium"
                  >
                    Save to Library
                  </button>
                  <button
                    onClick={() => {
                      setResults([]);
                      // Re-submit
                      document.querySelector<HTMLButtonElement>('button[type=submit]')?.click();
                    }}
                    className="flex-1 text-xs border border-gray-300 text-gray-600 py-1.5 rounded-lg hover:bg-gray-50 font-medium"
                  >
                    Regenerate
                  </button>
                  <button
                    onClick={() => handlePushAirtable(post)}
                    className="flex-1 text-xs border border-gray-300 text-gray-600 py-1.5 rounded-lg hover:bg-gray-50 font-medium"
                  >
                    ↑ Content Workspace
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
