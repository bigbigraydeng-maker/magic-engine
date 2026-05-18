'use client';

import { useState, useRef, useEffect } from 'react';

interface UploadedFile {
  storagePath: string;
  filename: string;
  sizeBytes: number;
}

interface Props {
  clientId: string;
  onGenerated: (briefId: string) => void;
}

export function BriefSourcesForm({ clientId, onGenerated }: Props) {
  const [urlInputs, setUrlInputs] = useState<string[]>(['', '']);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [domain, setDomain] = useState('');
  // Discovery-derived hints — surfaced to the user, sent as overrides to Claude
  const [seedKeywords, setSeedKeywords] = useState<string[]>([]);
  const [competitorDomains, setCompetitorDomains] = useState<string[]>([]);
  // Visual DNA overrides
  const [visualStyle, setVisualStyle] = useState('');
  const [brandColors, setBrandColors] = useState('');
  const [visualAvoid, setVisualAvoid] = useState('');
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [discoveryLoaded, setDiscoveryLoaded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-prefill from 张骞 discovery data if available
  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_INTERNAL_API_KEY ?? '';
    fetch(`/api/clients/${clientId}/zhangqian/latest`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then((json: {
        success: boolean;
        discovery: {
          domain: string;
          payload: {
            social_profiles?: { url: string }[];
            seed_keywords?: { keyword: string }[];
            competitors?: { domain: string }[];
            visual_dna?: {
              style_keywords?: string[];
              colors?: string[];
              donts?: string[];
            } | null;
          };
        };
      } | null) => {
        if (!json?.success || !json.discovery) return;
        const d = json.discovery;
        // Pre-fill domain
        if (d.domain) setDomain(prev => prev || d.domain);
        // Pre-fill social profile URLs as website URLs (up to 3)
        const socialUrls = (d.payload?.social_profiles ?? [])
          .slice(0, 3)
          .map((p: { url: string }) => p.url)
          .filter(Boolean);
        if (socialUrls.length > 0) {
          setUrlInputs(prev => {
            const existing = prev.filter(Boolean);
            const merged = [...existing, ...socialUrls].slice(0, 5);
            return merged.length < 2 ? [...merged, ''] : merged;
          });
        }
        // P8.11.F.1: pre-fill seed keywords + competitor domains from discovery
        const seedKw = (d.payload?.seed_keywords ?? [])
          .map(k => k.keyword?.trim())
          .filter((k): k is string => Boolean(k))
          .slice(0, 10);
        if (seedKw.length > 0) setSeedKeywords(seedKw);
        const compDomains = (d.payload?.competitors ?? [])
          .map(c => c.domain?.trim())
          .filter((c): c is string => Boolean(c))
          .slice(0, 10);
        if (compDomains.length > 0) setCompetitorDomains(compDomains);
        // P8.10.S2.F.3: pre-fill visual DNA from discovery
        const vdna = d.payload?.visual_dna;
        if (vdna) {
          if (vdna.style_keywords?.length) {
            setVisualStyle(vdna.style_keywords.join(', '));
          }
          if (vdna.colors?.length) {
            setBrandColors(vdna.colors.join(', '));
          }
          if (vdna.donts?.length) {
            setVisualAvoid(vdna.donts.join(', '));
          }
        }
        setDiscoveryLoaded(true);
      })
      .catch(() => { /* silent — no discovery yet */ });
  }, [clientId]);

  const handleUrlChange = (i: number, val: string) => {
    setUrlInputs(prev => prev.map((u, idx) => (idx === i ? val : u)));
  };

  const addUrlRow = () => setUrlInputs(prev => [...prev, '']);

  const removeUrlRow = (i: number) =>
    setUrlInputs(prev => prev.filter((_, idx) => idx !== i));

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;

    setUploading(true);
    setError('');

    for (const file of files) {
      const form = new FormData();
      form.append('file', file);
      try {
        const res = await fetch(`/api/clients/${clientId}/brief/upload`, {
          method: 'POST',
          body: form,
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Upload failed');
        setUploadedFiles(prev => [
          ...prev,
          {
            storagePath: json.file.storage_path,
            filename: json.file.filename,
            sizeBytes: json.file.size_bytes,
          },
        ]);
      } catch (err) {
        setError(`Upload error: ${(err as Error).message}`);
      }
    }

    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (i: number) =>
    setUploadedFiles(prev => prev.filter((_, idx) => idx !== i));

  const handleGenerate = async () => {
    const websiteUrls = urlInputs.map(u => u.trim()).filter(Boolean);
    const filePaths = uploadedFiles.map(f => f.storagePath);

    if (!websiteUrls.length && !filePaths.length && !domain.trim()) {
      setError('Please provide at least one website URL, file, or SEMrush domain.');
      return;
    }

    setGenerating(true);
    setError('');
    setWarnings([]);

    try {
      const res = await fetch(`/api/clients/${clientId}/brief/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          website_urls: websiteUrls,
          file_urls: filePaths,
          domain: domain.trim() || undefined,
          visual_style: visualStyle.trim() || undefined,
          brand_colors: brandColors.trim() ? brandColors.split(',').map(s => s.trim()).filter(Boolean) : undefined,
          visual_avoid: visualAvoid.trim() ? visualAvoid.split(',').map(s => s.trim()).filter(Boolean) : undefined,
          seed_keywords: seedKeywords.length > 0 ? seedKeywords : undefined,
          competitor_domains: competitorDomains.length > 0 ? competitorDomains : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Generation failed');
      if (json.warnings?.length) setWarnings(json.warnings);
      onGenerated(json.brief_id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-5">
      {discoveryLoaded && (
        <div className="flex flex-col gap-1 text-xs text-indigo-700 bg-indigo-50 rounded-lg px-3 py-2">
          <div className="flex items-center gap-2">
            <span>✓</span>
            <span>已从张骞发现数据预填:</span>
          </div>
          <ul className="ml-5 list-disc text-indigo-600/90">
            <li>域名、社媒链接</li>
            {seedKeywords.length > 0 && <li>{seedKeywords.length} 个种子关键词 (将作为 MB 锚点)</li>}
            {competitorDomains.length > 0 && <li>{competitorDomains.length} 个竞品域名 (将作为 MB 锚点)</li>}
            {(visualStyle || brandColors || visualAvoid) && <li>视觉品牌 DNA (风格 / 色彩 / 禁忌)</li>}
          </ul>
        </div>
      )}

      {/* Website URLs */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Website URLs <span className="font-normal normal-case text-gray-400">(homepage, about, products — max 5)</span>
        </label>
        <div className="space-y-2">
          {urlInputs.map((url, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={url}
                onChange={e => handleUrlChange(i, e.target.value)}
                placeholder="https://example.com/about"
                className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-colors"
              />
              {urlInputs.length > 1 && (
                <button
                  onClick={() => removeUrlRow(i)}
                  className="text-gray-400 hover:text-red-500 px-2 text-lg leading-none"
                  title="Remove"
                >×</button>
              )}
            </div>
          ))}
        </div>
        {urlInputs.length < 5 && (
          <button
            onClick={addUrlRow}
            className="mt-2 text-xs text-indigo-600 hover:text-indigo-800"
          >
            + Add URL
          </button>
        )}
      </div>

      {/* SEMrush Domain */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          SEMrush Domain <span className="font-normal normal-case text-gray-400">(for keyword + competitor data)</span>
        </label>
        <input
          value={domain}
          onChange={e => setDomain(e.target.value)}
          placeholder="example.com"
          className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-colors"
        />
      </div>

      {/* Visual DNA */}
      <div className="border border-gray-100 rounded-xl p-4 bg-gray-50 space-y-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          视觉品牌 DNA <span className="font-normal normal-case text-gray-400">（可选 — 用于图片/视频生成）</span>
        </p>
        <div>
          <label className="block text-xs text-gray-500 mb-1">视觉风格关键词</label>
          <input
            value={visualStyle}
            onChange={e => setVisualStyle(e.target.value)}
            placeholder="e.g. clean, minimalist, warm, luxury, adventure"
            className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">品牌色（逗号分隔 hex 或色名）</label>
          <input
            value={brandColors}
            onChange={e => setBrandColors(e.target.value)}
            placeholder="e.g. #1A3C5E, #F5A623, navy blue"
            className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">视觉禁止（逗号分隔）</label>
          <input
            value={visualAvoid}
            onChange={e => setVisualAvoid(e.target.value)}
            placeholder="e.g. dark backgrounds, stock photos, text overlays"
            className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
          />
        </div>
      </div>

      {/* File Upload */}
      <div>
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Upload Documents <span className="font-normal normal-case text-gray-400">(PDF, DOCX, TXT — max 30MB each)</span>
        </label>
        <div
          className="border-2 border-dashed border-gray-200 rounded-lg p-4 text-center cursor-pointer hover:border-indigo-400 transition-colors"
          onClick={() => fileInputRef.current?.click()}
        >
          <p className="text-sm text-gray-500">
            {uploading ? 'Uploading…' : 'Click to upload brand guidelines, strategy docs, etc.'}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.doc,.docx,.txt"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
        {uploadedFiles.length > 0 && (
          <ul className="mt-2 space-y-1">
            {uploadedFiles.map((f, i) => (
              <li key={i} className="flex items-center justify-between text-xs text-gray-600 bg-gray-50 rounded px-3 py-1.5">
                <span className="truncate max-w-xs">{f.filename} ({(f.sizeBytes / 1024).toFixed(0)} KB)</span>
                <button onClick={() => removeFile(i)} className="text-gray-400 hover:text-red-500 ml-2">×</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Errors / Warnings */}
      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
      {warnings.map((w, i) => (
        <p key={i} className="text-xs text-amber-700 bg-amber-50 rounded px-3 py-1.5">{w}</p>
      ))}

      {/* Generate Button */}
      <button
        onClick={handleGenerate}
        disabled={generating || uploading}
        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-xl disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
      >
        {generating ? (
          <>
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
            Generating Brief… (30–90s)
          </>
        ) : '✨ Generate Master Brief'}
      </button>
    </div>
  );
}
