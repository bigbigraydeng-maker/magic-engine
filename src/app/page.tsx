import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import WaitlistForm from './_components/WaitlistForm'

export const dynamic = 'force-dynamic'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://magicengine.com.au'
const pageTitle = 'AI Growth Engine for Auckland Local Businesses — $990 for 90 Days'
const pageDescription =
  'We take 100 Auckland businesses and install a full AI growth engine — website, Google profile, enquiry tracking and lead generation — done for you, in person, in 90 days. Money-back guarantee.'

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

// The three phases of the $990 / 90-day founding package. Single source of
// truth: docs/superpowers/specs/2026-07-07-990-growth-engine-package-v1.md —
// change the spec first, then mirror here.
const phases = [
  {
    n: 'Weeks 1–3',
    title: 'Foundation',
    body: 'Your website refreshed, an enquiry form that rings your phone, visitor tracking you can check from anywhere, your Google Business Profile set up properly, and AI-search code on your site so ChatGPT can find you.',
  },
  {
    n: 'Weeks 3–8',
    title: 'Lead engine',
    body: 'Real reviews from your past customers feeding your Google ranking, a smooth search-to-call path — and for visual trades, short video ads that build an audience of locals who’ve seen your work.',
  },
  {
    n: 'Weeks 9–12',
    title: 'Proof',
    body: 'A before-and-after report on every leak we found on day one. Your data, your accounts, your assets — everything we build stays yours.',
  },
]

