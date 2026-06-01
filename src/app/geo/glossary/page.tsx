import type { Metadata } from 'next'
import Link from 'next/link'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://magicengine.com.au'
const pageTitle = 'GEO Glossary for AU/NZ Teams'
const pageDescription =
  'A small GEO glossary for Australia and New Zealand businesses that need a shared language for AI visibility, answer engines, and local search.'

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  alternates: {
    canonical: '/geo/glossary',
  },
  openGraph: {
    title: pageTitle,
    description: pageDescription,
    url: '/geo/glossary',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: pageTitle,
    description: pageDescription,
  },
}

const terms = [
  {
    term: 'GEO',
    definition:
      'The layer of work that helps AI systems understand your brand, service, and answer structure clearly enough to mention it.',
  },
  {
    term: 'AI visibility',
    definition:
      'How easy it is for ChatGPT, Perplexity, Gemini, and search engines to read, trust, and reuse your public content.',
  },
  {
    term: 'Answer engine',
    definition:
      'A tool that returns a direct answer instead of a long list of links. GEO helps your page become easier to quote.',
  },
  {
    term: 'Local signal',
    definition:
      'A clear cue that says where you work, who you serve, and which market matters most, such as Australia or New Zealand.',
  },
  {
    term: 'Bilingual delivery',
    definition:
      'One public surface that can speak to both English and Chinese audiences without needing a heavy split into separate sites too early.',
  },
]

const glossaryStructuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      name: 'Magic Engine',
      url: siteUrl,
      areaServed: ['Australia', 'New Zealand'],
    },
    {
      '@type': 'DefinedTermSet',
      name: pageTitle,
      description: pageDescription,
      hasDefinedTerm: terms.map(item => ({
        '@type': 'DefinedTerm',
        name: item.term,
        description: item.definition,
      })),
    },
    {
      '@type': 'WebPage',
      name: pageTitle,
      description: pageDescription,
      url: '/geo/glossary',
    },
  ],
}

export default function GeoGlossaryPage() {
  return (
    <main className="min-h-screen bg-[#f6f7f2] text-slate-950">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(glossaryStructuredData) }}
      />

      <section className="bg-slate-950 text-white">
        <header className="flex items-center justify-between px-5 py-5 sm:px-8">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-sm font-black text-slate-950">
              M
            </div>
            <span className="text-sm font-bold">Magic Engine</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/geo" className="rounded-lg border border-white/15 px-4 py-2 text-sm font-bold text-white">
              Back to GEO
            </Link>
            <Link href="/contact" className="rounded-lg bg-white px-4 py-2 text-sm font-bold text-slate-950">
              Book a consult
            </Link>
          </div>
        </header>

        <div className="px-5 pb-14 pt-16 sm:px-8 lg:pb-20">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">
            GEO glossary / AI visibility support
          </p>
          <h1 className="mt-4 max-w-3xl text-5xl font-black leading-[1.04] tracking-normal max-sm:text-4xl">
            A small shared vocabulary for GEO work.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300">
            When teams use the same words for GEO, AI visibility, and local signals, content,
            training, and launch work becomes much easier to keep aligned.
          </p>
        </div>
      </section>

      <section className="px-5 py-10 sm:px-8">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {terms.map(item => (
            <article key={item.term} className="rounded-lg border border-slate-200 bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                Term
              </p>
              <h2 className="mt-2 text-2xl font-black text-slate-950">{item.term}</h2>
              <p className="mt-3 text-sm leading-6 text-slate-700">{item.definition}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-5 px-5 pb-12 sm:px-8 lg:grid-cols-[1fr_400px]">
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
            Why this page exists
          </p>
          <h2 className="mt-2 text-3xl font-black leading-tight">
            One glossary helps both Google and AI systems see the same intent.
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600">
            This is intentionally small. We are not building a content hub yet. We just want one
            supporting page that gives the GEO surface a stronger search context without making the
            public IA heavy.
          </p>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
            Next step
          </p>
          <p className="mt-3 text-2xl font-black leading-tight text-emerald-950">
            Use the glossary when you write, train, or launch.
          </p>
          <p className="mt-3 text-sm leading-6 text-emerald-900">
            The GEO page, homepage, and contact flow can now point to the same shared language.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/geo" className="rounded-lg bg-emerald-950 px-4 py-2 text-sm font-bold text-white">
              Back to GEO
            </Link>
            <Link href="/contact" className="rounded-lg border border-emerald-300 px-4 py-2 text-sm font-bold text-emerald-950">
              Contact us
            </Link>
          </div>
        </div>
      </section>
    </main>
  )
}
