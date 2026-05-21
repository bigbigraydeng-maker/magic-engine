import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import Link from 'next/link';
// @tier-updated: 2026-05-21 — 华佗处方 moved to Free, Luban=FDE only

export const dynamic = 'force-dynamic';

const MagicLogo = () => (
  <svg width="30" height="28" viewBox="0 0 68 64" fill="none" aria-hidden="true">
    <path d="M53 3 L54.3 7.2 L58.5 8.5 L54.3 9.8 L53 14 L51.7 9.8 L47.5 8.5 L51.7 7.2 Z"
          fill="rgba(240,248,255,0.9)"/>
    <polygon points="3,60 13,6 22,6 12,60" fill="#9ABDE0"/>
    <polygon points="13,6 22,6 33,38 24,38" fill="#789EC8"/>
    <polygon points="46,6 55,6 44,38 35,38" fill="#789EC8"/>
    <polygon points="46,6 55,6 65,60 55,60" fill="#9ABDE0"/>
    <polygon points="24,38 33,38 34,48 35,38 44,38 34,60" fill="#587FAF"/>
  </svg>
);

// ── Workflow steps ──────────────────────────────────────────────────────────
const WORKFLOW_STEPS = [
  {
    step: '01',
    icon: '🗺️',
    title: 'Brand Discovery',
    subtitle: 'Zhangqian Scan',
    desc: 'AI scans your brand across social, reviews, keywords, and competitors. Surfaces your crisis type and top blind spots.',
    tier: 'free',
    tierLabel: 'Free',
  },
  {
    step: '02',
    icon: '🩺',
    title: 'Deep Diagnosis',
    subtitle: 'Huatuo Analysis',
    desc: '6-dimension health scoring: SEO · AI Visibility · Social · Ads · Reputation · Competitors. You see exactly where you rank.',
    tier: 'free',
    tierLabel: 'Free',
  },
  {
    step: '03',
    icon: '💊',
    title: 'Action Roadmap',
    subtitle: 'Huatuo Prescription',
    desc: 'Prioritised fix plan — every issue ranked by impact and effort, with a clear 90-day timeline.',
    tier: 'free',
    tierLabel: 'Free',
  },
  {
    step: '04',
    icon: '⚡',
    title: 'Execute & Track',
    subtitle: 'Luban Board',
    desc: 'Automated content, campaigns & optimisations executed. Every action tracked with real ROI attribution.',
    tier: 'fde',
    tierLabel: 'FDE',
  },
];

// ── Free features ───────────────────────────────────────────────────────────
const FREE_FEATURES = [
  {
    icon: '🗺️',
    title: 'Brand Discovery Scan',
    desc: 'Surface-level scan of your brand: crisis type, top 3 blind spots, keyword gaps',
  },
  {
    icon: '🩺',
    title: '6-Dimension Health Score',
    desc: 'Your scores across SEO, AI Visibility, Social, Ads, Reputation & Competitors — no surprises',
  },
  {
    icon: '⚠️',
    title: 'Weakness Report',
    desc: 'Plain-English explanation of what is hurting you and why it matters to your bottom line',
  },
  {
    icon: '💊',
    title: 'Action Roadmap',
    desc: 'A real, prioritised fix plan — not just a score, but exactly what to do next',
  },
];

// ── FDE features ────────────────────────────────────────────────────────────
const FDE_FEATURES = [
  { icon: '⚡', title: 'Execution Board (Luban)',    desc: 'Automated content, campaigns & optimisations — tracked end-to-end' },
  { icon: '🤖', title: 'Content Engine',             desc: 'SEO blogs, social campaigns & GEO directives, all automated' },
  { icon: '📋', title: 'Monthly Intelligence Reports', desc: 'Automated performance reports delivered to your inbox' },
  { icon: '👥', title: 'Dedicated Specialist',       desc: 'A human expert oversees your strategy and execution' },
];

