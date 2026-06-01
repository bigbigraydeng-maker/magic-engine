import type { Metadata } from 'next'
import Link from 'next/link'
import TrainingLeadLink from './_components/TrainingLeadLink'

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://magicengine.com.au'
const pageTitle = 'AI Training for AU/NZ Teams'
const pageDescription =
  'Bilingual English and Chinese AI training for businesses in Australia and New Zealand. Practical workshops, rollout support, and team adoption help.'

export const metadata: Metadata = {
  title: pageTitle,
  description: pageDescription,
  alternates: {
    canonical: '/training',
  },
  openGraph: {
    title: pageTitle,
    description: pageDescription,
    url: '/training',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: pageTitle,
    description: pageDescription,
  },
}

const formats = [
  {
    title: 'Leadership workshop',
    body: 'A practical session for founders, managers, and marketing leads who want a clear AI adoption plan for their team.',
  },
  {
    title: 'Team enablement',
    body: 'Hands-on training for English and Chinese-speaking teams that need prompts, workflows, and rollout guardrails.',
  },
  {
    title: 'Rollout support',
    body: 'Post-workshop follow-up to help your team turn AI ideas into a repeatable process across search, content, and operations.',
  },
]

const proofPoints = [
  'AU/NZ-first training',
  'English and \u4e2d\u6587 delivery',
  'Workshop-first format',
  'Rollout support after the session',
]

const outcomes = [
  'What AI is worth using now',
  'How to make your team faster without adding chaos',
  'How to improve search and AI visibility while you adopt new tools',
  'How to communicate the change in English and \u4e2d\u6587',
]

const leadSteps = [
  {
    title: 'Share the basics',
    body: 'Tell us your team size, location, and whether the workshop should be delivered in English, \u4e2d\u6587, or both.',
  },
  {
    title: 'Pick the outcome',
    body: 'Adoption planning, prompt use, rollout guardrails, or a practical AI workshop for managers and teams.',
  },
  {
    title: 'Choose the path',
    body: 'Book a consult or email a short brief and we will scope the right session from there.',
  },
]

