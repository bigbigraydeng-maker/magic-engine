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

const pillars = [
  {
    n: '01',
    title: 'Diagnose',
    body: 'Score search, AI visibility, social, ads, reputation, and competitor signals for AU/NZ businesses without exposing supplier names.',
  },
  {
    n: '02',
    title: 'Execute',
    body: 'Turn priority findings into content, website fixes, bilingual updates, training tasks, social assets, and ad decisions customers can approve.',
  },
  {
    n: '03',
    title: 'Prove',
    body: 'Bring outcomes back into the same portal customers use for approvals, reports, and next-step decisions.',
  },
]

const audienceCards = [
  {
    title: 'AU/NZ businesses',
    body: 'Built for companies operating in Australia and New Zealand that want practical AI adoption, stronger visibility, and clearer execution.',
  },
  {
    title: 'Chinese and English teams',
    body: 'Bilingual English/中文 messaging helps local Chinese-speaking and English-speaking audiences understand the offer without extra friction.',
  },
  {
    title: 'Launch-ready rollout',
    body: 'The site is already set up to capture consults, workshop enquiries, and paid media launch discussions for AU/NZ campaigns.',
  },
]

const visibilitySignals = [
  'Clear service language that says what we do, who it is for, and where we work.',
  'Structured data, canonical URLs, and crawl hints so search engines can read the site cleanly.',
  'FAQ-style answers that AI search and answer engines can reuse directly.',
  'One public surface that supports English and Chinese without splitting the site too early.',
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
]

const outcomes = [
  { label: 'Visibility actions shipped', value: '15' },
  { label: 'Approval items waiting', value: '3' },
  { label: 'Active execution loops', value: '4' },
]

const loops = [
  { label: 'Diagnose', progress: 100 },
  { label: 'Prioritise', progress: 86 },
  { label: 'Execute', progress: 64 },
  { label: 'Measure', progress: 38 },
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

function LogoMark() {
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-sm font-black text-slate-950">
      M
    </div>
  )
}

