import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://magicengine.com.au'
const pageTitle = 'AI Upgrade & Training for AU/NZ Businesses'
const pageDescription =
  'Bilingual English and Chinese AI upgrade support for businesses in Australia and New Zealand, with SEO, AI visibility, and training-led execution.'

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: pageTitle,
    description: pageDescription,
    url: '/',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: pageTitle,
    description: pageDescription,
  },
}

const modules = [
  {
    n: '01 · SEO',
    status: 'Live',
    title: 'SEO Content Engine',
    body: 'Dual-track visibility across Google and the new AI search. Keyword intelligence, dual-signal blogs, and weekly brand tracking across the engines that answer your customers.',
    features: ['Keyword Intelligence', 'AI Visibility Tracker', 'GEO Composer', 'Blog Studio'],
  },
  {
    n: '02 · Social',
    status: 'Live',
    title: 'Social Content Matrix',
    body: 'A multi-platform, multi-client production line. Brand briefs, batch campaign generation, AI visuals and video, then scheduled straight to your client accounts.',
    features: ['Brand Brief Studio', 'Campaign Studio', 'Visual & Video', 'Publishing Hub'],
  },
  {
    n: '03 · Ads',
    status: 'Building',
    title: 'Ads Intelligence',
    body: 'Connect ad accounts, run a 9-dimension AI diagnosis with a 0–100 health score, and apply reversible one-click fixes — or hand complex calls to the team.',
    features: ['Account connect', 'AI diagnosis', 'One-click fix'],
  },
  {
    n: '04 · Data',
    status: 'Coming',
    title: 'Insight Reports',
    body: 'Every battlefront, aggregated. Monthly intelligence reports delivered to the same portal your clients use for approvals and decisions.',
    features: ['Monthly PDF', 'Client Portal', 'Cross-module KPIs'],
  },
]

const flywheel = [
  {
    n: '01',
    title: 'Diagnose',
    body: 'Score search, AI visibility, social, ads, reputation and competitors without ever exposing the supplier names behind the data.',
  },
  {
    n: '02',
    title: 'Execute',
    body: 'Turn priority findings into content, website fixes, social assets and ad decisions your customers can review and approve.',
  },
  {
    n: '03',
    title: 'Prove',
    body: 'Bring outcomes back into the same portal customers use for approvals, reports and next-step decisions.',
  },
]

const metrics = [
  { value: '+23%', label: 'AI visibility lift for our first GEO pilot, CTS Tours NZ' },
  { value: '15', label: 'Visibility actions shipped in the current execution loop' },
  { value: '48h', label: 'From signing up to a prioritised diagnosis in hand' },
  { value: '100%', label: 'Of execution visible to the client, in real time' },
]

const faqs = [
  {
    question: 'Do you work with Chinese-speaking and English-speaking teams?',
    answer:
      'Yes. The site is being shaped for bilingual AU/NZ businesses, so both audiences can understand the offer without needing separate product tracks right away.',
  },
  {
    question: 'Can you help with AI training as well as SEO?',
    answer:
      'Yes. Training is part of the roadmap, and the homepage now gives that service a clear path without overbuilding a separate training system too early.',
  },
  {
    question: 'Are you focused on Australia and New Zealand?',
    answer:
      'Yes. The public site, search language, and examples are all written for Australia and New Zealand first.',
  },
  {
    question: 'What does the execution loop include?',
    answer:
      'Diagnosis, prioritised work items, customer approvals, shipped actions, and monthly proof — all in one portal. We run it as your external AI content operations team.',
  },
]

const homepageStructuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      name: 'Magic Engine',
      url: siteUrl,
      description: pageDescription,
      areaServed: ['Australia', 'New Zealand'],
    },
    {
      '@type': 'WebSite',
      name: 'Magic Engine',
      url: siteUrl,
    },
    {
      '@type': 'Service',
      name: 'AI upgrade and training',
      serviceType: 'AI upgrade and training for AU/NZ businesses',
      provider: {
        '@type': 'Organization',
        name: 'Magic Engine',
      },
      areaServed: ['Australia', 'New Zealand'],
    },
    {
      '@type': 'FAQPage',
      mainEntity: faqs.map(faq => ({
        '@type': 'Question',
        name: faq.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: faq.answer,
        },
      })),
    },
  ],
}

