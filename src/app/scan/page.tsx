'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import Link from 'next/link';
import type { ScanResult } from '@/app/api/scan/run/route';

// ─── Logo ─────────────────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreColor(v: number): string {
  return v < 40 ? '#ef4444' : v < 60 ? '#eab308' : '#22c55e';
}

function scoreLabel(v: number): string {
  return v < 40 ? 'Critical' : v < 60 ? 'Needs Work' : v < 80 ? 'Good' : 'Strong';
}

const DIMENSION_LABELS: Record<string, string> = {
  seo: 'SEO',
  ai_visibility: 'AI Visibility',
  social: 'Social',
  ads: 'Ads',
  reputation: 'Reputation',
  competitors: 'Competitors',
};

// ─── Loading states ───────────────────────────────────────────────────────────

const LOADING_STEPS = [
  { icon: '🌐', text: 'Reading website homepage…' },
  { icon: '🔍', text: 'Analysing brand signals…' },
  { icon: '🩺', text: 'Calculating health scores…' },
  { icon: '💊', text: 'Identifying top issues…' },
];

// ─── Scan inner component ─────────────────────────────────────────────────────

function ScanInner() {
  const searchParams = useSearchParams();
  const rawUrl = searchParams.get('url') ?? '';

  const [step, setStep] = useState(0);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState('');
  const [showScores, setShowScores] = useState(false);

  const hasFetched = useRef(false);

  useEffect(() => {
    if (!rawUrl || hasFetched.current) return;
    hasFetched.current = true;

    // Cycle through loading steps while scan runs
    const stepTimer = setInterval(() => {
      setStep(s => (s < LOADING_STEPS.length - 1 ? s + 1 : s));
    }, 3500);

    fetch('/api/scan/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: rawUrl }),
    })
      .then(res => res.json())
      .then((data: ScanResult & { error?: string }) => {
        clearInterval(stepTimer);
        if (data.error) {
          setError(data.error);
        } else {
          setResult(data);
          // Stagger score bar animation
          setTimeout(() => setShowScores(true), 200);
        }
      })
      .catch(() => {
        clearInterval(stepTimer);
        setError('Something went wrong. Please try again.');
      });

    return () => clearInterval(stepTimer);
  }, [rawUrl]);

  // No URL provided
  if (!rawUrl) {
    return (
      <div className="text-center py-16">
        <p className="text-[14px] mb-6" style={{ color: 'rgba(120,170,230,0.5)' }}>
          No website URL provided.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold"
          style={{
            background: 'linear-gradient(135deg,#2855A4 0%,#183572 100%)',
            border: '1px solid rgba(75,135,225,0.32)',
            color: '#EEF4FF',
          }}
        >
          ← Back to Home
        </Link>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="text-center py-16">
        <div className="text-[36px] mb-4">⚠️</div>
        <h2 className="text-[18px] font-bold mb-3" style={{ color: '#ECF3FF' }}>
          Scan Failed
        </h2>
        <p className="text-[13px] mb-6 max-w-xs mx-auto" style={{ color: 'rgba(120,170,230,0.5)' }}>
          {error}
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={() => {
              hasFetched.current = false;
              setError('');
              setStep(0);
            }}
            className="px-5 py-2.5 rounded-xl text-[13px] font-semibold transition-all"
            style={{
              border: '1px solid rgba(70,125,215,0.25)',
              color: 'rgba(160,195,255,0.65)',
            }}
          >
            Try Again
          </button>
          <a
            href="/discover"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold"
            style={{
              background: 'linear-gradient(135deg,#2855A4 0%,#183572 100%)',
              border: '1px solid rgba(75,135,225,0.32)',
              color: '#EEF4FF',
            }}
          >
            Talk to Us Instead →
          </a>
        </div>
      </div>
    );
  }

  // Loading state
  if (!result) {
    return (
      <div className="py-12">
        {/* URL display */}
        <div className="text-center mb-10">
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[12px] font-medium mb-3"
            style={{ background: 'rgba(22,45,90,0.7)', border: '1px solid rgba(70,125,215,0.2)', color: '#7ABFFF' }}
          >
            🔍 {rawUrl}
          </div>
          <h2 className="text-[18px] font-bold" style={{ color: '#ECF3FF' }}>
            Scanning your brand…
          </h2>
          <p className="text-[12px] mt-1" style={{ color: 'rgba(120,170,230,0.4)' }}>
            Usually takes 15–30 seconds
          </p>
        </div>

        {/* Step indicators */}
        <div className="max-w-sm mx-auto space-y-3 mb-10">
          {LOADING_STEPS.map((s, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-4 py-3 rounded-xl transition-all"
              style={{
                background: i <= step ? 'rgba(22,45,90,0.35)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${i === step ? 'rgba(75,135,225,0.35)' : 'rgba(70,125,215,0.08)'}`,
                opacity: i > step ? 0.3 : 1,
              }}
            >
              <span className="text-[18px]">{s.icon}</span>
              <span className="text-[13px]" style={{ color: i === step ? '#A5C8FF' : 'rgba(120,170,230,0.5)' }}>
                {s.text}
              </span>
              {i < step && (
                <span className="ml-auto text-green-400 text-[12px]">✓</span>
              )}
              {i === step && (
                <span className="ml-auto flex gap-1">
                  {[0,1,2].map(d => (
                    <span
                      key={d}
                      className="w-1 h-1 rounded-full bg-blue-400"
                      style={{ animation: `pulse 1.2s ease-in-out ${d * 0.2}s infinite` }}
                    />
                  ))}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Progress bar */}
        <div className="max-w-sm mx-auto">
          <div className="h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div
              className="h-1 rounded-full transition-all duration-[3500ms]"
              style={{
                width: `${((step + 1) / LOADING_STEPS.length) * 100}%`,
                background: 'linear-gradient(90deg,#2855A4,#5B9EFF)',
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  // Results state
  const sortedScores = Object.entries(result.scores).sort(([, a], [, b]) => a - b);

  return (
    <div className="space-y-6">
      {/* Header — crisis + overall */}
      <div
        className="rounded-2xl p-6"
        style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(70,125,215,0.12)' }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider mb-3"
              style={{
                background: 'rgba(239,68,68,0.12)',
                border: '1px solid rgba(239,68,68,0.25)',
                color: '#f87171',
              }}
            >
              🔴 Crisis Type: {result.crisisType}
            </div>
            <h2 className="text-[16px] font-bold mb-1" style={{ color: '#ECF3FF' }}>
              {result.businessName}
            </h2>
            <p className="text-[12px]" style={{ color: 'rgba(120,170,230,0.45)' }}>
              {result.url}
            </p>
          </div>
          <div className="text-right flex-shrink-0">
            <div
              className="text-[42px] font-black leading-none tabular-nums"
              style={{ color: scoreColor(result.overallScore) }}
            >
              {result.overallScore}
            </div>
            <div className="text-[10px] mt-0.5" style={{ color: 'rgba(255,255,255,0.25)' }}>/100</div>
            <div
              className="text-[10px] font-bold mt-1 uppercase tracking-wide"
              style={{ color: scoreColor(result.overallScore) }}
            >
              {scoreLabel(result.overallScore)}
            </div>
          </div>
        </div>

        <div
          className="mt-4 pt-4 text-[12px] italic"
          style={{ borderTop: '1px solid rgba(255,255,255,0.04)', color: 'rgba(160,200,255,0.5)' }}
        >
          &ldquo;{result.oneLiner}&rdquo;
        </div>
      </div>

      {/* 6-Dimension Scores */}
      <div
        className="rounded-2xl p-6"
        style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(70,125,215,0.12)' }}
      >
        <p className="text-[10px] uppercase tracking-wider font-semibold mb-4 flex items-center gap-1.5"
           style={{ color: 'rgba(120,170,230,0.4)' }}>
          <span>🩺</span> 6-Dimension Health Score
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
          {sortedScores.map(([dim, val]) => (
            <div key={dim} className="space-y-1.5">
              <div className="flex justify-between items-center">
                <span className="text-[12px]" style={{ color: 'rgba(200,225,255,0.6)' }}>
                  {DIMENSION_LABELS[dim] ?? dim}
                </span>
                <span
                  className="text-[12px] font-bold tabular-nums"
                  style={{ color: scoreColor(val) }}
                >
                  {val} <span className="text-[9px] font-normal opacity-60">{scoreLabel(val)}</span>
                </span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                <div
                  className="h-2 rounded-full"
                  style={{
                    width: showScores ? `${val}%` : '0%',
                    background: scoreColor(val),
                    transition: 'width 0.8s ease-out',
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Top Issues */}
      <div
        className="rounded-2xl p-6"
        style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(70,125,215,0.12)' }}
      >
        <p className="text-[10px] uppercase tracking-wider font-semibold mb-4 flex items-center gap-1.5"
           style={{ color: 'rgba(120,170,230,0.4)' }}>
          <span>⚠️</span> Top Issues Found
        </p>
        <div className="space-y-3">
          {result.topIssues.map((issue, i) => (
            <div key={i} className="flex items-start gap-3">
              <div
                className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5"
                style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}
              >
                {i + 1}
              </div>
              <span className="text-[13px] leading-snug" style={{ color: 'rgba(200,225,255,0.65)' }}>
                {issue}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Locked — Action Roadmap teaser */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ border: '1px solid rgba(70,125,215,0.15)' }}
      >
        <div className="px-6 pt-5 pb-16 select-none" style={{ filter: 'blur(5px)', opacity: 0.2, background: 'rgba(255,255,255,0.025)' }}>
          <p className="text-[11px] font-semibold mb-3" style={{ color: 'rgba(160,200,255,0.6)' }}>💊 Action Roadmap</p>
          <div className="space-y-2 text-[12px]" style={{ color: 'rgba(200,225,255,0.5)' }}>
            <div>◼ Fix #{result.crisisType}: 7 priority actions, ranked by impact</div>
            <div>◼ 90-day execution timeline</div>
            <div>◼ Quick wins vs long-term strategy split</div>
          </div>
        </div>
        <div
          className="relative px-6 py-6 text-center -mt-16"
          style={{ background: 'linear-gradient(to bottom, transparent 0%, rgba(6,14,26,0.98) 40%)' }}
        >
          <p className="text-[12px] mb-4" style={{ color: 'rgba(160,195,255,0.5)' }}>
            Your personalised Action Roadmap is ready — talk to our team to unlock it
          </p>
          <a
            href={`/discover?url=${encodeURIComponent(result.url)}`}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-[14px] font-bold transition-all"
            style={{
              background: 'linear-gradient(135deg,#2855A4 0%,#183572 100%)',
              border: '1px solid rgba(75,135,225,0.35)',
              color: '#EEF4FF',
            }}
          >
            Get My Free Action Roadmap →
          </a>
          <p className="text-[10px] mt-2" style={{ color: 'rgba(255,255,255,0.2)' }}>
            Free · No credit card · Specialist contacts you within 24 hours
          </p>
        </div>
      </div>

      {/* Scan another */}
      <div className="text-center pt-2 pb-4">
        <a href="/" className="text-[12px] transition-colors" style={{ color: 'rgba(120,170,230,0.35)' }}>
          ← Scan a different website
        </a>
      </div>
    </div>
  );
}

// ─── Page wrapper ─────────────────────────────────────────────────────────────

export default function ScanPage() {
  return (
    <div
      className="min-h-screen bg-[#060E1A] text-white"
      style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif" }}
    >
      {/* Nav */}
      <nav
        className="flex items-center justify-between px-5 py-4"
        style={{ borderBottom: '1px solid rgba(70,125,215,0.08)' }}
      >
        <Link href="/" className="flex items-center gap-2.5">
          <MagicLogo />
          <span className="text-[15px] font-bold text-white tracking-tight">Magic Engine</span>
        </Link>
        <a
          href="/discover"
          className="text-[13px] font-bold px-4 py-2 rounded-lg"
          style={{
            background: 'linear-gradient(135deg,#2855A4 0%,#183572 100%)',
            border: '1px solid rgba(75,135,225,0.32)',
            color: '#EEF4FF',
          }}
        >
          Talk to Us →
        </a>
      </nav>

      {/* Glow */}
      <div className="fixed inset-0 pointer-events-none" aria-hidden="true">
        <div style={{
          position: 'absolute', top: '20%', left: '50%', transform: 'translateX(-50%)',
          width: '600px', height: '400px',
          background: 'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(38,82,162,0.12) 0%, transparent 70%)',
        }} />
      </div>

      {/* Content */}
      <main className="relative z-10 max-w-xl mx-auto px-5 py-10">
        <Suspense fallback={
          <div className="text-center py-16 text-[13px]" style={{ color: 'rgba(120,170,230,0.4)' }}>
            Loading…
          </div>
        }>
          <ScanInner />
        </Suspense>
      </main>

      <footer className="px-5 py-4 text-center">
        <p className="text-[10px]" style={{ color: 'rgba(70,115,185,0.25)', letterSpacing: '2px' }}>
          MAGIC LAB &copy; 2026
        </p>
      </footer>
    </div>
  );
}
