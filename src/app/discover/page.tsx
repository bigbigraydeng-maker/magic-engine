'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

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

function DiscoverForm() {
  const searchParams = useSearchParams();
  const prefillUrl = searchParams.get('url') ?? '';

  const [url, setUrl] = useState(prefillUrl);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
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
      await fetch('/api/discover/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), name: name.trim(), email: email.trim() }),
      });
    } catch {
      // Silent — still show thank you
    } finally {
      setLoading(false);
      setDone(true);
    }
  }

  if (done) {
    return (
      <div className="text-center py-10">
        <div className="text-[40px] mb-4">🎉</div>
        <h2 className="text-[22px] font-black mb-3" style={{ color: '#ECF3FF' }}>
          You&apos;re on the list!
        </h2>
        <p className="text-[14px] mb-6 max-w-xs mx-auto" style={{ color: 'rgba(120,170,230,0.55)' }}>
          Our specialist will review your website and send your free Discovery Report within 24 hours.
        </p>
        <div className="space-y-3">
          <p className="text-[12px]" style={{ color: 'rgba(120,170,230,0.35)' }}>
            Want to talk sooner?
          </p>
          <a
            href="mailto:bigbigraydeng@gmail.com?subject=Discovery%20Enquiry"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold transition-all"
            style={{
              background: 'linear-gradient(135deg,#2855A4 0%,#183572 100%)',
              border: '1px solid rgba(75,135,225,0.32)',
              color: '#EEF4FF',
            }}
          >
            Email Us Directly →
          </a>
        </div>
      </div>
    );
  }

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
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(70,125,215,0.2)',
            color: '#EEF4FF',
          }}
          onFocus={e => { e.currentTarget.style.borderColor = 'rgba(65,125,220,0.6)'; }}
          onBlur={e => { e.currentTarget.style.borderColor = 'rgba(70,125,215,0.2)'; }}
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
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(70,125,215,0.2)',
            color: '#EEF4FF',
          }}
          onFocus={e => { e.currentTarget.style.borderColor = 'rgba(65,125,220,0.6)'; }}
          onBlur={e => { e.currentTarget.style.borderColor = 'rgba(70,125,215,0.2)'; }}
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
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(70,125,215,0.2)',
            color: '#EEF4FF',
          }}
          onFocus={e => { e.currentTarget.style.borderColor = 'rgba(65,125,220,0.6)'; }}
          onBlur={e => { e.currentTarget.style.borderColor = 'rgba(70,125,215,0.2)'; }}
        />
      </div>

      {error && (
        <p className="text-[12px]" style={{ color: '#f87171' }}>{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 rounded-xl text-[14px] font-bold transition-all mt-2"
        style={{
          background: loading ? 'rgba(40,85,164,0.5)' : 'linear-gradient(135deg,#2855A4 0%,#183572 100%)',
          border: '1px solid rgba(75,135,225,0.32)',
          color: '#EEF4FF',
          cursor: loading ? 'default' : 'pointer',
        }}
      >
        {loading ? 'Submitting…' : 'Get My Free Discovery Report →'}
      </button>

      <p className="text-[11px] text-center" style={{ color: 'rgba(255,255,255,0.18)' }}>
        No spam. No obligation. We&apos;ll contact you within 24 hours.
      </p>
    </form>
  );
}

export default function DiscoverPage() {
  return (
    <div className="min-h-screen bg-[#060E1A] flex flex-col" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif" }}>

      {/* Nav */}
      <nav className="flex items-center justify-between px-5 py-4"
           style={{ borderBottom: '1px solid rgba(70,125,215,0.08)' }}>
        <Link href="/" className="flex items-center gap-2.5">
          <MagicLogo />
          <span className="text-[15px] font-bold text-white tracking-tight">Magic Engine</span>
        </Link>
        <Link
          href="/"
          className="text-[12px] transition-colors"
          style={{ color: 'rgba(120,170,230,0.45)' }}
        >
          ← Back
        </Link>
      </nav>

      {/* Main */}
      <main className="flex-1 flex items-center justify-center px-5 py-16">
        <div className="w-full max-w-md">
          {/* Glow */}
          <div className="absolute pointer-events-none" aria-hidden="true" style={{
            top: '30%', left: '50%', transform: 'translate(-50%,-50%)',
            width: '500px', height: '300px',
            background: 'radial-gradient(ellipse 80% 50% at 50% 50%, rgba(38,82,162,0.14) 0%, transparent 70%)',
          }} />

          {/* Card */}
          <div className="relative rounded-2xl px-8 py-8"
               style={{
                 background: 'rgba(10,20,40,0.74)',
                 backdropFilter: 'blur(26px)',
                 border: '1px solid rgba(70,125,215,0.18)',
                 boxShadow: '0 32px 72px rgba(0,0,0,0.5)',
               }}>
            {/* Header */}
            <div className="text-center mb-7">
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-semibold mb-4"
                   style={{ background: 'rgba(22,45,90,0.7)', border: '1px solid rgba(70,125,215,0.2)', color: '#7ABFFF' }}>
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                Free · No login required
              </div>
              <h1 className="text-[20px] font-black mb-2" style={{ color: '#ECF3FF' }}>
                Request Your Free Discovery Report
              </h1>
              <p className="text-[13px]" style={{ color: 'rgba(120,170,230,0.5)' }}>
                Enter your details and a specialist will send you a full brand health diagnosis within 24 hours.
              </p>
            </div>

            <div style={{ height: '1px', background: 'linear-gradient(90deg,transparent,rgba(70,130,220,0.25),transparent)', marginBottom: '24px' }} />

            <Suspense fallback={<div className="text-center text-sm" style={{ color: 'rgba(120,170,230,0.4)' }}>Loading…</div>}>
              <DiscoverForm />
            </Suspense>
          </div>

          {/* Trust signals */}
          <div className="mt-6 flex items-center justify-center gap-6">
            {['No signup needed', '24hr response', 'AU / NZ specialists'].map(t => (
              <div key={t} className="flex items-center gap-1.5">
                <span className="text-green-400 text-[10px]">✓</span>
                <span className="text-[10px]" style={{ color: 'rgba(120,170,230,0.35)' }}>{t}</span>
              </div>
            ))}
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
