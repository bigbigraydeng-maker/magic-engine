import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'About Us — Magic Engine',
  description:
    'Magic Engine is an AI-powered marketing execution platform for AU/NZ growth teams. Learn about our company, mission, and the platform we build.',
}

const features = [
  {
    title: 'SEO & AI Visibility',
    body: 'Keyword intelligence, content generation, and AI search (GEO) optimisation — with dual-signal blog posts designed to rank on both Google and AI assistants like ChatGPT and Perplexity.',
  },
  {
    title: 'Social Media',
    body: 'Brand brief management, campaign batch generation, visual asset creation, and multi-platform publishing — all within a single client workspace.',
  },
  {
    title: 'Advertising Intelligence',
    body: 'Connect Google Ads and Meta Ads accounts to diagnose campaign performance, surface AI-powered recommendations, and execute approved optimisations — including pausing underperforming ads, adjusting bids, and managing budgets within client-approved guardrails.',
  },
  {
    title: 'Insight Reports',
    body: 'Automated monthly performance reports across search, AI visibility, social, and advertising — delivered to clients in a branded portal.',
  },
]

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-[#f6f7f2] text-slate-950">
      <header className="flex items-center justify-between bg-slate-950 px-5 py-5 sm:px-8">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-sm font-black text-slate-950">
            M
          </div>
          <span className="text-sm font-bold text-white">Magic Engine</span>
        </Link>
        <nav className="hidden items-center gap-6 text-sm font-semibold text-slate-300 md:flex">
          <Link href="/#product" className="hover:text-white">
            Product
          </Link>
          <Link href="/about" className="text-white">
            About
          </Link>
          <Link href="/portal/login" className="hover:text-white">
            Portal
          </Link>
        </nav>
        <Link
          href="/discover"
          className="rounded-lg bg-white px-4 py-2 text-sm font-bold text-slate-950"
        >
          Start diagnosis
        </Link>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-16">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">
          About Magic Engine
        </p>
        <h1 className="mt-4 text-5xl font-black leading-tight">
          The execution engine for AU/NZ growth teams.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
          Magic Engine is an AI-powered marketing platform built for marketing agencies and
          in-house growth teams in Australia and New Zealand. We turn diagnostic findings into
          shipped execution — across search, AI visibility, social media, and paid advertising.
        </p>

        <section className="mt-16">
          <h2 className="text-2xl font-black">Our mission</h2>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
            Most marketing dashboards stop at data. Magic Engine goes further: from diagnosis to
            prioritised action, from client approval to shipped results, from execution to
            measurable proof. We close the loop between insight and outcome — so marketing teams
            can show clients not just what happened, but what they did about it.
          </p>
        </section>

        <section className="mt-16">
          <h2 className="text-2xl font-black">Platform capabilities</h2>
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            {features.map(f => (
              <div
                key={f.title}
                className="rounded-lg border border-slate-200 bg-white p-6"
              >
                <h3 className="text-lg font-bold">{f.title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-16">
          <h2 className="text-2xl font-black">Google Ads integration</h2>
          <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
            <p className="text-sm leading-7 text-slate-600">
              Magic Engine integrates with the Google Ads API to provide two core capabilities for
              agencies managing Google Ads on behalf of their clients:
            </p>
            <ol className="mt-4 list-decimal pl-5 text-sm leading-8 text-slate-600">
              <li>
                <strong>Campaign performance reporting</strong> — the API reads campaign-level and
                ad-group-level data (impressions, clicks, spend, ROAS, conversion rates) from
                connected accounts. This feeds our AI Diagnostic Engine, which identifies
                underperforming campaigns, budget inefficiencies, and keyword opportunities, then
                surfaces prioritised recommendations to the agency.
              </li>
              <li>
                <strong>Approved campaign execution</strong> — after presenting findings to clients
                for explicit approval, Magic Engine executes authorised optimisations via the
                API: pausing underperforming ad sets, adjusting keyword bids, adding negative
                keywords, and modifying daily budgets within client-approved guardrails (±20%
                safety limits enforced server-side). All changes are logged in a tamper-evident
                audit trail.
              </li>
            </ol>
            <p className="mt-4 text-sm leading-7 text-slate-600">
              Access is granted through standard Google OAuth 2.0 by the agency managing the
              account. Magic Engine never accesses accounts without explicit authorisation, and
              all API usage complies with the{' '}
              <a
                href="https://developers.google.com/google-ads/api/docs/best-practices/overview"
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-600 underline"
              >
                Google Ads API Terms of Service
              </a>
              .
            </p>
          </div>
        </section>

        <section className="mt-16">
          <h2 className="text-2xl font-black">Company information</h2>
          <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
            <address className="not-italic text-sm leading-8 text-slate-700">
              <p>
                <strong>Magic Engine AI Technology Limited</strong> — operator of Magic Engine
              </p>
              <p>New Zealand</p>
              <p>
                Website:{' '}
                <a
                  href="https://magicengine.com.au"
                  className="text-indigo-600 underline"
                >
                  magicengine.com.au
                </a>
              </p>
              <p>
                Email:{' '}
                <a
                  href="mailto:raydeng@magicengine.com.au"
                  className="text-indigo-600 underline"
                >
                  raydeng@magicengine.com.au
                </a>
              </p>
            </address>
          </div>
        </section>
      </main>

      <footer className="mt-16 border-t border-slate-200 bg-white px-5 py-8 sm:px-8">
        <div className="mx-auto flex max-w-4xl flex-col items-center justify-between gap-4 text-sm text-slate-500 sm:flex-row">
          <p>© {new Date().getFullYear()} Magic Engine AI Technology Limited. All rights reserved.</p>
          <nav className="flex gap-6">
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
          </nav>
        </div>
      </footer>
    </div>
  )
}