// ── Sample scores ────────────────────────────────────────────────────────────
const SAMPLE_SCORES = [
  { label: 'SEO',           value: 28 },
  { label: 'AI Visibility', value: 12 },
  { label: 'Social',        value: 45 },
  { label: 'Ads',           value: 62 },
  { label: 'Reputation',    value: 71 },
  { label: 'Competitors',   value: 33 },
];

function scoreColor(v: number) {
  return v < 40 ? '#ef4444' : v < 60 ? '#eab308' : '#22c55e';
}

export default async function HomePage() {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect('/dashboard');

  return (
    <div
      className="min-h-screen bg-[#060E1A] text-white"
      style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif" }}
    >

      {/* ── Sticky Nav ───────────────────────────────────────────────────────── */}
      <nav
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-5 py-3.5"
        style={{
          background: 'rgba(6,14,26,0.88)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid rgba(70,125,215,0.1)',
        }}
      >
        <div className="flex items-center gap-2.5">
          <MagicLogo />
          <span className="text-[15px] font-bold text-white tracking-tight">Magic Engine</span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="text-[13px] font-medium px-4 py-2 rounded-lg transition-colors"
            style={{ color: 'rgba(160,195,255,0.55)' }}
          >
            Sign in
          </Link>
          <a
            href="/discover"
            className="text-[13px] font-bold px-4 py-2 rounded-lg transition-all"
            style={{
              background: 'linear-gradient(135deg,#2855A4 0%,#183572 100%)',
              border: '1px solid rgba(75,135,225,0.32)',
              color: '#EEF4FF',
            }}
          >
            Talk to Us →
          </a>
        </div>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <section className="relative pt-36 pb-16 px-5 text-center overflow-hidden">
        {/* Glow */}
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
          <div style={{
            position: 'absolute', top: '-60px', left: '50%', transform: 'translateX(-50%)',
            width: '700px', height: '420px',
            background: 'radial-gradient(ellipse 90% 55% at 50% 0%, rgba(38,82,162,0.22) 0%, transparent 65%)',
          }} />
        </div>

        <div className="relative z-10 max-w-3xl mx-auto">
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-semibold mb-6"
            style={{ background: 'rgba(22,45,90,0.7)', border: '1px solid rgba(70,125,215,0.2)', color: '#7ABFFF' }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            Free Brand Discovery · No login required
          </div>

          <h1
            className="text-[48px] sm:text-[58px] font-black leading-tight tracking-tight mb-5"
            style={{ color: '#ECF3FF' }}
          >
            Is Your Business<br />
            <span style={{
              background: 'linear-gradient(90deg,#5B9EFF,#67E8F9)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}>
              Invisible Online?
            </span>
          </h1>

          <p className="text-[16px] leading-relaxed mb-10 max-w-xl mx-auto"
             style={{ color: 'rgba(120,170,230,0.58)' }}>
            Get a free brand scan + 6-dimension health score. See exactly where you&apos;re losing customers — then decide if you want us to fix it.
          </p>

          <form action="/discover" method="GET" className="flex gap-2.5 max-w-lg mx-auto">
            <input
              type="text"
              name="url"
              placeholder="yourwebsite.com.au"
              className="flex-1 px-4 py-3 text-[14px] rounded-xl outline-none transition-all"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(70,125,215,0.2)',
                color: '#EEF4FF',
              }}
            />
            <button
              type="submit"
              className="px-6 py-3 rounded-xl text-[14px] font-bold whitespace-nowrap transition-all"
              style={{
                background: 'linear-gradient(135deg,#2855A4 0%,#183572 100%)',
                border: '1px solid rgba(75,135,225,0.32)',
                color: '#EEF4FF',
              }}
            >
              Scan Free →
            </button>
          </form>
          <p className="text-[11px] mt-3" style={{ color: 'rgba(255,255,255,0.18)' }}>
            No signup &middot; No credit card &middot; Report delivered within 24 hours
          </p>
        </div>
      </section>

      {/* ── How It Works: 4-Step Workflow ────────────────────────────────────── */}
      <section className="px-5 pb-20 max-w-4xl mx-auto">
        <p className="text-center text-[11px] uppercase tracking-widest mb-2 font-semibold"
           style={{ color: 'rgba(120,170,230,0.3)' }}>
          How It Works
        </p>
        <h2 className="text-center text-[22px] font-black mb-2" style={{ color: '#ECF3FF' }}>
          From Scan to Execution
        </h2>
        <p className="text-center text-[13px] mb-10" style={{ color: 'rgba(120,170,230,0.4)' }}>
          Steps 1 &amp; 2 are free. Steps 3 &amp; 4 are where FDE takes over.
        </p>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {WORKFLOW_STEPS.map((s, i) => (
            <div
              key={s.step}
              className="rounded-2xl p-5 relative"
              style={{
                background: s.tier === 'free'
                  ? 'rgba(22,45,90,0.25)'
                  : 'rgba(255,255,255,0.015)',
                border: s.tier === 'free'
                  ? '1px solid rgba(75,135,225,0.25)'
                  : '1px solid rgba(70,125,215,0.1)',
              }}
            >
              {/* Connector line */}
              {i < WORKFLOW_STEPS.length - 1 && (
                <div className="hidden lg:block absolute top-8 -right-1.5 w-3 h-px"
                     style={{ background: 'rgba(70,125,215,0.3)' }} />
              )}

              {/* Tier badge */}
              <div className="flex items-center justify-between mb-4">
                <span
                  className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full"
                  style={
                    s.tier === 'free'
                      ? { background: 'rgba(34,197,94,0.15)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.2)' }
                      : { background: 'rgba(38,82,162,0.5)', color: '#7ABFFF', border: '1px solid rgba(75,135,225,0.25)' }
                  }
                >
                  {s.tierLabel}
                </span>
                <span className="text-[10px] font-bold tabular-nums" style={{ color: 'rgba(255,255,255,0.15)' }}>
                  {s.step}
                </span>
              </div>

              <div className="text-[24px] mb-2">{s.icon}</div>
              <p className="text-[14px] font-bold mb-0.5" style={{ color: '#ECF3FF' }}>{s.title}</p>
              <p className="text-[10px] font-semibold mb-2" style={{ color: 'rgba(120,170,230,0.4)' }}>{s.subtitle}</p>
              <p className="text-[11px] leading-relaxed" style={{ color: 'rgba(160,200,255,0.4)' }}>{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Sample Report Preview ─────────────────────────────────────────────── */}
      <section className="px-5 pb-16 max-w-2xl mx-auto">
        <p className="text-center text-[11px] uppercase tracking-widest mb-4 font-semibold"
           style={{ color: 'rgba(120,170,230,0.3)' }}>
          Sample — Steps 1 &amp; 2 Output
        </p>

        <div
          className="rounded-2xl overflow-hidden"
          style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(70,125,215,0.12)' }}
        >
          {/* Header */}
          <div className="px-6 pt-5 pb-4 flex items-start justify-between"
               style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center text-base"
                   style={{ background: 'rgba(239,68,68,0.15)' }}>🔴</div>
              <div>
                <p className="text-[13px] font-bold" style={{ color: '#ECF3FF' }}>
                  Crisis Type: <span style={{ color: '#f87171' }}>AI Invisibility</span>
                </p>
                <p className="text-[11px]" style={{ color: 'rgba(120,170,230,0.35)' }}>
                  acme-tours.com.au — Deep Diagnosis
                </p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[28px] font-black" style={{ color: '#f87171' }}>32</div>
              <div className="text-[10px]" style={{ color: 'rgba(255,255,255,0.25)' }}>/100</div>
            </div>
          </div>

          {/* Scores — Step 2 (Huatuo) */}
          <div className="px-6 py-4">
            <p className="text-[10px] uppercase tracking-wider font-semibold mb-3 flex items-center gap-1.5"
               style={{ color: 'rgba(120,170,230,0.4)' }}>
              <span>🩺</span> Deep Diagnosis — 6-Dimension Score
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
              {SAMPLE_SCORES.map(s => (
                <div key={s.label} className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{s.label}</span>
                    <span className="text-[11px] font-bold tabular-nums" style={{ color: scoreColor(s.value) }}>
                      {s.value}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <div className="h-1.5 rounded-full" style={{ width: `${s.value}%`, background: scoreColor(s.value) }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Issues — Step 1 (Zhangqian) */}
          <div className="px-6 pb-4" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
            <p className="text-[10px] uppercase tracking-wider font-semibold pt-4 mb-3 flex items-center gap-1.5"
               style={{ color: 'rgba(120,170,230,0.4)' }}>
              <span>🗺️</span> Brand Discovery — Top Issues
            </p>
            <div className="space-y-2">
              {[
                'Your business does not appear in ChatGPT or Perplexity searches',
                'Missing from 8 high-volume local keywords your competitors rank for',
                '47 technical SEO errors are slowing your site and hurting rankings',
              ].map((issue, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <span className="mt-0.5 text-[10px]" style={{ color: '#f87171' }}>●</span>
                  <span className="text-[12px]" style={{ color: 'rgba(200,225,255,0.45)' }}>{issue}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Locked — Steps 3 & 4 */}
          <div className="relative" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
            <div className="px-6 pt-4 pb-16 space-y-2 select-none" style={{ filter: 'blur(4px)', opacity: 0.2 }}>
              <p className="text-[11px] font-semibold" style={{ color: 'rgba(160,200,255,0.5)' }}>💊 Action Roadmap</p>
              <div className="text-[12px]" style={{ color: 'rgba(200,225,255,0.5)' }}>◼ 14 priority fixes, ranked by impact</div>
              <div className="text-[12px]" style={{ color: 'rgba(200,225,255,0.5)' }}>◼ 90-day execution timeline...</div>
              <p className="text-[11px] font-semibold mt-2" style={{ color: 'rgba(160,200,255,0.5)' }}>⚡ Luban Execution Board</p>
              <div className="text-[12px]" style={{ color: 'rgba(200,225,255,0.5)' }}>◼ 3 automated content campaigns ready...</div>
            </div>
            <div
              className="absolute inset-x-0 bottom-0 top-0 flex flex-col items-center justify-end pb-5"
              style={{ background: 'linear-gradient(to bottom, transparent 0%, rgba(6,14,26,0.97) 55%)' }}
            >
              <p className="text-[11px] mb-3 text-center" style={{ color: 'rgba(160,195,255,0.45)' }}>
                Steps 3 &amp; 4 unlock with FDE
              </p>
              <a
                href="/discover"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold transition-all"
                style={{
                  background: 'linear-gradient(135deg,#2855A4 0%,#183572 100%)',
                  border: '1px solid rgba(75,135,225,0.35)',
                  color: '#EEF4FF',
                }}
              >
                Talk to Us to Unlock →
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ── Tier Comparison ──────────────────────────────────────────────────── */}
      <section className="px-5 pb-20 max-w-3xl mx-auto">
        <h2 className="text-center text-[22px] font-black mb-2" style={{ color: '#ECF3FF' }}>
          Simple &amp; Transparent
        </h2>
        <p className="text-center text-[13px] mb-10" style={{ color: 'rgba(120,170,230,0.4)' }}>
          Discovery is free forever. Execution is where the magic happens.
        </p>

        <div className="grid sm:grid-cols-2 gap-4">

          {/* Free */}
          <div
            className="rounded-2xl p-6 flex flex-col"
            style={{ background: 'rgba(22,45,90,0.2)', border: '1px solid rgba(75,135,225,0.2)' }}
          >
            <div className="mb-5">
              <div className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: '#4ade80' }}>
                Discovery — Free
              </div>
              <div className="text-[36px] font-black leading-none" style={{ color: '#ECF3FF' }}>$0</div>
              <div className="text-[11px] mt-1" style={{ color: 'rgba(255,255,255,0.25)' }}>forever free</div>
            </div>
            <div className="space-y-3.5 flex-1">
              {FREE_FEATURES.map(f => (
                <div key={f.title} className="flex items-start gap-2.5">
                  <span className="text-[18px] flex-shrink-0">{f.icon}</span>
                  <div>
                    <p className="text-[12px] font-semibold" style={{ color: 'rgba(200,225,255,0.8)' }}>{f.title}</p>
                    <p className="text-[11px] leading-snug" style={{ color: 'rgba(120,170,230,0.45)' }}>{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <a
              href="/discover"
              className="mt-6 block text-center py-2.5 rounded-xl text-[13px] font-semibold transition-colors"
              style={{ border: '1px solid rgba(70,125,215,0.22)', color: 'rgba(160,195,255,0.6)' }}
            >
              Start Free Scan →
            </a>
          </div>

          {/* FDE */}
          <div
            className="rounded-2xl p-6 flex flex-col relative overflow-hidden"
            style={{ background: 'rgba(22,45,90,0.3)', border: '1px solid rgba(75,135,225,0.32)' }}
          >
            <div
              className="absolute top-4 right-4 text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full"
              style={{ background: 'rgba(38,82,162,0.8)', color: '#7ABFFF', border: '1px solid rgba(75,135,225,0.3)' }}
            >
              FDE
            </div>
            <div className="mb-5">
              <div className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: '#67E8F9' }}>
                Full Execution
              </div>
              <div className="text-[36px] font-black leading-none" style={{ color: '#ECF3FF' }}>Custom</div>
              <div className="text-[11px] mt-1" style={{ color: 'rgba(255,255,255,0.25)' }}>based on your business</div>
            </div>
            <div className="space-y-3.5 flex-1">
              {FDE_FEATURES.map(f => (
                <div key={f.title} className="flex items-start gap-2.5">
                  <span className="text-[18px] flex-shrink-0">{f.icon}</span>
                  <div>
                    <p className="text-[12px] font-semibold" style={{ color: 'rgba(200,225,255,0.8)' }}>{f.title}</p>
                    <p className="text-[11px] leading-snug" style={{ color: 'rgba(120,170,230,0.45)' }}>{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <a
              href="/discover"
              className="mt-6 block text-center py-2.5 rounded-xl text-[13px] font-bold transition-all"
              style={{
                background: 'linear-gradient(135deg,#2855A4 0%,#183572 100%)',
                border: '1px solid rgba(75,135,225,0.32)',
                color: '#EEF4FF',
              }}
            >
              Talk to Us →
            </a>
          </div>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────────────── */}
      <section className="px-5 pb-24 max-w-2xl mx-auto text-center">
        <div
          className="rounded-2xl p-10"
          style={{ background: 'rgba(22,45,90,0.25)', border: '1px solid rgba(70,125,215,0.18)' }}
        >
          <h2 className="text-[28px] font-black mb-3" style={{ color: '#ECF3FF' }}>
            Ready to fix what&apos;s broken?
          </h2>
          <p className="text-[13px] mb-8" style={{ color: 'rgba(120,170,230,0.45)' }}>
            Start free — see your health score. Then let&apos;s talk about what to do next.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <a
              href="/discover"
              className="px-6 py-3 rounded-xl text-[13px] font-semibold transition-colors"
              style={{ border: '1px solid rgba(70,125,215,0.2)', color: 'rgba(160,195,255,0.65)' }}
            >
              Free Discovery →
            </a>
            <a
              href="/discover"
              className="px-6 py-3 rounded-xl text-[13px] font-bold transition-all"
              style={{
                background: 'linear-gradient(135deg,#2855A4 0%,#183572 100%)',
                border: '1px solid rgba(75,135,225,0.32)',
                color: '#EEF4FF',
              }}
            >
              Talk to Us →
            </a>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <footer className="px-5 py-6 text-center" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
        <p className="text-[11px]" style={{ color: 'rgba(70,115,185,0.3)', letterSpacing: '2px' }}>
          MAGIC LAB &copy; 2026 &nbsp;·&nbsp; AI · AUTOMATION · FUTURE
        </p>
      </footer>

    </div>
  );
}