function MeLogo({ size = 36 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="meGradLogo" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
          <stop stopColor="#EBCB8B" />
          <stop offset="0.55" stopColor="#C4912E" />
          <stop offset="1" stopColor="#A6781F" />
        </linearGradient>
        <radialGradient id="meNodeLogo" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.45" stopColor="#FBEFD2" />
          <stop offset="1" stopColor="#EBCB8B" />
        </radialGradient>
      </defs>
      <rect width="100" height="100" rx="22" fill="#0D0D0D" />
      <g stroke="url(#meGradLogo)" fill="none" strokeLinecap="round" strokeWidth="5.5">
        <path d="M14,24 C38,30 56,44 78,52" />
        <path d="M14,36 C38,40 56,46 78,52" />
        <path d="M14,48 C40,50 56,50 78,52" />
        <path d="M14,60 C40,58 56,56 78,52" />
        <path d="M14,72 C38,66 56,60 78,52" />
      </g>
      <g fill="url(#meGradLogo)">
        <circle cx="14" cy="24" r="3.5" />
        <circle cx="14" cy="36" r="3.5" />
        <circle cx="14" cy="48" r="3.5" />
        <circle cx="14" cy="60" r="3.5" />
        <circle cx="14" cy="72" r="3.5" />
      </g>
      <rect x="69" y="41" width="20" height="20" rx="5" fill="url(#meNodeLogo)" />
    </svg>
  )
}

function MeMarkHero() {
  return (
    <svg
      viewBox="0 0 200 180"
      fill="none"
      aria-label="Magic Engine mark"
      className="w-full max-w-[380px] opacity-90"
    >
      <defs>
        <linearGradient id="meGradHero" x1="20" y1="20" x2="180" y2="160" gradientUnits="userSpaceOnUse">
          <stop stopColor="#EBCB8B" />
          <stop offset="0.55" stopColor="#C4912E" />
          <stop offset="1" stopColor="#A6781F" />
        </linearGradient>
        <radialGradient id="meNodeHero" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.45" stopColor="#FBEFD2" />
          <stop offset="1" stopColor="#EBCB8B" />
        </radialGradient>
        <radialGradient id="meGlowHero" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#EBCB8B" stopOpacity="0.55" />
          <stop offset="1" stopColor="#EBCB8B" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="171" cy="92" r="60" fill="url(#meGlowHero)" />
      <g stroke="url(#meGradHero)" fill="none" strokeLinecap="round" strokeWidth="7">
        <path d="M20,38 C68,50 108,78 149,92" />
        <path d="M20,62 C70,68 110,84 149,92" />
        <path d="M20,86 C74,90 110,90 149,92" />
        <path d="M20,110 C74,102 110,98 149,92" />
        <path d="M20,134 C68,122 110,104 149,92" />
      </g>
      <g fill="url(#meGradHero)">
        <circle cx="20" cy="38" r="6" />
        <circle cx="20" cy="62" r="6" />
        <circle cx="20" cy="86" r="6" />
        <circle cx="20" cy="110" r="6" />
        <circle cx="20" cy="134" r="6" />
      </g>
      <rect x="149" y="70" width="44" height="44" rx="13" fill="#FFFCF5" stroke="url(#meGradHero)" strokeWidth="3.5" />
      <rect x="160" y="81" width="22" height="22" rx="5" fill="url(#meNodeHero)" />
      <g stroke="url(#meGradHero)" strokeWidth="2.6" strokeLinecap="round">
        <path d="M166,77 v4" /><path d="M171,77 v4" /><path d="M176,77 v4" />
        <path d="M166,103 v4" /><path d="M171,103 v4" /><path d="M176,103 v4" />
        <path d="M156,87 h4" /><path d="M156,92 h4" /><path d="M156,97 h4" />
        <path d="M182,87 h4" /><path d="M182,92 h4" /><path d="M182,97 h4" />
      </g>
      <circle cx="171" cy="92" r="4.5" fill="#fff" />
    </svg>
  )
}

const statusColor: Record<string, string> = {
  Live: 'text-[#5C8A4A] bg-[rgba(92,138,74,0.12)]',
  Building: 'text-[#C4912E] bg-[rgba(196,145,46,0.14)]',
  Coming: 'text-[#8A8276] bg-[rgba(183,177,165,0.20)]',
}