const faqs = [
  {
    question: 'Who is this for?',
    answer:
      'Auckland local businesses — builders, renovators, trades, flooring, landscaping and other local services. If your customers search "near me" or want to see your work before they call, this is built for you.',
  },
  {
    question: 'How does the money-back guarantee work?',
    answer:
      'The guarantee is tied to delivery: everything we commit to on your 90-day plan gets done. If we don’t deliver it, you get every dollar back. We don’t promise rankings or a number of leads — no honest company can — we promise the work, done properly.',
  },
  {
    question: 'Why is it only $990?',
    answer:
      'Because you’re one of our first 100 Auckland partners. We come to you in person, do the work, and (with your OK) your before-and-after becomes one of our success stories. Agencies charge $1,500–$3,000 a month for a fraction of this.',
  },
  {
    question: 'What do you need from me?',
    answer:
      'About an hour at kickoff — access to your website and Google Business Profile, some photos of your work, and your list of past customers if you want the review engine. We handle the rest.',
  },
  {
    question: 'I’m not in Auckland — can I still join?',
    answer:
      'The founding 100 is Auckland-only because we onboard every business face to face. Join the waitlist below and we’ll email you the moment we open your city.',
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
      areaServed: ['Auckland', 'New Zealand'],
    },
    {
      '@type': 'WebSite',
      name: 'Magic Engine',
      url: siteUrl,
    },
    {
      '@type': 'Service',
      name: 'AI growth engine for local businesses',
      serviceType: '90-day done-for-you digital marketing foundation and lead generation',
      provider: {
        '@type': 'Organization',
        name: 'Magic Engine',
      },
      areaServed: ['Auckland, New Zealand'],
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

const GOLD_GRAD = 'linear-gradient(135deg, #EBCB8B 0%, #C4912E 55%, #A6781F 100%)'
const DISPLAY = 'var(--font-display, "Space Grotesk"), sans-serif'

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
          <div className="mx-auto flex h-[72px] max-w-[1080px] items-center justify-between gap-5 px-6 lg:px-8">
            <Link href="/" className="flex items-center gap-2.5">
              <MeLogo size={36} />
              <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 17, letterSpacing: '-0.02em' }}>
                Magic Engine
              </span>
            </Link>
            <nav className="hidden items-center gap-6 text-sm font-medium lg:flex" style={{ color: 'rgba(26,26,26,0.65)' }}>
              <a href="#plan" className="hover:text-[#1A1A1A] transition-colors">The 90-day plan</a>
              <a href="#faq" className="hover:text-[#1A1A1A] transition-colors">FAQ</a>
              <a href="#waitlist" className="hover:text-[#1A1A1A] transition-colors">Outside Auckland?</a>
            </nav>
            <div className="flex items-center gap-3">
              <Link
                href="/portal/login"
                className="hidden rounded-xl border px-4 py-2 text-sm font-semibold transition-colors hover:bg-white sm:block"
                style={{ borderColor: 'rgba(26,26,26,0.14)', color: '#1A1A1A' }}
              >
                Client portal
              </Link>
              <Link
                href="/contact"
                className="rounded-xl px-4 py-2 text-sm font-semibold transition-all hover:-translate-y-px"
                style={{ background: GOLD_GRAD, color: '#2A2008', boxShadow: '0 18px 50px rgba(196,145,46,.22)' }}
              >
                Claim a spot
              </Link>
            </div>
          </div>
        </header>

        {/* ── HERO ── */}
        <section className="relative overflow-hidden py-16 sm:py-24">
          <div className="mx-auto max-w-[1080px] px-6 lg:px-8">
            <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-14">
              <div>
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider"
                  style={{ background: 'rgba(196,145,46,0.12)', color: '#A6781F' }}
                >
                  ★ Founding offer · first 100 Auckland businesses only
                </span>
                <h1
                  className="mt-5 text-5xl font-semibold leading-[1.04] tracking-tight sm:text-6xl lg:text-[clamp(40px,5.2vw,64px)]"
                  style={{ fontFamily: DISPLAY, letterSpacing: '-0.02em' }}
                >
                  Your AI growth engine.{' '}
                  <span style={{ background: GOLD_GRAD, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                    Done for you, in person.
                  </span>
                </h1>
                <p className="mt-6 text-lg leading-relaxed" style={{ color: 'rgba(26,26,26,0.65)', maxWidth: '30em' }}>
                  We take 100 Auckland local businesses and install everything customers need to find you,
                  trust you and reach you — website, Google profile, reviews, tracking and lead generation.
                  90 days, <span className="font-semibold" style={{ color: '#1A1A1A' }}>$990 NZD</span>, money-back guarantee.
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <Link
                    href="/contact"
                    className="inline-flex h-12 items-center gap-2 rounded-xl px-5 text-sm font-semibold transition-all hover:-translate-y-0.5"
                    style={{ background: GOLD_GRAD, color: '#2A2008', boxShadow: '0 18px 50px rgba(196,145,46,.22)' }}
                  >
                    Claim one of the 100 spots
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  </Link>
                  <a
                    href="#waitlist"
                    className="inline-flex h-12 items-center rounded-xl border px-5 text-sm font-semibold transition-all hover:bg-white"
                    style={{ borderColor: 'rgba(26,26,26,0.18)', color: '#1A1A1A' }}
                  >
                    Outside Auckland? Join the waitlist
                  </a>
                </div>
                <p className="mt-4 flex items-center gap-2 text-xs font-medium" style={{ color: 'rgba(26,26,26,0.48)' }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#5C8A4A' }} />
                  Auckland-based team · We come to you · 100% money-back if we don&apos;t deliver
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

        {/* ── 90-DAY PLAN ── */}
        <section id="plan" className="border-t py-20 sm:py-24" style={{ borderColor: 'rgba(26,26,26,0.10)' }}>
          <div className="mx-auto max-w-[1080px] px-6 lg:px-8">
            <div className="mb-4 flex items-center gap-3">
              <span className="h-px w-8 opacity-50" style={{ background: '#C4912E' }} />
              <span className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: '#C4912E' }}>What you get</span>
            </div>
            <h2 className="text-4xl font-semibold tracking-tight" style={{ fontFamily: DISPLAY, letterSpacing: '-0.02em' }}>
              90 days. Three phases. All done for you.
            </h2>
            <div className="mt-10 grid gap-5 md:grid-cols-3">
              {phases.map(phase => (
                <div key={phase.title} className="rounded-2xl border p-6" style={{ background: '#fff', borderColor: 'rgba(26,26,26,0.10)' }}>
                  <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#C4912E' }}>{phase.n}</p>
                  <h3 className="mt-2 text-xl font-semibold" style={{ fontFamily: DISPLAY }}>{phase.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed" style={{ color: 'rgba(26,26,26,0.65)' }}>{phase.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── PRICE + GUARANTEE ── */}
        <section className="py-20" style={{ background: '#0D0D0D' }}>
          <div className="mx-auto max-w-[720px] px-6 text-center lg:px-8">
            <p className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: '#EBCB8B' }}>
              Why this price
            </p>
            <h2 className="mt-4 text-4xl font-semibold text-white" style={{ fontFamily: DISPLAY, letterSpacing: '-0.02em' }}>
              Agencies charge <span className="line-through opacity-60">$1,500–$3,000 a month</span> for one piece of this.
            </h2>
            <p className="mt-5 text-lg" style={{ color: 'rgba(251,248,243,0.72)' }}>
              You pay <span className="font-bold" style={{ color: '#EBCB8B' }}>$990 NZD once</span> for the full 90 days —
              because you&apos;d be one of our first 100 Auckland partners. We come to you in person, do the work,
              and with your OK, your before-and-after becomes one of our success stories. That&apos;s the trade.
            </p>
            <div className="mx-auto mt-8 flex max-w-md items-start gap-3 rounded-2xl p-5 text-left" style={{ background: 'rgba(92,138,74,0.15)' }}>
              <span className="text-xl">🛡️</span>
              <p className="text-sm leading-relaxed text-white">
                <span className="font-bold" style={{ color: '#A7D18F' }}>100% money-back guarantee.</span>{' '}
                <span style={{ color: 'rgba(255,255,255,0.75)' }}>
                  Everything on your 90-day plan gets delivered, or you get every dollar back.
                </span>
              </p>
            </div>
            <div className="mt-8">
              <Link
                href="/contact"
                className="inline-flex h-12 items-center gap-2 rounded-xl px-6 text-sm font-semibold transition-all hover:-translate-y-0.5"
                style={{ background: GOLD_GRAD, color: '#2A2008', boxShadow: '0 18px 50px rgba(196,145,46,.22)' }}
              >
                Claim one of the 100 spots
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </Link>
            </div>
          </div>
        </section>

        {/* ── WAITLIST (outside Auckland) ── */}
        <section id="waitlist" className="py-20 sm:py-24">
          <div className="mx-auto max-w-[640px] px-6 lg:px-8">
            <div className="mb-4 flex items-center gap-3">
              <span className="h-px w-8 opacity-50" style={{ background: '#C4912E' }} />
              <span className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: '#C4912E' }}>Outside Auckland?</span>
            </div>
            <h2 className="text-4xl font-semibold tracking-tight" style={{ fontFamily: DISPLAY, letterSpacing: '-0.02em' }}>
              Join the waitlist for your city.
            </h2>
            <p className="mt-4 text-base leading-relaxed" style={{ color: 'rgba(26,26,26,0.65)' }}>
              The founding 100 is Auckland-only because we onboard every business face to face.
              Leave your details and we&apos;ll email you the moment we open your city — waitlist
              members get first pick of the next founding round.
            </p>
            <div className="mt-8">
              <WaitlistForm />
            </div>
          </div>
        </section>

        {/* ── FAQ ── */}
        <section id="faq" className="border-t py-20 sm:py-24" style={{ borderColor: 'rgba(26,26,26,0.10)' }}>
          <div className="mx-auto max-w-[1080px] px-6 lg:px-8">
            <div className="mb-4 flex items-center gap-3">
              <span className="h-px w-8 opacity-50" style={{ background: '#C4912E' }} />
              <span className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: '#C4912E' }}>FAQ</span>
            </div>
            <h2 className="text-4xl font-semibold tracking-tight" style={{ fontFamily: DISPLAY, letterSpacing: '-0.02em' }}>
              Questions people ask before they reach out.
            </h2>
            <div className="mt-8 grid max-w-3xl gap-3">
              {faqs.map(faq => (
                <details
                  key={faq.question}
                  className="group rounded-xl border p-5"
                  style={{ background: '#fff', borderColor: 'rgba(26,26,26,0.10)' }}
                >
                  <summary className="cursor-pointer list-none text-base font-semibold" style={{ fontFamily: DISPLAY }}>
                    {faq.question}
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed" style={{ color: 'rgba(26,26,26,0.65)' }}>{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── FOOTER ── */}
        <footer style={{ borderTop: '1px solid rgba(26,26,26,0.10)', background: '#fff' }}>
          <div className="mx-auto flex max-w-[1080px] flex-col items-center justify-between gap-5 px-6 py-8 text-sm sm:flex-row lg:px-8" style={{ color: 'rgba(26,26,26,0.55)' }}>
            <div className="flex items-center gap-2.5">
              <MeLogo size={28} />
              <span style={{ fontFamily: DISPLAY, fontWeight: 600, fontSize: 14 }}>
                Magic Engine
              </span>
              <span className="ml-2">© {new Date().getFullYear()} Magic Engine AI Technology Limited. All rights reserved.</span>
            </div>
            <nav className="flex flex-wrap justify-center gap-5 text-sm">
              <Link href="/about" className="hover:text-[#1A1A1A] transition-colors">About</Link>
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
