'use client';

import { useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense } from 'react';
import Link from 'next/link';

const MagicLogo = () => (
  <svg width="26" height="24" viewBox="0 0 68 64" fill="none" aria-hidden="true">
    <path d="M53 3 L54.3 7.2 L58.5 8.5 L54.3 9.8 L53 14 L51.7 9.8 L47.5 8.5 L51.7 7.2 Z"
          fill="rgba(240,248,255,0.9)"/>
    <polygon points="3,60 13,6 22,6 12,60" fill="#9ABDE0"/>
    <polygon points="13,6 22,6 33,38 24,38" fill="#789EC8"/>
    <polygon points="46,6 55,6 44,38 35,38" fill="#789EC8"/>
    <polygon points="46,6 55,6 65,60 55,60" fill="#9ABDE0"/>
    <polygon points="24,38 33,38 34,48 35,38 44,38 34,60" fill="#587FAF"/>
  </svg>
);

const SCAN_INCLUDES = [
  { icon: '🔑', text: 'Real keyword rankings (DataForSEO)' },
  { icon: '🏆', text: 'Competitor traffic & authority scores' },
  { icon: '📱', text: 'Social following & engagement rates' },
  { icon: '⭐', text: 'Google & review platform ratings' },
  { icon: '🩺', text: '6-dimension brand health diagnosis' },
  { icon: '💊', text: 'Personalised quick wins & action plan' },
];

function DiscoverForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const prefillUrl = searchParams.get('url') ?? '';

  const [url, setUrl] = useState(prefillUrl);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || !email.trim()) {
      setError('Please enter your website URL and email address.');
      return;
    }
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/public-scan/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), name: name.trim(), email: email.trim() }),
      });

      const data = await res.json() as { job_id?: string; error?: string };

      if (!res.ok || !data.job_id) {
        setError(data.error ?? 'Something went wrong. Please try again.');
        setLoading(false);
        return;
      }

      router.push(`/scan/report/${data.job_id}`);
    } catch {
      setError('Network error. Please check your connection and try again.');
      setLoading(false);
    }
  }

  const inputStyle = {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(70,125,215,0.2)',
    color: '#EEF4FF',
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'rgba(165,200,250,0.7)' }}>
          Website URL *
        </label>
        <input
          type="text"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="yourwebsite.com.au"
          required
          className="w-full px-4 py-3 rounded-xl text-[14px] outline-none transition-all"
          style={inputStyle}
          onFocus={e => { e.currentTarget.style.borderColor = 'rgba(65,125,220,0.6)' }}
          onBlur={e => { e.currentTarget.style.borderColor = 'rgba(70,125,215,0.2)' }}
        />
      </div>

      <div>
        <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'rgba(165,200,250,0.7)' }}>
          Your Name
        </label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Jane Smith"
          className="w-full px-4 py-3 rounded-xl text-[14px] outline-none transition-all"
          style={inputStyle}
          onFocus={e => { e.currentTarget.style.borderColor = 'rgba(65,125,220,0.6)' }}
          onBlur={e => { e.currentTarget.style.borderColor = 'rgba(70,125,215,0.2)' }}
        />
      </div>

      <div>
        <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'rgba(165,200,250,0.7)' }}>
          Email Address *
        </label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="jane@yourcompany.com.au"
          required
          className="w-full px-4 py-3 rounded-xl text-[14px] outline-none transition-all"
          style={inputStyle}
          onFocus={e => { e.currentTarget.style.borderColor = 'rgba(65,125,220,0.6)' }}
          onBlur={e => { e.currentTarget.style.borderColor = 'rgba(70,125,215,0.2)' }}
        />
      </div>

      {error && (
        <p className="text-[12px]" style={{ color: '#f87171' }}>{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-3.5 rounded-xl text-[14px] font-bold transition-all mt-2"
        style={{
          background: loading ? 'rgba(40,85,164,0.5)' : 'linear-gradient(135deg,#2855A4 0%,#183572 100%)',
          border: '1px solid rgba(75,135,225,0.32)',
          color: '#EEF4FF',
          cursor: loading ? 'default' : 'pointer',
        }}
      >
        {loading ? 'Starting your scan…' : 'Start My Free Discovery Report →'}
      </button>

      <p className="text-[11px] text-center" style={{ color: 'rgba(255,255,255,0.18)' }}>
        Takes 3–5 minutes &middot; No credit card &middot; No spam
      </p>
    </form>
  );
}

export default function DiscoverPage() {
  return (
    <div className="min-h-screen bg-[#060E1A] flex flex-col"
         style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif" }}>

      <nav className="flex items-center justify-between px-5 py-4"
           style={{ borderBottom: '1px solid rgba(70,125,215,0.08)' }}>
        <Link href="/" className="flex items-center gap-2.5">
          <MagicLogo />
          <span className="text-[15px] font-bold text-white tracking-tight">Magic Engine</span>
        </Link>
        <Link href="/" className="text-[12px] transition-colors" style={{ color: 'rgba(120,170,230,0.45)' }}>
          ← Back
        </Link>
      </nav>

      <main className="flex-1 flex items-start justify-center px-5 py-12">
        <div className="w-full max-w-4xl relative">

          {/* Background glow */}
          <div className="fixed inset-0 pointer-events-none" aria-hidden="true">
            <div style={{
              position: 'absolute', top: '20%', left: '50%', transform: 'translateX(-50%)',
              width: '600px', height: '400px',
              background: 'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(38,82,162,0.12) 0%, transparent 70%)',
            }} />
          </div>

          <div className="relative grid lg:grid-cols-2 gap-8 items-start">

            {/* Left — what you get */}
            <div className="lg:pt-2">
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-semibold mb-5"
                   style={{ background: 'rgba(22,45,90,0.7)', border: '1px solid rgba(70,125,215,0.2)', color: '#7ABFFF' }}>
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                Free · Real data · 3–5 minutes
              </div>
              <h1 className="text-[28px] font-black mb-3 leading-tight" style={{ color: '#ECF3FF' }}>
                Your Free<br />Discovery Report
              </h1>
              <p className="text-[13px] leading-relaxed mb-6" style={{ color: 'rgba(120,170,230,0.5)' }}>
                Our AI maps your entire digital presence — keywords, competitors, social, reviews — and scores your brand across 6 dimensions.
              </p>

              <div className="space-y-2.5 mb-6">
                {SCAN_INCLUDES.map(item => (
                  <div key={item.icon} className="flex items-center gap-3">
                    <span className="text-[16px]">{item.icon}</span>
                    <span className="text-[12px]" style={{ color: 'rgba(160,200,255,0.65)' }}>{item.text}</span>
                  </div>
                ))}
              </div>

              <div className="p-4 rounded-xl text-[12px] leading-relaxed"
                   style={{ background: 'rgba(22,45,90,0.3)', border: '1px solid rgba(70,125,215,0.15)', color: 'rgba(120,170,230,0.5)' }}>
                <span style={{ color: 'rgba(160,200,255,0.7)' }}>⏱ What happens next:</span>{' '}
                After you submit, our AI starts scanning immediately. You&apos;ll watch discoveries appear in real time — then see your full report when it&apos;s done.
              </div>
            </div>

            {/* Right — form */}
            <div className="relative rounded-2xl px-8 py-8"
                 style={{
                   background: 'rgba(10,20,40,0.74)',
                   backdropFilter: 'blur(26px)',
                   border: '1px solid rgba(70,125,215,0.18)',
                   boxShadow: '0 32px 72px rgba(0,0,0,0.5)',
                 }}>
              <div className="mb-6">
                <h2 className="text-[18px] font-black mb-1.5" style={{ color: '#ECF3FF' }}>
                  Start your scan
                </h2>
                <p className="text-[12px]" style={{ color: 'rgba(120,170,230,0.45)' }}>
                  Enter your details — your report starts immediately.
                </p>
              </div>

              <div style={{ height: '1px', background: 'linear-gradient(90deg,transparent,rgba(70,130,220,0.25),transparent)', marginBottom: '24px' }} />

              <Suspense fallback={
                <div className="text-center text-sm py-8" style={{ color: 'rgba(120,170,230,0.4)' }}>Loading…</div>
              }>
                <DiscoverForm />
              </Suspense>
            </div>
          </div>
        </div>
      </main>

      <footer className="px-5 py-4 text-center">
        <p className="text-[10px]" style={{ color: 'rgba(70,115,185,0.25)', letterSpacing: '2px' }}>
          MAGIC LAB &copy; 2026
        </p>
      </footer>
    </div>
  );
}
