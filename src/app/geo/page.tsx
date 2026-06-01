import type { Metadata } from 'next'
import Link from 'next/link'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://magicengine.com.au'
const pageTitle = 'GEO / AI Visibility for AU/NZ Businesses'
const pageDescription =
  'Practical GEO and AI visibility support for Australia and New Zealand businesses. Clear answers, bilingual messaging, and local conversion paths.'

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  alternates: {
    canonical: '/geo',
  },
  openGraph: {
    title: pageTitle,
    description: pageDescription,
    url: '/geo',
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
    title: 'What GEO means',
    body: 'We use GEO to mean making your business easier for AI search and answer engines to understand, trust, and recommend.',
  },
  {
    title: 'Why it matters in AU/NZ',
    body: 'Local businesses need plain service language, local signals, and answers that both Google and AI tools can reuse.',
  },
  {
    title: 'How we keep it practical',
    body: 'We focus on the pages people already visit: homepage, service pages, training, contact, and the right supporting content.',
  },
]

const useCases = [
  'A business that wants better AI visibility for service keywords in Australia or New Zealand.',
  'A bilingual team that needs English and Chinese messaging to work together on the same public surface.',
  'A company that wants one clear next step after being discovered in AI search.',
]

const faqs = [
  {
    question: 'Is GEO different from SEO?',
    answer:
      'Yes, but they overlap. SEO helps pages rank in search engines; GEO helps AI systems understand the brand, service, and answer structure well enough to mention it.',
  },
  {
    question: 'Do you support English and Chinese audiences?',
    answer:
      'Yes. The public site is designed to speak to both English-speaking and Chinese-speaking audiences without splitting into a heavy multilingual system too early.',
  },
  {
    question: 'What should we start with?',
    answer:
      'Usually the homepage, the main service page, and a clear contact path. If training or ads are active, we connect those too.',
  },
]

const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      name: 'Magic Engine',
      url: siteUrl,
      areaServed: ['Australia', 'New Zealand'],
    },
    {
      '@type': 'Service',
      name: 'GEO and AI visibility',
      serviceType: 'AI visibility and GEO for AU/NZ businesses',
      provider: {
        '@type': 'Organization',
        name: 'Magic Engine',
      },
      areaServed: ['Australia', 'New Zealand'],
      description: pageDescription,
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

export default function GeoPage() {
  return (
    <main className="min-h-screen bg-[#f6f7f2] text-slate-950">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <section className="bg-slate-950 text-white">
        <header className="flex items-center justify-between px-5 py-5 sm:px-8">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-sm font-black text-slate-950">
              M
            </div>
            <span className="text-sm font-bold">Magic Engine</span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm font-semibold text-slate-300 md:flex">
            <Link href="/#product" className="hover:text-white">Product</Link>
            <Link href="/training" className="hover:text-white">Training</Link>
            <Link href="/contact" className="hover:text-white">Contact</Link>
          </nav>
          <Link href="/contact" className="rounded-lg bg-white px-4 py-2 text-sm font-bold text-slate-950">
            Start a consult
          </Link>
        </header>

        <div className="grid gap-10 px-5 pb-14 pt-16 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-start lg:pb-20">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">
              GEO / AI visibility for AU/NZ businesses
            </p>
            <h1 className="mt-4 max-w-3xl text-5xl font-black leading-[1.04] tracking-normal max-sm:text-4xl">
              Make your business easier for AI search to understand.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300">
              GEO is the practical layer that helps ChatGPT, Perplexity, Gemini, and search
              engines see your service, your location, and your answer structure clearly.
            </p>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-400">
              面向澳洲和新西兰企业的 AI 可见度优化。先把核心页面说清楚，再把 GEO 信号接上。
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/contact"
                className="flex h-12 items-center rounded-lg bg-white px-5 text-sm font-bold text-slate-950"
              >
                Book a consult
              </Link>
              <Link
                href="/discover"
                className="flex h-12 items-center rounded-lg border border-white/20 px-5 text-sm font-bold text-white"
              >
                Start with diagnosis
              </Link>
              <Link
                href="/geo/glossary"
                className="flex h-12 items-center rounded-lg border border-white/20 px-5 text-sm font-bold text-white"
              >
                GEO glossary
              </Link>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/10 p-6 shadow-2xl backdrop-blur-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200">
              What the page covers
            </p>
            <div className="mt-5 grid gap-3">
              {pillars.map(item => (
                <article key={item.title} className="rounded-lg border border-white/10 bg-white/[0.08] p-4">
                  <h2 className="text-lg font-black text-white">{item.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-300">{item.body}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-5 px-5 py-8 sm:px-8 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            Why GEO matters
          </p>
          <h2 className="mt-2 text-3xl font-black leading-tight">
            AI visibility works best when the page answers the right question fast.
          </h2>
        </div>
        <ul className="grid gap-3 sm:grid-cols-3">
          {useCases.map(item => (
            <li key={item} className="rounded-lg border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700">
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-5 px-5 pb-10 sm:px-8 lg:grid-cols-[1fr_380px]">
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
            Recommended entry point
          </p>
          <h2 className="mt-2 max-w-2xl text-3xl font-black leading-tight">
            Start with the homepage, then connect the GEO page, training, and contact flow.
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600">
            The goal is not more pages. The goal is clearer signal: one public definition, one local
            audience, one simple next step.
          </p>
          <div className="mt-6">
            <Link
              href="/geo/glossary"
              className="inline-flex rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-900"
            >
              Open the GEO glossary
            </Link>
          </div>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
            Practical outcome
          </p>
          <p className="mt-3 text-3xl font-black leading-tight text-emerald-950">
            Better AI answers, not just more traffic.
          </p>
          <p className="mt-3 text-sm leading-6 text-emerald-900">
            GEO should help the right people find the right page, understand the offer, and move to
            consult, training, or launch.
          </p>
        </div>
      </section>

      <section className="px-5 pb-12 sm:px-8">
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">FAQ</p>
          <h2 className="mt-2 text-3xl font-black leading-tight">Questions people ask about GEO.</h2>
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
    </main>
  )
}
