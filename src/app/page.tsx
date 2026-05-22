import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

// ── Logo ────────────────────────────────────────────────────────────────────
const MagicLogo = () => (
  <svg width="30" height="28" viewBox="0 0 68 64" fill="none" aria-hidden="true">
    <path d="M53 3 L54.3 7.2 L58.5 8.5 L54.3 9.8 L53 14 L51.7 9.8 L47.5 8.5 L51.7 7.2 Z"
          fill="rgba(240,248,255,0.9)"/>
    <polygon points="3,60 13,6 22,6 12,60"   fill="#9ABDE0"/>
    <polygon points="13,6 22,6 33,38 24,38"  fill="#789EC8"/>
    <polygon points="46,6 55,6 44,38 35,38"  fill="#789EC8"/>
    <polygon points="46,6 55,6 65,60 55,60"  fill="#9ABDE0"/>
    <polygon points="24,38 33,38 34,48 35,38 44,38 34,60" fill="#587FAF"/>
  </svg>
);

// ── 4-step workflow ──────────────────────────────────────────────────────────
const WORKFLOW = [
  {
    n: '01', icon: '🗺️', tier: 'free',
    title: 'Brand Discovery',
    sub:   'Zhangqian Scan',
    desc:  'AI scans your brand across social, reviews, keywords & competitors. Surfaces your crisis type and top blind spots.',
  },
  {
    n: '02', icon: '🩺', tier: 'free',
    title: 'Deep Diagnosis',
    sub:   'Huatuo Analysis',
    desc:  '6-dimension health score: SEO · AI Visibility · Social · Ads · Reputation · Competitors.',
  },
  {
    n: '03', icon: '💊', tier: 'free',
    title: 'Action Roadmap',
    sub:   'Huatuo Prescription',
    desc:  'Prioritised fix plan — every issue ranked by impact and effort, with a clear 90-day timeline.',
  },
  {
    n: '04', icon: '⚡', tier: 'fde',
    title: 'Execute & Track',
    sub:   'Luban Board',
    desc:  'Automated content, campaigns & optimisations executed for you. Every action tracked with real ROI.',
  },
];

// ── Free features (steps 1–3) ────────────────────────────────────────────────
const FREE_FEATURES = [
  { icon: '🗺️', title: 'Brand Discovery Scan',   desc: 'Crisis type, top 3 blind spots, keyword gaps — full surface scan' },
  { icon: '🩺', title: '6-Dimension Health Score', desc: 'SEO · AI Visibility · Social · Ads · Reputation · Competitors, all scored' },
  { icon: '💊', title: 'Action Roadmap',           desc: 'A real, prioritised fix plan — not just a score, but exactly what to do next' },
];

// ── FDE features (step 4 + support) ─────────────────────────────────────────
const FDE_FEATURES = [
  { icon: '⚡', title: 'Execution Board (Luban)',    desc: 'We execute the roadmap for you — automated content, campaigns & optimisations' },
  { icon: '🤖', title: 'Content Engine',             desc: 'SEO blogs, social campaigns & GEO directives, all automated to plan' },
  { icon: '📈', title: 'ROI Attribution',            desc: 'Every action tracked: what moved the needle and by how much' },
  { icon: '📋', title: 'Monthly Intelligence Reports', desc: 'Automated performance reports delivered to your inbox' },
  { icon: '👥', title: 'Dedicated Specialist',       desc: 'A human expert oversees your strategy and keeps execution on track' },
];

// ── Sample scores ────────────────────────────────────────────────────────────
const SCORES = [
  { label: 'SEO',           value: 28 },
  { label: 'AI Visibility', value: 12 },
  { label: 'Social',        value: 45 },
  { label: 'Ads',           value: 62 },
  { label: 'Reputation',    value: 71 },
  { label: 'Competitors',   value: 33 },
];

const scoreCol = (v: number) => v < 40 ? '#ef4444' : v < 60 ? '#eab308' : '#22c55e';