export default async function HomePage() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const supabase = createServerSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) redirect('/dashboard')
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(homepageStructuredData) }}
      />
      <main className="min-h-screen overflow-x-hidden" style={{ background: '#FBF8F3', color: '#1A1A1A' }}>

        {/* ── NAV ── */}
        <header
          className="sticky top-0 z-50 border-b"
          style={{
            background: 'rgba(251,248,243,0.82)',
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            borderColor: 'rgba(26,26,26,0.10)',
          }}
        >
          <div className="mx-auto flex h-[72px] max-w-[1200px] items-center justify-between gap-5 px-6 lg:px-8">
            <Link href="/" className="flex items-center gap-2.5">
              <MeLogo size={36} />
              <span className="font-display" style={{ fontFamily: 'var(--font-display, "Space Grotesk"), sans-serif', fontWeight: 700, fontSize: 17, letterSpacing: '-0.02em' }}>
                Magic Engine
              </span>
            </Link>
            <nav className="hidden items-center gap-6 text-sm font-medium lg:flex" style={{ color: 'rgba(26,26,26,0.65)' }}>
              <a href="#flywheel" className="hover:text-[#1A1A1A] transition-colors">How it works</a>
              <a href="#modules" className="hover:text-[#1A1A1A] transition-colors">Product</a>
              <a href="#proof" className="hover:text-[#1A1A1A] transition-colors">Pilots</a>
              <a href="#faq" className="hover:text-[#1A1A1A] transition-colors">FAQ</a>
              <Link href="/geo" className="hover:text-[#1A1A1A] transition-colors">GEO</Link>
              <Link href="/training" className="hover:text-[#1A1A1A] transition-colors">Training</Link>
              <Link href="/about" className="hover:text-[#1A1A1A] transition-colors">About</Link>
            </nav>
            <div className="flex items-center gap-3">
              <Link
                href="/portal/login"
                className="hidden rounded-xl border px-4 py-2 text-sm font-semibold transition-colors hover:bg-white sm:block"
                style={{ borderColor: 'rgba(26,26,26,0.14)', color: '#1A1A1A' }}
              >
                View portal
              </Link>
              <Link
                href="/contact"
                className="rounded-xl px-4 py-2 text-sm font-semibold transition-all hover:-translate-y-px"
                style={{
                  background: 'linear-gradient(135deg, #EBCB8B 0%, #C4912E 55%, #A6781F 100%)',
                  color: '#2A2008',
                  boxShadow: '0 18px 50px rgba(196,145,46,.22)',
                }}
              >
                Get free diagnosis
              </Link>
            </div>
          </div>
        </header>

        {/* ── HERO ── */}
        <section className="relative overflow-hidden py-16 sm:py-24">
          <div className="mx-auto max-w-[1200px] px-6 lg:px-8">
            <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-14">
              <div>
                <p
                  className="mb-4 text-xs font-semibold uppercase tracking-[0.16em]"
                  style={{ color: '#C4912E' }}
                >
                  AI Execution Engine — for AU/NZ growth teams
                </p>
                <h1
                  className="text-5xl font-semibold leading-[1.04] tracking-tight sm:text-6xl lg:text-[clamp(40px,5.4vw,68px)]"
                  style={{ fontFamily: 'var(--font-display, "Space Grotesk"), sans-serif', letterSpacing: '-0.02em' }}
                >
                  Turns diagnosis into{' '}
                  <span style={{ background: 'linear-gradient(135deg, #EBCB8B 0%, #C4912E 55%, #A6781F 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                    visible execution.
                  </span>
                </h1>
                <p className="mt-6 text-lg leading-relaxed" style={{ color: 'rgba(26,26,26,0.65)', maxWidth: '30em' }}>
                  Discover opportunities, execute the work, and show customers what changed — across search, AI visibility, social, ads, reputation and competitor signals. One managed loop, run by Magic Lab as your external AI content team.
                </p>
                <p className="mt-3 text-sm leading-relaxed" style={{ color: 'rgba(26,26,26,0.48)' }}>
                  面向澳洲和新西兰企业的 AI 升级与培训。先把信息说清楚，再把执行做起来。
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <Link
                    href="/contact"
                    className="inline-flex h-12 items-center gap-2 rounded-xl px-5 text-sm font-semibold transition-all hover:-translate-y-0.5"
                    style={{
                      background: 'linear-gradient(135deg, #EBCB8B 0%, #C4912E 55%, #A6781F 100%)',
                      color: '#2A2008',
                      boxShadow: '0 18px 50px rgba(196,145,46,.22)',
                    }}
                  >
                    Get free diagnosis
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  </Link>
                  <Link
                    href="/portal/login"
                    className="inline-flex h-12 items-center rounded-xl border px-5 text-sm font-semibold transition-all hover:bg-white"
                    style={{ borderColor: 'rgba(26,26,26,0.18)', color: '#1A1A1A' }}
                  >
                    See the client portal
                  </Link>
                </div>
                <p className="mt-4 flex items-center gap-2 text-xs font-medium" style={{ color: 'rgba(26,26,26,0.48)' }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#5C8A4A' }} />
                  No commitment · Diagnosis delivered in 48 hours
                </p>
              </div>
              <div className="flex items-center justify-center">
                <div className="relative">
                  <div
                    className="absolute right-[4%] top-1/2 -translate-y-1/2 h-[320px] w-[320px] rounded-full pointer-events-none"
                    style={{ background: 'radial-gradient(circle, rgba(235,203,139,0.55) 0%, rgba(235,203,139,0.18) 35%, rgba(235,203,139,0) 70%)' }}
                  />
                  <MeMarkHero />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── TRUST STRIP ── */}
        <section
          className="border-y"
          style={{ borderColor: 'rgba(26,26,26,0.10)', background: 'rgba(234,230,223,0.40)' }}
        >
          <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-8 px-6 py-7 lg:px-8">
            <div className="flex items-center gap-3.5">
              <svg viewBox="0 0 80 70" fill="none" className="h-11 w-auto flex-none" aria-hidden="true">
                <path d="M14 30 C20 18 34 12 46 16 C56 19 60 28 68 30 C72 31 74 36 70 40 C64 46 58 40 54 44 C50 48 52 56 46 58 C40 60 38 52 32 52 C26 52 22 60 17 56 C12 52 18 46 16 40 C14 35 10 36 14 30 Z" fill="#C4912E" opacity="0.9" />
                <circle cx="62" cy="50" r="4" fill="#C4912E" />
              </svg>
              <span
                className="text-xs font-semibold uppercase leading-5 tracking-[0.12em]"
                style={{ color: '#C4912E' }}
              >
                Built for<br />Australia &amp; New Zealand
              </span>
            </div>
            <div className="flex gap-12">
              {[
                { n: '4', label: 'Marketing battlefronts covered' },
                { n: '+23%', label: 'AI visibility lift (GEO pilot)' },
                { n: '48h', label: 'From signup to diagnosis' },
              ].map(stat => (
                <div key={stat.label}>
                  <p className="font-display text-2xl font-semibold" style={{ fontFamily: 'var(--font-display, "Space Grotesk"), sans-serif', color: '#1A1A1A' }}>
                    {stat.n}
                  </p>
                  <p className="mt-0.5 text-xs" style={{ color: 'rgba(26,26,26,0.62)' }}>{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── FLYWHEEL ── */}
        <section id="flywheel" className="py-20 sm:py-28">
          <div className="mx-auto max-w-[1200px] px-6 lg:px-8">
            <div className="flex items-center gap-3 mb-4">
              <span className="h-px w-8 opacity-50" style={{ background: '#C4912E' }} />
              <span className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: '#C4912E' }}>The execution flywheel</span>
            </div>
            <h2
              className="text-4xl font-semibold tracking-tight lg:text-5xl"
              style={{ fontFamily: 'var(--font-display, "Space Grotesk"), sans-serif', letterSpacing: '-0.02em' }}
            >
              One loop, turning continuously.
            </h2>
            <p className="mt-4 text-lg max-w-2xl" style={{ color: 'rgba(26,26,26,0.65)' }}>
              Most tools stop at the report. Magic Engine connects insight to impact — so the work that matters actually ships, and the results stay visible.
            </p>
            <div className="mt-12 grid gap-5 sm:grid-cols-3">
              {flywheel.map(item => (
                <article
                  key={item.title}
                  className="rounded-2xl p-7"
                  style={{ background: '#fff', border: '1px solid rgba(26,26,26,0.10)', boxShadow: '0 1px 2px rgba(26,26,26,.04), 0 8px 28px rgba(26,26,26,.06)' }}
                >
                  <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl" style={{ background: '#FBF8F3', border: '1px solid rgba(26,26,26,0.10)' }}>
                    <svg viewBox="0 0 200 180" fill="none" className="h-7 w-7">
                      <defs>
                        <linearGradient id={`fw${item.n}`} x1="20" y1="20" x2="180" y2="160" gradientUnits="userSpaceOnUse">
                          <stop stopColor="#EBCB8B" /><stop offset="0.55" stopColor="#C4912E" /><stop offset="1" stopColor="#A6781F" />
                        </linearGradient>
                        <radialGradient id={`fn${item.n}`} cx="0.5" cy="0.5" r="0.5">
                          <stop offset="0" stopColor="#FFFFFF" /><stop offset="0.45" stopColor="#FBEFD2" /><stop offset="1" stopColor="#EBCB8B" />
                        </radialGradient>
                      </defs>
                      <g stroke={`url(#fw${item.n})`} fill="none" strokeLinecap="round" strokeWidth="8">
                        <path d="M22,38 C70,50 110,78 148,92" /><path d="M22,62 C72,68 112,84 148,92" />
                        <path d="M22,86 C76,90 112,90 148,92" /><path d="M22,110 C76,102 112,98 148,92" />
                        <path d="M22,134 C70,122 112,104 148,92" />
                      </g>
                      <g fill={`url(#fw${item.n})`}>
                        <circle cx="22" cy="38" r="6.5" /><circle cx="22" cy="62" r="6.5" />
                        <circle cx="22" cy="86" r="6.5" /><circle cx="22" cy="110" r="6.5" />
                        <circle cx="22" cy="134" r="6.5" />
                      </g>
                      <rect x="148" y="74" width="36" height="36" rx="10" fill={`url(#fn${item.n})`} />
                    </svg>
                  </div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: '#C4912E' }}>{item.n}</p>
                  <h3 className="mt-1.5 text-xl font-semibold" style={{ fontFamily: 'var(--font-display, "Space Grotesk"), sans-serif' }}>
                    {item.title}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed" style={{ color: 'rgba(26,26,26,0.65)' }}>{item.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ── MODULES ── */}
        <section
          id="modules"
          className="py-20 sm:py-28"
          style={{ background: '#FBF8F3', borderTop: '1px solid rgba(26,26,26,0.10)', borderBottom: '1px solid rgba(26,26,26,0.10)' }}
        >
          <div className="mx-auto max-w-[1200px] px-6 lg:px-8">
            <div className="flex items-center gap-3 mb-4">
              <span className="h-px w-8 opacity-50" style={{ background: '#C4912E' }} />
              <span className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: '#C4912E' }}>Four battlefronts, one engine</span>
            </div>
            <h2
              className="text-4xl font-semibold tracking-tight lg:text-5xl"
              style={{ fontFamily: 'var(--font-display, "Space Grotesk"), sans-serif', letterSpacing: '-0.02em' }}
            >
              Be seen everywhere your customers look.
            </h2>
            <p className="mt-4 text-lg max-w-2xl" style={{ color: 'rgba(26,26,26,0.65)' }}>
              Magic Engine covers the full marketing surface — traditional search, AI answers, social and paid — as one connected operating system.
            </p>
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {modules.map(mod => (
                <article
                  key={mod.title}
                  className="flex flex-col rounded-2xl p-6"
                  style={{ background: '#fff', border: '1px solid rgba(26,26,26,0.10)', boxShadow: '0 1px 2px rgba(26,26,26,.04), 0 8px 28px rgba(26,26,26,.06)' }}
                >
                  <div className="mb-5 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: '#C4912E' }}>{mod.n}</span>
                    <span className={`rounded-full px-3 py-1 text-[11px] font-semibold leading-none ${statusColor[mod.status]}`}>
                      {mod.status}
                    </span>
                  </div>
                  <h3 className="text-[18px] font-semibold leading-snug" style={{ fontFamily: 'var(--font-display, "Space Grotesk"), sans-serif' }}>
                    {mod.title}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed" style={{ color: 'rgba(26,26,26,0.65)' }}>{mod.body}</p>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {mod.features.map(f => (
                      <span
                        key={f}
                        className="rounded-md px-2 py-0.5 text-[11px] font-medium"
                        style={{ background: 'rgba(196,145,46,0.10)', color: '#A6781F' }}
                      >
                        {f}
                      </span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ── METRICS ── */}
        <section id="outcomes" className="py-20 sm:py-28">
          <div className="mx-auto max-w-[1200px] px-6 lg:px-8">
            <div className="flex items-center gap-3 mb-4">
              <span className="h-px w-8 opacity-50" style={{ background: '#C4912E' }} />
              <span className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: '#C4912E' }}>The product promise</span>
            </div>
            <h2
              className="text-4xl font-semibold tracking-tight lg:text-5xl"
              style={{ fontFamily: 'var(--font-display, "Space Grotesk"), sans-serif', letterSpacing: '-0.02em' }}
            >
              Not another dashboard.<br />A managed execution system.
            </h2>
            <p className="mt-4 text-lg max-w-2xl" style={{ color: 'rgba(26,26,26,0.65)' }}>
              Magic Engine starts with diagnosis — but the product is the execution loop after it: prioritised work, customer approvals, shipped actions and monthly proof.
            </p>
            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {metrics.map(m => (
                <div
                  key={m.label}
                  className="rounded-2xl p-6"
                  style={{ background: '#fff', border: '1px solid rgba(26,26,26,0.10)' }}
                >
                  <p
                    className="font-display text-4xl font-semibold"
                    style={{ fontFamily: 'var(--font-display, "Space Grotesk"), sans-serif', color: '#C4912E' }}
                  >
                    {m.value}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed" style={{ color: 'rgba(26,26,26,0.65)' }}>{m.label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── PILOTS ── */}
        <section
          id="proof"
          className="py-20 sm:py-28"
          style={{ background: '#FBF8F3', borderTop: '1px solid rgba(26,26,26,0.10)', borderBottom: '1px solid rgba(26,26,26,0.10)' }}
        >
          <div className="mx-auto max-w-[1200px] px-6 lg:px-8">
            <div className="flex items-center gap-3 mb-4">
              <span className="h-px w-8 opacity-50" style={{ background: '#C4912E' }} />
              <span className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: '#C4912E' }}>Live with pilot clients</span>
            </div>
            <h2
              className="text-4xl font-semibold tracking-tight lg:text-5xl"
              style={{ fontFamily: 'var(--font-display, "Space Grotesk"), sans-serif', letterSpacing: '-0.02em' }}
            >
              Running today across AU &amp; NZ.
            </h2>
            <div className="mt-10 grid gap-5 lg:grid-cols-[1.5fr_1fr_1fr]">
              <div
                className="rounded-2xl p-8"
                style={{ background: '#fff', border: '1px solid rgba(26,26,26,0.10)', boxShadow: '0 1px 2px rgba(26,26,26,.04), 0 8px 28px rgba(26,26,26,.06)' }}
              >
                <p className="text-base leading-relaxed" style={{ color: 'rgba(26,26,26,0.72)', fontStyle: 'italic' }}>
                  "Magic Engine isn't a tool you buy and operate alone — Magic Lab runs it as your external AI content team, against an annual visibility build, not a monthly subscription."
                </p>
                <div className="mt-6 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold" style={{ background: 'linear-gradient(135deg, #EBCB8B 0%, #C4912E 100%)', color: '#2A2008' }}>ML</div>
                  <div>
                    <p className="text-sm font-semibold">Magic Lab</p>
                    <p className="text-xs" style={{ color: 'rgba(26,26,26,0.55)' }}>Your external AI content operations team</p>
                  </div>
                </div>
              </div>
              {[
                { initials: 'CT', name: 'CTS Tours NZ', role: 'Travel & tourism · New Zealand · pilot', body: 'GEO + SEO + Ads. Full execution loop live, with Meta ad data connected and AI visibility tracked weekly.' },
                { initials: 'OZ', name: 'Oztop', role: 'Local business · Australia · pilot', body: 'SEO + GEO. Dual-signal blogs and AI-recommendation instructions building search and AI-answer visibility.' },
              ].map(p => (
                <div
                  key={p.name}
                  className="rounded-2xl p-7"
                  style={{ background: '#fff', border: '1px solid rgba(26,26,26,0.10)' }}
                >
                  <p className="text-sm leading-relaxed" style={{ color: 'rgba(26,26,26,0.72)', fontStyle: 'italic' }}>&ldquo;{p.body}&rdquo;</p>
                  <div className="mt-5 flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold" style={{ background: 'rgba(196,145,46,0.15)', color: '#A6781F' }}>{p.initials}</div>
                    <div>
                      <p className="text-sm font-semibold">{p.name}</p>
                      <p className="text-xs" style={{ color: 'rgba(26,26,26,0.55)' }}>{p.role}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── FAQ ── */}
        <section id="faq" className="py-20 sm:py-28">
          <div className="mx-auto max-w-[1200px] px-6 lg:px-8">
            <div className="flex items-center gap-3 mb-4">
              <span className="h-px w-8 opacity-50" style={{ background: '#C4912E' }} />
              <span className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: '#C4912E' }}>FAQ</span>
            </div>
            <h2
              className="text-4xl font-semibold tracking-tight"
              style={{ fontFamily: 'var(--font-display, "Space Grotesk"), sans-serif', letterSpacing: '-0.02em' }}
            >
              Questions people ask before they reach out.
            </h2>
            <div className="mt-8 grid gap-3 max-w-3xl">
              {faqs.map(faq => (
                <details
                  key={faq.question}
                  className="group rounded-xl border p-5"
                  style={{ background: '#fff', borderColor: 'rgba(26,26,26,0.10)' }}
                >
                  <summary className="cursor-pointer list-none text-base font-semibold" style={{ fontFamily: 'var(--font-display, "Space Grotesk"), sans-serif' }}>
                    {faq.question}
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed" style={{ color: 'rgba(26,26,26,0.65)' }}>{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA STRIP ── */}
        <section className="py-20" style={{ background: '#0D0D0D' }}>
          <div className="mx-auto max-w-[1200px] px-6 text-center lg:px-8">
            <p className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: '#EBCB8B' }}>
              Get started
            </p>
            <h2
              className="mt-4 text-4xl font-semibold text-white lg:text-5xl"
              style={{ fontFamily: 'var(--font-display, "Space Grotesk"), sans-serif', letterSpacing: '-0.02em' }}
            >
              Ready to see what's possible?
            </h2>
            <p className="mt-4 text-lg max-w-xl mx-auto" style={{ color: 'rgba(251,248,243,0.62)' }}>
              Free diagnosis, no commitment. We map your visibility gaps and show you the first 3 actions that move the needle.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link
                href="/contact"
                className="inline-flex h-12 items-center gap-2 rounded-xl px-6 text-sm font-semibold transition-all hover:-translate-y-0.5"
                style={{
                  background: 'linear-gradient(135deg, #EBCB8B 0%, #C4912E 55%, #A6781F 100%)',
                  color: '#2A2008',
                  boxShadow: '0 18px 50px rgba(196,145,46,.22)',
                }}
              >
                Get free diagnosis
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </Link>
              <Link
                href="/portal/login"
                className="inline-flex h-12 items-center rounded-xl border px-6 text-sm font-semibold transition-colors hover:bg-white/10"
                style={{ borderColor: 'rgba(251,248,243,0.18)', color: 'rgba(251,248,243,0.85)' }}
              >
                View client portal
              </Link>
            </div>
          </div>
        </section>

        {/* ── FOOTER ── */}
        <footer style={{ borderTop: '1px solid rgba(26,26,26,0.10)', background: '#fff' }}>
          <div className="mx-auto flex max-w-[1200px] flex-col items-center justify-between gap-5 px-6 py-8 text-sm sm:flex-row lg:px-8" style={{ color: 'rgba(26,26,26,0.55)' }}>
            <div className="flex items-center gap-2.5">
              <MeLogo size={28} />
              <span style={{ fontFamily: 'var(--font-display, "Space Grotesk"), sans-serif', fontWeight: 600, fontSize: 14 }}>
                Magic Engine
              </span>
              <span className="ml-2">© {new Date().getFullYear()} Magic Lab. All rights reserved.</span>
            </div>
            <nav className="flex flex-wrap justify-center gap-5 text-sm">
              <Link href="/about" className="hover:text-[#1A1A1A] transition-colors">About</Link>
              <Link href="/geo" className="hover:text-[#1A1A1A] transition-colors">GEO</Link>
              <Link href="/training" className="hover:text-[#1A1A1A] transition-colors">Training</Link>
              <Link href="/privacy" className="hover:text-[#1A1A1A] transition-colors">Privacy Policy</Link>
              <Link href="/terms" className="hover:text-[#1A1A1A] transition-colors">Terms of Service</Link>
              <Link href="/contact" className="hover:text-[#1A1A1A] transition-colors">Contact</Link>
              <Link href="/portal/login" className="hover:text-[#1A1A1A] transition-colors">Portal</Link>
            </nav>
          </div>
        </footer>
      </main>
    </>
  )
}
