import type { Metadata } from 'next'
import Link from 'next/link'
import ContactForm from './_components/ContactForm'

export const metadata: Metadata = {
  title: 'Contact Us — Magic Engine',
  description: 'Get in touch with the Magic Engine team. We help AU/NZ marketing agencies and businesses grow through AI-powered execution.',
}

export default function ContactPage() {
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
          <Link href="/#product" className="hover:text-white">Product</Link>
          <Link href="/about" className="hover:text-white">About</Link>
          <Link href="/portal/login" className="hover:text-white">Portal</Link>
        </nav>
        <Link
          href="/discover"
          className="rounded-lg bg-white px-4 py-2 text-sm font-bold text-slate-950"
        >
          Start diagnosis
        </Link>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-16">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">
          Get in touch
        </p>
        <h1 className="mt-4 text-5xl font-black leading-tight">Contact us</h1>
        <p className="mt-5 text-base leading-7 text-slate-600">
          Interested in Magic Engine for your agency or business? Fill in the form and we&rsquo;ll
          get back to you within one business day.
        </p>

        <div className="mt-10 rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
          <ContactForm />
        </div>

        <div className="mt-8 flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100">
            <svg className="h-5 w-5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">Email directly</p>
            <a
              href="mailto:raydeng@magicengine.com.au"
              className="mt-1 text-sm text-indigo-600 underline"
            >
              raydeng@magicengine.com.au
            </a>
            <p className="mt-1 text-xs text-slate-500">
              98 Beatrice Terrace, Ascot, Brisbane, QLD, Australia
            </p>
          </div>
        </div>
      </main>

      <footer className="mt-8 border-t border-slate-200 bg-white px-5 py-8 sm:px-8">
        <div className="mx-auto flex max-w-2xl flex-col items-center justify-between gap-4 text-sm text-slate-500 sm:flex-row">
          <p>© {new Date().getFullYear()} Magic Lab. All rights reserved.</p>
          <nav className="flex gap-6">
            <Link href="/about" className="hover:text-slate-950">About</Link>
            <Link href="/privacy" className="hover:text-slate-950">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-slate-950">Terms of Service</Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