const faqs = [
  {
    question: 'Is the training for Australia and New Zealand only?',
    answer:
      'Yes. The page is written for AU/NZ businesses first, with local language, local context, and local conversion paths.',
  },
  {
    question: 'Can you run bilingual sessions?',
    answer:
      'Yes. We can support English and Chinese-speaking teams in the same training flow, so the rollout stays inclusive and practical.',
  },
  {
    question: 'Do I have to buy a full platform to start?',
    answer:
      'No. Start with a consult or workshop. We keep the entry point light and build from there only when it makes sense.',
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
      name: 'AI Training',
      serviceType: 'AI training for AU/NZ teams',
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

export default function TrainingPage() {
  return (
    <main className="min-h-screen bg-[#f6f7f2] text-slate-950">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <section className="overflow-hidden bg-slate-950 text-white">
        <header className="flex items-center justify-between px-5 py-5 sm:px-8">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-sm font-black text-slate-950">
              M
            </div>
            <span className="text-sm font-bold">Magic Engine</span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm font-semibold text-slate-300 md:flex">
            <Link href="/#product" className="hover:text-white">
              Product
            </Link>
            <Link href="/training" className="text-white">
              Training
            </Link>
            <Link href="/contact" className="hover:text-white">
              Contact
            </Link>
          </nav>
          <TrainingLeadLink
            href="/contact?source=training"
            ctaKey="header_consult"
            destination="contact"
            className="rounded-lg bg-white px-4 py-2 text-sm font-bold text-slate-950"
          >
            Book consult
          </TrainingLeadLink>
        </header>

        <div className="grid gap-10 px-5 pb-14 pt-16 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-start lg:pb-20">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">
              AI training for AU/NZ businesses
            </p>
            <h1 className="mt-4 max-w-3xl text-5xl font-black leading-[1.04] tracking-normal max-sm:text-4xl">
              Practical AI training for teams in Australia and New Zealand.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300">
              We keep it simple: one clear workshop, one local rollout plan, and one bilingual path
              for English and Chinese-speaking teams.
            </p>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-400">
              {'\u9762\u5411\u6fb3\u6d32\u548c\u65b0\u897f\u5170\u4f01\u4e1a\u7684 AI \u57f9\u8bad\u3002\u5148\u8ba9\u56e2\u961f\u7528\u8d77\u6765\uff0c\u518d\u628a\u6d41\u7a0b\u505a\u7a33\u3002'}
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <TrainingLeadLink
                href="/contact?source=training"
                ctaKey="hero_consult"
                destination="contact"
                className="flex h-12 items-center rounded-lg bg-white px-5 text-sm font-bold text-slate-950"
              >
                Book a training consult
              </TrainingLeadLink>
              <Link
                href="/discover"
                className="flex h-12 items-center rounded-lg border border-white/20 px-5 text-sm font-bold text-white"
              >
                Start with a diagnosis
              </Link>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/10 p-6 shadow-2xl backdrop-blur-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200">
              What the workshop covers
            </p>
            <div className="mt-5 grid gap-3">
              {formats.map(format => (
                <article key={format.title} className="rounded-lg border border-white/10 bg-white/[0.08] p-4">
                  <h2 className="text-lg font-black text-white">{format.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-300">{format.body}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="-mt-6 px-5 sm:px-8">
        <div className="mx-auto grid max-w-6xl gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-4">
          {proofPoints.map(point => (
            <div
              key={point}
              className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700"
            >
              <span className="h-2.5 w-2.5 rounded-full bg-cyan-500" />
              <span>{point}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-5 px-5 py-8 sm:px-8 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            Why training matters
          </p>
          <h2 className="mt-2 text-3xl font-black leading-tight">
            AI adoption works better when people know what to do next.
          </h2>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {outcomes.map(item => (
            <li
              key={item}
              className="rounded-lg border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-700"
            >
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-5 px-5 pb-10 sm:px-8 lg:grid-cols-[1fr_380px]">
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
            Bilingual support
          </p>
          <h2 className="mt-2 max-w-2xl text-3xl font-black leading-tight">
            English and \u4e2d\u6587 support, without splitting the experience too early.
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600">
            The training page is designed for mixed audiences: local Chinese-speaking teams,
            English-speaking teams, and businesses that need everyone aligned on the same rollout
            plan.
          </p>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
            Local CTA
          </p>
          <p className="mt-3 text-3xl font-black leading-tight text-emerald-950">
            Book a consult, then we scope the right workshop.
          </p>
          <p className="mt-3 text-sm leading-6 text-emerald-900">
            This keeps the entry point light and works well for AU/NZ businesses that want to
            start with a practical conversation before committing to a bigger training rollout.
          </p>
        </div>
      </section>

      <section className="px-5 pb-12 sm:px-8">
        <div className="grid gap-6 rounded-2xl border border-slate-950 bg-slate-950 p-6 text-white lg:grid-cols-[1fr_0.95fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">
              Lead path
            </p>
            <h2 className="mt-2 text-3xl font-black leading-tight">
              Make it easy to brief the right workshop.
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300">
              If you already know the team, the language mix, and the outcome you want, we can
              move straight to a consult. If not, we keep the first step light and help you scope
              it quickly.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <TrainingLeadLink
                href="/contact?source=training"
                ctaKey="lead_consult"
                destination="contact"
                className="flex h-11 items-center rounded-lg bg-white px-4 text-sm font-bold text-slate-950"
              >
                Book a consult
              </TrainingLeadLink>
              <TrainingLeadLink
                href="mailto:raydeng@magicengine.com.au?subject=Training%20enquiry%20-%20Magic%20Engine&body=Hi%20Magic%20Engine%2C%0A%0AWe%20would%20like%20to%20talk%20about%20AI%20training%20for%20our%20team.%20Please%20share%20your%20recommended%20next%20step.%0A%0ATeam%20size%3A%0ALanguage%20mix%3A%0AOutcome%3A%0ATiming%3A%0A"
                ctaKey="lead_email"
                destination="email"
                className="flex h-11 items-center rounded-lg border border-white/20 px-4 text-sm font-bold text-white"
              >
                Email training brief
              </TrainingLeadLink>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200">
              What to include
            </p>
            <ol className="mt-4 grid gap-3">
              {leadSteps.map(step => (
                <li key={step.title} className="rounded-lg border border-white/10 bg-white/[0.06] p-4">
                  <h3 className="text-base font-bold text-white">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-300">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className="px-5 pb-12 sm:px-8">
        <div className="rounded-lg border border-slate-200 bg-white p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">FAQ</p>
          <h2 className="mt-2 text-3xl font-black leading-tight">A few questions we expect.</h2>
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