export default async function HomePage() {
  const supabase = createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect('/dashboard');

  return (
    <div className="min-h-screen bg-[#060E1A] text-white"
         style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',sans-serif" }}>

      {/* ── Nav ─────────────────────────────────────────────────────────────── */}
      <nav className="fixed top-0 inset-x-0 z-50 flex items-center justify-between px-5 py-3.5"
           style={{ background:'rgba(6,14,26,0.88)', backdropFilter:'blur(20px)', borderBottom:'1px solid rgba(70,125,215,0.1)' }}>
        <div className="flex items-center gap-2.5">
          <MagicLogo />
          <span className="text-[15px] font-bold tracking-tight">Magic Engine</span>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/login" className="text-[13px] font-medium px-4 py-2 rounded-lg"
                style={{ color:'rgba(160,195,255,0.55)' }}>
            Sign in
          </Link>
          <a href="/discover" className="text-[13px] font-bold px-4 py-2 rounded-lg"
             style={{ background:'linear-gradient(135deg,#2855A4,#183572)', border:'1px solid rgba(75,135,225,0.32)', color:'#EEF4FF' }}>
            Talk to Us →
          </a>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <section className="relative pt-36 pb-16 px-5 text-center overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true"
             style={{ background:'radial-gradient(ellipse 80% 50% at 50% -5%, rgba(38,82,162,0.22) 0%, transparent 60%)' }} />

        <div className="relative z-10 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-semibold mb-6"
               style={{ background:'rgba(22,45,90,0.7)', border:'1px solid rgba(70,125,215,0.2)', color:'#7ABFFF' }}>
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            Free — Scan · Diagnose · Get Your Action Plan
          </div>

          <h1 className="text-[48px] sm:text-[58px] font-black leading-tight tracking-tight mb-5"
              style={{ color:'#ECF3FF' }}>
            Is Your Business<br />
            <span style={{ background:'linear-gradient(90deg,#5B9EFF,#67E8F9)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text' }}>
              Invisible Online?
            </span>
          </h1>

          <p className="text-[16px] leading-relaxed mb-10 max-w-xl mx-auto"
             style={{ color:'rgba(120,170,230,0.58)' }}>
            Get a free brand scan, 6-dimension health score, and a real action roadmap — no login, no credit card.
            Only pay when you want us to <em>execute</em> it for you.
          </p>

          <form action="/discover" method="GET" className="flex gap-2.5 max-w-lg mx-auto">
            <input type="text" name="url" placeholder="yourwebsite.com.au"
                   className="flex-1 px-4 py-3 text-[14px] rounded-xl outline-none"
                   style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(70,125,215,0.2)', color:'#EEF4FF' }} />
            <button type="submit" className="px-6 py-3 rounded-xl text-[14px] font-bold whitespace-nowrap"
                    style={{ background:'linear-gradient(135deg,#2855A4,#183572)', border:'1px solid rgba(75,135,225,0.32)', color:'#EEF4FF' }}>
              Scan Free →
            </button>
          </form>
          <p className="text-[11px] mt-3" style={{ color:'rgba(255,255,255,0.18)' }}>
            No signup &middot; No credit card &middot; Report within 24 hours
          </p>
        </div>
      </section>

      {/* ── 4-Step Workflow ─────────────────────────────────────────────────── */}
      <section className="px-5 pb-20 max-w-4xl mx-auto">
        <p className="text-center text-[11px] uppercase tracking-widest mb-2 font-semibold"
           style={{ color:'rgba(120,170,230,0.3)' }}>How It Works</p>
        <h2 className="text-center text-[22px] font-black mb-1.5" style={{ color:'#ECF3FF' }}>
          Scan → Diagnose → Plan → Execute
        </h2>
        <p className="text-center text-[13px] mb-10" style={{ color:'rgba(120,170,230,0.4)' }}>
          Steps 1–3 are completely free. Step 4 is where FDE takes over.
        </p>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {WORKFLOW.map((s, i) => (
            <div key={s.n} className="rounded-2xl p-5 relative"
                 style={{
                   background: s.tier === 'free' ? 'rgba(22,45,90,0.25)' : 'rgba(255,255,255,0.015)',
                   border: s.tier === 'free' ? '1px solid rgba(75,135,225,0.25)' : '1px solid rgba(70,125,215,0.1)',
                 }}>
              {/* connector */}
              {i < 3 && (
                <div className="hidden lg:block absolute top-8 -right-1.5 w-3 h-px"
                     style={{ background:'rgba(70,125,215,0.25)' }} />
              )}
              <div className="flex items-center justify-between mb-4">
                <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full"
                      style={ s.tier === 'free'
                        ? { background:'rgba(34,197,94,0.15)', color:'#4ade80', border:'1px solid rgba(34,197,94,0.2)' }
                        : { background:'rgba(38,82,162,0.5)',  color:'#7ABFFF', border:'1px solid rgba(75,135,225,0.25)' }
                      }>
                  {s.tier === 'free' ? 'Free' : 'FDE'}
                </span>
                <span className="text-[10px] font-bold tabular-nums" style={{ color:'rgba(255,255,255,0.15)' }}>{s.n}</span>
              </div>
              <div className="text-[24px] mb-2">{s.icon}</div>
              <p className="text-[14px] font-bold mb-0.5" style={{ color:'#ECF3FF' }}>{s.title}</p>
              <p className="text-[10px] font-semibold mb-2" style={{ color:'rgba(120,170,230,0.4)' }}>{s.sub}</p>
              <p className="text-[11px] leading-relaxed" style={{ color:'rgba(160,200,255,0.4)' }}>{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Sample Report Preview ────────────────────────────────────────────── */}
      <section className="px-5 pb-16 max-w-2xl mx-auto">
        <p className="text-center text-[11px] uppercase tracking-widest mb-4 font-semibold"
           style={{ color:'rgba(120,170,230,0.3)' }}>Sample Report (Steps 1–3, Free)</p>

        <div className="rounded-2xl overflow-hidden"
             style={{ background:'rgba(255,255,255,0.025)', border:'1px solid rgba(70,125,215,0.12)' }}>

          {/* Header */}
          <div className="px-6 pt-5 pb-4 flex items-start justify-between"
               style={{ borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                   style={{ background:'rgba(239,68,68,0.15)' }}>🔴</div>
              <div>
                <p className="text-[13px] font-bold" style={{ color:'#ECF3FF' }}>
                  Crisis: <span style={{ color:'#f87171' }}>AI Invisibility</span>
                </p>
                <p className="text-[11px]" style={{ color:'rgba(120,170,230,0.35)' }}>acme-tours.com.au</p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[28px] font-black" style={{ color:'#f87171' }}>32</div>
              <div className="text-[10px]" style={{ color:'rgba(255,255,255,0.25)' }}>/100</div>
            </div>
          </div>

          {/* Step 2 — 6-dim scores */}
          <div className="px-6 py-4" style={{ borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
            <p className="text-[10px] uppercase tracking-wider font-semibold mb-3 flex items-center gap-1.5"
               style={{ color:'rgba(120,170,230,0.4)' }}>
              🩺 Deep Diagnosis
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
              {SCORES.map(s => (
                <div key={s.label} className="space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-[11px]" style={{ color:'rgba(255,255,255,0.4)' }}>{s.label}</span>
                    <span className="text-[11px] font-bold tabular-nums" style={{ color:scoreCol(s.value) }}>{s.value}</span>
                  </div>
                  <div className="h-1.5 rounded-full" style={{ background:'rgba(255,255,255,0.06)' }}>
                    <div className="h-1.5 rounded-full" style={{ width:`${s.value}%`, background:scoreCol(s.value) }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Step 1 — issues */}
          <div className="px-6 py-4" style={{ borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
            <p className="text-[10px] uppercase tracking-wider font-semibold mb-3 flex items-center gap-1.5"
               style={{ color:'rgba(120,170,230,0.4)' }}>
              🗺️ Brand Discovery — Top Issues
            </p>
            {[
              'Your business does not appear in ChatGPT or Perplexity searches',
              'Missing from 8 high-volume local keywords your competitors rank for',
              '47 technical SEO errors are slowing your site and hurting rankings',
            ].map((t, i) => (
              <div key={i} className="flex items-start gap-2 mb-1.5">
                <span className="text-[10px] mt-0.5" style={{ color:'#f87171' }}>●</span>
                <span className="text-[12px]" style={{ color:'rgba(200,225,255,0.45)' }}>{t}</span>
              </div>
            ))}
          </div>

          {/* Step 3 — action roadmap (FREE, partially shown) */}
          <div className="px-6 py-4" style={{ borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
            <p className="text-[10px] uppercase tracking-wider font-semibold mb-3 flex items-center gap-1.5"
               style={{ color:'rgba(120,170,230,0.4)' }}>
              💊 Action Roadmap <span className="ml-1 px-1.5 py-0.5 rounded-full text-[9px]"
                style={{ background:'rgba(34,197,94,0.15)', color:'#4ade80', border:'1px solid rgba(34,197,94,0.2)' }}>Free</span>
            </p>
            {[
              { priority: 'P1', action: 'Submit sitemap to Google Search Console + fix crawl errors', impact: 'SEO +18' },
              { priority: 'P2', action: 'Deploy GEO directive targeting "tours New Zealand" queries', impact: 'AI +22' },
              { priority: 'P3', action: 'Respond to 12 unanswered Google reviews (avg 3.2★ → 4.5★)', impact: 'Rep +14' },
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-3 mb-2.5">
                <span className="text-[9px] font-black px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0"
                      style={{ background:'rgba(75,135,225,0.2)', color:'#7ABFFF', border:'1px solid rgba(75,135,225,0.25)' }}>
                  {item.priority}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px]" style={{ color:'rgba(200,225,255,0.65)' }}>{item.action}</p>
                </div>
                <span className="text-[10px] font-bold flex-shrink-0" style={{ color:'#4ade80' }}>{item.impact}</span>
              </div>
            ))}
            <p className="text-[11px] mt-2" style={{ color:'rgba(120,170,230,0.3)' }}>
              + 11 more actions in your full report…
            </p>
          </div>

          {/* Step 4 — Luban execution (LOCKED / FDE) */}
          <div className="relative">
            <div className="px-6 py-4 pb-16 space-y-2 select-none"
                 style={{ filter:'blur(4px)', opacity:0.2 }}>
              <p className="text-[11px] font-semibold" style={{ color:'rgba(160,200,255,0.6)' }}>⚡ Luban Execution Board</p>
              <div className="text-[12px]" style={{ color:'rgba(200,225,255,0.5)' }}>◼ 3 blog drafts queued for P1 keywords</div>
              <div className="text-[12px]" style={{ color:'rgba(200,225,255,0.5)' }}>◼ Social campaign scheduled: 14 posts / 4 weeks</div>
              <div className="text-[12px]" style={{ color:'rgba(200,225,255,0.5)' }}>◼ GEO directive live on 2 pages...</div>
            </div>
            <div className="absolute inset-x-0 bottom-0 top-0 flex flex-col items-center justify-end pb-5"
                 style={{ background:'linear-gradient(to bottom, transparent 0%, rgba(6,14,26,0.97) 45%)' }}>
              <p className="text-[11px] mb-3" style={{ color:'rgba(160,195,255,0.4)' }}>
                ⚡ Luban execution is FDE-only — we do it for you
              </p>
              <a href="/discover"
                 className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold"
                 style={{ background:'linear-gradient(135deg,#2855A4,#183572)', border:'1px solid rgba(75,135,225,0.35)', color:'#EEF4FF' }}>
                Talk to Us to Get Started →
              </a>
            </div>
          </div>

        </div>
      </section>

      {/* ── Tier Comparison ─────────────────────────────────────────────────── */}
      <section className="px-5 pb-20 max-w-3xl mx-auto">
        <h2 className="text-center text-[22px] font-black mb-2" style={{ color:'#ECF3FF' }}>
          Simple &amp; Transparent
        </h2>
        <p className="text-center text-[13px] mb-10" style={{ color:'rgba(120,170,230,0.4)' }}>
          Most businesses already know what to do after the free report.<br />
          FDE is for those who want it <em>done</em>.
        </p>

        <div className="grid sm:grid-cols-2 gap-4">

          {/* Free */}
          <div className="rounded-2xl p-6 flex flex-col"
               style={{ background:'rgba(22,45,90,0.2)', border:'1px solid rgba(75,135,225,0.2)' }}>
            <div className="mb-5">
              <div className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color:'#4ade80' }}>
                Discovery — Free
              </div>
              <div className="text-[36px] font-black leading-none" style={{ color:'#ECF3FF' }}>$0</div>
              <div className="text-[11px] mt-1" style={{ color:'rgba(255,255,255,0.25)' }}>forever free</div>
            </div>
            <div className="space-y-3.5 flex-1">
              {FREE_FEATURES.map(f => (
                <div key={f.title} className="flex items-start gap-2.5">
                  <span className="text-[18px] flex-shrink-0">{f.icon}</span>
                  <div>
                    <p className="text-[12px] font-semibold" style={{ color:'rgba(200,225,255,0.8)' }}>{f.title}</p>
                    <p className="text-[11px] leading-snug" style={{ color:'rgba(120,170,230,0.45)' }}>{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <a href="/discover"
               className="mt-6 block text-center py-2.5 rounded-xl text-[13px] font-semibold"
               style={{ border:'1px solid rgba(70,125,215,0.22)', color:'rgba(160,195,255,0.6)' }}>
              Get Free Report →
            </a>
          </div>

          {/* FDE */}
          <div className="rounded-2xl p-6 flex flex-col relative overflow-hidden"
               style={{ background:'rgba(22,45,90,0.3)', border:'1px solid rgba(75,135,225,0.32)' }}>
            <div className="absolute top-4 right-4 text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full"
                 style={{ background:'rgba(38,82,162,0.8)', color:'#7ABFFF', border:'1px solid rgba(75,135,225,0.3)' }}>
              FDE
            </div>
            <div className="mb-5">
              <div className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color:'#67E8F9' }}>
                Full Execution
              </div>
              <div className="text-[36px] font-black leading-none" style={{ color:'#ECF3FF' }}>Custom</div>
              <div className="text-[11px] mt-1" style={{ color:'rgba(255,255,255,0.25)' }}>based on your business</div>
            </div>
            <div className="space-y-3.5 flex-1">
              <div className="flex items-start gap-2 mb-1 pb-2"
                   style={{ borderBottom:'1px solid rgba(70,125,215,0.15)' }}>
                <span className="text-[11px]" style={{ color:'rgba(120,170,230,0.4)' }}>
                  ✓ Everything in Discovery, plus:
                </span>
              </div>
              {FDE_FEATURES.map(f => (
                <div key={f.title} className="flex items-start gap-2.5">
                  <span className="text-[18px] flex-shrink-0">{f.icon}</span>
                  <div>
                    <p className="text-[12px] font-semibold" style={{ color:'rgba(200,225,255,0.8)' }}>{f.title}</p>
                    <p className="text-[11px] leading-snug" style={{ color:'rgba(120,170,230,0.45)' }}>{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <a href="/discover"
               className="mt-6 block text-center py-2.5 rounded-xl text-[13px] font-bold"
               style={{ background:'linear-gradient(135deg,#2855A4,#183572)', border:'1px solid rgba(75,135,225,0.32)', color:'#EEF4FF' }}>
              Talk to Us →
            </a>
          </div>

        </div>
      </section>

      {/* ── Final CTA ───────────────────────────────────────────────────────── */}
      <section className="px-5 pb-24 max-w-2xl mx-auto text-center">
        <div className="rounded-2xl p-10"
             style={{ background:'rgba(22,45,90,0.25)', border:'1px solid rgba(70,125,215,0.18)' }}>
          <h2 className="text-[28px] font-black mb-3" style={{ color:'#ECF3FF' }}>
            Start free. Scale when ready.
          </h2>
          <p className="text-[13px] mb-8" style={{ color:'rgba(120,170,230,0.45)' }}>
            Get your free report now. When the roadmap feels too big to tackle alone — that&apos;s when we talk.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <a href="/discover"
               className="px-6 py-3 rounded-xl text-[13px] font-semibold"
               style={{ border:'1px solid rgba(70,125,215,0.2)', color:'rgba(160,195,255,0.65)' }}>
              Free Discovery →
            </a>
            <a href="/discover"
               className="px-6 py-3 rounded-xl text-[13px] font-bold"
               style={{ background:'linear-gradient(135deg,#2855A4,#183572)', border:'1px solid rgba(75,135,225,0.32)', color:'#EEF4FF' }}>
              Talk to Us →
            </a>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="px-5 py-6 text-center" style={{ borderTop:'1px solid rgba(255,255,255,0.04)' }}>
        <p className="text-[11px]" style={{ color:'rgba(70,115,185,0.3)', letterSpacing:'2px' }}>
          MAGIC LAB &copy; 2026 &nbsp;·&nbsp; AI · AUTOMATION · FUTURE
        </p>
      </footer>

    </div>
  );
}