function ProductPreview() {
  return (
    <div className="w-[680px] rounded-xl border border-white/10 bg-white/10 p-4 shadow-2xl backdrop-blur-sm">
      <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-950 text-sm font-black text-white">
            M
          </div>
          <div>
            <p className="text-sm font-bold text-white">CTS Tours NZ</p>
            <p className="text-[11px] text-slate-300">Bilingual client operating cockpit</p>
          </div>
        </div>
        <span className="rounded-lg bg-emerald-300/15 px-3 py-1.5 text-xs font-bold text-emerald-200">
          +23% AI visibility
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {outcomes.map(item => (
          <div key={item.label} className="rounded-lg border border-white/10 bg-white/[0.08] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
              {item.label}
            </p>
            <p className="mt-6 text-3xl font-black text-white">{item.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.08] p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-bold text-white">Execution flywheel</p>
          <p className="text-xs font-semibold text-cyan-200">4 active loops</p>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          {loops.map(item => (
            <div key={item.label} className="rounded-lg bg-slate-950/60 p-3">
              <p className="mb-6 text-xs font-bold text-white">{item.label}</p>
              <div className="h-1.5 rounded-full bg-white/10">
                <div className="h-1.5 rounded-full bg-cyan-300" style={{ width: `${item.progress}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function MobileProductPreview() {
  return (
    <div className="mt-10 rounded-xl border border-white/10 bg-white/[0.08] p-4 md:hidden">
      <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-4">
        <div>
          <p className="text-sm font-bold text-white">Client cockpit</p>
          <p className="text-[11px] text-slate-300">Outcome view</p>
        </div>
        <span className="rounded-lg bg-emerald-300/15 px-3 py-1.5 text-xs font-bold text-emerald-200">
          +23%
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {outcomes.map(item => (
          <div key={item.label} className="rounded-lg bg-slate-950/60 p-3">
            <p className="text-2xl font-black text-white">{item.value}</p>
            <p className="mt-1 text-[10px] leading-4 text-slate-400">{item.label}</p>
          </div>
        ))}
      </div>
    </div>
  )
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
      <main className="min-h-screen bg-[#f6f7f2] text-slate-950">
        <section className="relative min-h-[720px] overflow-hidden bg-slate-950 text-white">
          <div className="absolute inset-0 hidden opacity-70 md:block">
            <div className="absolute left-[54%] top-20">
              <ProductPreview />
            </div>
            <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/90 to-slate-950/20" />
          </div>

          <header className="relative z-10 flex items-center justify-between px-5 py-5 sm:px-8">
            <Link href="/" className="flex items-center gap-3">
              <LogoMark />
              <span className="text-sm font-bold">Magic Engine</span>
            </Link>
            <nav className="hidden items-center gap-6 text-sm font-semibold text-slate-300 md:flex">
              <a href="#product">Product</a>
              <a href="#visibility">AI visibility</a>
              <a href="#faq">FAQ</a>
              <Link href="/geo">GEO</Link>
              <Link href="/training">Training</Link>
              <Link href="/about">About</Link>
              <Link href="/portal/login">Portal</Link>
            </nav>
            <Link href="/contact" className="rounded-lg bg-white px-4 py-2 text-sm font-bold text-slate-950">
              Contact us
            </Link>
          </header>

          <div className="relative z-10 px-5 pb-14 pt-20 sm:px-8 sm:pt-24">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">
              AI upgrade + training for AU/NZ businesses
            </p>
            <h1 className="mt-4 max-w-3xl text-5xl font-black leading-[1.02] tracking-normal sm:text-6xl">
              AI upgrades for AU/NZ businesses
            </h1>
            <p className="mt-5 max-w-2xl text-2xl font-black leading-tight text-slate-100 sm:text-3xl">
              Bilingual English/中文 support for Chinese and English-speaking teams.
            </p>
            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300">
              We help businesses in Australia and New Zealand use AI to improve search visibility,
              content operations, website clarity, and team capability without overcomplicating the
              rollout.
            </p>
            <p className="mt-4 max-w-xl text-sm leading-6 text-slate-400">
              面向澳洲和新西兰企业的 AI 升级与培训。先把信息说清楚，再把执行做起来。
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/discover"
                className="flex h-12 items-center rounded-lg bg-white px-5 text-sm font-bold text-slate-950"
              >
                Get free diagnosis
              </Link>
              <Link
                href="/training"
                className="flex h-12 items-center rounded-lg border border-white/20 px-5 text-sm font-bold text-white"
              >
                Explore training
              </Link>
              <Link
                href="/geo"
                className="flex h-12 items-center rounded-lg border border-cyan-300/40 px-5 text-sm font-bold text-cyan-100"
              >
                Explore GEO
              </Link>
              <Link
                href="/contact?source=ads"
                className="flex h-12 items-center rounded-lg border border-cyan-300/40 px-5 text-sm font-bold text-cyan-100"
              >
                Start ads launch
              </Link>
            </div>
            <p className="mt-4 text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
              Built for bilingual teams, local search, and AI visibility.
            </p>
            <MobileProductPreview />
          </div>
        </section>

        <section id="product" className="grid gap-5 px-5 py-8 sm:px-8 lg:grid-cols-3">
          {pillars.map(item => (
            <article key={item.title} className="rounded-lg border border-slate-200 bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{item.n}</p>
              <h2 className="mt-2 text-2xl font-black">{item.title}</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">{item.body}</p>
            </article>
          ))}
        </section>

        <section id="audience" className="grid gap-5 px-5 pb-10 sm:px-8 lg:grid-cols-3">
          {audienceCards.map(card => (
            <article key={card.title} className="rounded-lg border border-slate-200 bg-white p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-700">
                Who it is for
              </p>
              <h2 className="mt-2 text-2xl font-black">{card.title}</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">{card.body}</p>
            </article>
          ))}
        </section>

        <section id="visibility" className="grid gap-5 px-5 pb-10 sm:px-8 lg:grid-cols-[1fr_380px]">
          <div className="rounded-lg border border-slate-200 bg-white p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
              AI visibility
            </p>
            <h2 className="mt-2 max-w-2xl text-3xl font-black leading-tight">
              Built for AI visibility, not just rankings.
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600">
              Search engines and answer engines need clear entities, plain answers, and a clean
              structure. This homepage now does that with direct service language, bilingual
              messaging, structured data, and a simple FAQ.
            </p>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600">
              If you want the GEO layer in one place, start with the{' '}
              <Link href="/geo" className="font-bold underline underline-offset-4">
                GEO page
              </Link>{' '}
              and we can tune from there.
            </p>
            <ul className="mt-5 grid gap-3 text-sm leading-6 text-slate-700">
              {visibilitySignals.map(signal => (
                <li key={signal} className="flex gap-3">
                  <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-cyan-500" />
                  <span>{signal}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
              Training rollout
            </p>
            <p className="mt-3 text-3xl font-black leading-tight text-emerald-950">
              Training content comes next.
            </p>
            <p className="mt-3 text-sm leading-6 text-emerald-900">
              We are keeping the scope small for now: a stronger homepage, clear contact path, and
              SEO signals that help the public site rank while the training page is live.
            </p>
            <p className="mt-4 text-sm leading-6 text-emerald-900">
              If you want bilingual workshops, AI adoption planning, or rollout support, start with
              the <Link href="/training" className="font-bold underline underline-offset-4">training page</Link> or a consult and we can scope it from there.
            </p>
          </div>
        </section>

        <section id="outcomes" className="grid gap-5 px-5 pb-10 sm:px-8 lg:grid-cols-[1fr_380px]">
          <div className="rounded-lg border border-slate-200 bg-white p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
              Product promise
            </p>
            <h2 className="mt-2 max-w-2xl text-3xl font-black leading-tight">
              Not another dashboard. A managed execution system.
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600">
              Magic Engine starts with diagnosis, but the product is the execution loop after that:
              prioritised work, customer approvals, shipped actions, and monthly proof.
            </p>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
              Customer experience
            </p>
            <p className="mt-3 text-3xl font-black leading-tight text-emerald-950">
              Website promise, portal proof.
            </p>
            <p className="mt-3 text-sm leading-6 text-emerald-900">
              Prospects see the operating model before they buy. Clients later see the same
              language: opportunity, execution, approval, result.
            </p>
          </div>
        </section>

        <section id="faq" className="px-5 pb-12 sm:px-8">
          <div className="rounded-lg border border-slate-200 bg-white p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">FAQ</p>
            <h2 className="mt-2 text-3xl font-black leading-tight">Questions people ask before they reach out.</h2>
            <div className="mt-6 grid gap-4">
              {faqs.map(faq => (
                <details key={faq.question} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <summary className="cursor-pointer list-none text-base font-bold text-slate-900">
                    {faq.question}
                  </summary>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <footer className="border-t border-slate-200 bg-white px-5 py-8 sm:px-8">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-sm text-slate-500 sm:flex-row">
            <p>© {new Date().getFullYear()} Magic Lab. All rights reserved.</p>
            <nav className="flex flex-wrap justify-center gap-6">
              <Link href="/about" className="hover:text-slate-950">
                About
              </Link>
              <Link href="/privacy" className="hover:text-slate-950">
                Privacy Policy
              </Link>
              <Link href="/terms" className="hover:text-slate-950">
                Terms of Service
              </Link>
              <Link href="/contact" className="hover:text-slate-950">
                Contact
              </Link>
              <Link href="/training" className="hover:text-slate-950">
                Training
              </Link>
              <Link href="/portal/login" className="hover:text-slate-950">
                Portal
              </Link>
            </nav>
          </div>
        </footer>
      </main>
    </>
  )
}
