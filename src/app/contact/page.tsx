import type { Metadata } from 'next'
import Link from 'next/link'
import ContactForm from './_components/ContactForm'

export const metadata: Metadata = {
  title: 'Contact Us',
  description: 'Get in touch with the Magic Engine team. We help AU/NZ SMEs and growth teams grow through AI-powered execution.',
}

type ContactPageProps = {
  searchParams?: {
    source?: string
  }
}

function MeLogo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="meGradContact" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
          <stop stopColor="#EBCB8B" />
          <stop offset="0.55" stopColor="#C4912E" />
          <stop offset="1" stopColor="#A6781F" />
        </linearGradient>
        <radialGradient id="meNodeContact" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.45" stopColor="#FBEFD2" />
          <stop offset="1" stopColor="#EBCB8B" />
        </radialGradient>
      </defs>
      <rect width="100" height="100" rx="22" fill="#0D0D0D" />
      <g stroke="url(#meGradContact)" fill="none" strokeLinecap="round" strokeWidth="5.5">
        <path d="M14,24 C38,30 56,44 78,52" />
        <path d="M14,36 C38,40 56,46 78,52" />
        <path d="M14,48 C40,50 56,50 78,52" />
        <path d="M14,60 C40,58 56,56 78,52" />
        <path d="M14,72 C38,66 56,60 78,52" />
      </g>
      <g fill="url(#meGradContact)">
        <circle cx="14" cy="24" r="3.5" />
        <circle cx="14" cy="36" r="3.5" />
        <circle cx="14" cy="48" r="3.5" />
        <circle cx="14" cy="60" r="3.5" />
        <circle cx="14" cy="72" r="3.5" />
      </g>
      <rect x="69" y="41" width="20" height="20" rx="5" fill="url(#meNodeContact)" />
    </svg>
  )
}

export default function ContactPage({ searchParams }: ContactPageProps) {
  const source = searchParams?.source
  const isTrainingLead = source === 'training'
  const isAdsLead = source === 'ads'
  const defaultMessage = isTrainingLead
    ? 'We are interested in AI training for our team. Please tell us the best next step, plus what details you need from us.'
    : isAdsLead
      ? 'We are planning paid media for our AU/NZ business. Please tell us the best next step, what launch shape you recommend, and what details you need from us.'
    : ''

  return (
    <div className="min-h-screen" style={{ background: '#FBF8F3', color: '#1A1A1A' }}>

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
            <span style={{ fontFamily: 'var(--font-display, "Space Grotesk"), sans-serif', fontWeight: 700, fontSize: 17, letterSpacing: '-0.02em' }}>
              Magic Engine
            </span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm font-medium lg:flex" style={{ color: 'rgba(26,26,26,0.65)' }}>
            <Link href="/#flywheel" className="hover:text-[#1A1A1A] transition-colors">How it works</Link>
            <Link href="/#modules" className="hover:text-[#1A1A1A] transition-colors">Product</Link>
            <Link href="/about" className="hover:text-[#1A1A1A] transition-colors">About</Link>
            <Link href="/portal/login" className="hover:text-[#1A1A1A] transition-colors">Portal</Link>
          </nav>
          <Link
            href="/discover"
            className="rounded-xl px-4 py-2 text-sm font-semibold transition-all hover:-translate-y-px"
            style={{
              background: 'linear-gradient(135deg, #EBCB8B 0%, #C4912E 55%, #A6781F 100%)',
              color: '#2A2008',
              boxShadow: '0 8px 24px rgba(196,145,46,.20)',
            }}
          >
            Start diagnosis
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-16">
        <div className="flex items-center gap-3 mb-4">
          <span className="h-px w-8 opacity-50" style={{ background: '#C4912E' }} />
          <span className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: '#C4912E' }}>
            Get in touch
          </span>
        </div>
        <h1
          className="text-5xl font-semibold leading-tight tracking-tight"
          style={{ fontFamily: 'var(--font-display, "Space Grotesk"), sans-serif', letterSpacing: '-0.02em' }}
        >
          Contact us
        </h1>
        <p className="mt-5 text-base leading-7" style={{ color: 'rgba(26,26,26,0.65)' }}>
          Interested in Magic Engine for your SME, in-house team, or growth business? Fill in the
          form and we&rsquo;ll get back to you within one business day.
        </p>

        {(isTrainingLead || isAdsLead) && (
          <div
            className="mt-8 rounded-2xl p-6"
            style={{ border: '1px solid rgba(196,145,46,0.30)', background: 'rgba(196,145,46,0.06)' }}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: '#C4912E' }}>
              {isTrainingLead ? 'Training enquiry' : 'Ads launch enquiry'}
            </p>
            <p className="mt-2 text-sm leading-6" style={{ color: 'rgba(26,26,26,0.72)' }}>
              {isTrainingLead
                ? 'You came from the training page. Tell us your team size, language mix, and what workshop outcome you want, and we will scope the right session from there.'
                : 'You came from the ads launch path. Tell us your target market, monthly budget, and launch timing, and we will scope the first campaign from there.'}
            </p>
            <p className="mt-3 text-sm leading-6" style={{ color: 'rgba(26,26,26,0.65)' }}>
              After you send it, we will reply with a clear next step instead of dumping you into
              a generic sales flow.
            </p>
          </div>
        )}

        <div
          className="mt-10 rounded-2xl p-6 sm:p-8"
          style={{ background: '#fff', border: '1px solid rgba(26,26,26,0.10)', boxShadow: '0 1px 2px rgba(26,26,26,.04), 0 8px 28px rgba(26,26,26,.06)' }}
        >
          <ContactForm source={source} defaultMessage={defaultMessage} />
        </div>

        <div
          className="mt-5 flex items-start gap-4 rounded-2xl p-6"
          style={{ background: '#fff', border: '1px solid rgba(26,26,26,0.10)' }}
        >
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
            style={{ background: '#FBF8F3', border: '1px solid rgba(26,26,26,0.10)' }}
          >
            <svg className="h-5 w-5" style={{ color: 'rgba(26,26,26,0.55)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold">Email directly</p>
            <a
              href="mailto:raydeng@magicengine.com.au"
              className="mt-1 block text-sm transition-colors hover:opacity-80"
              style={{ color: '#C4912E' }}
            >
              raydeng@magicengine.com.au
            </a>
            <p className="mt-1 text-xs" style={{ color: 'rgba(26,26,26,0.50)' }}>
              98 Beatrice Terrace, Ascot, Brisbane, QLD, Australia
            </p>
          </div>
        </div>
      </main>

      {/* ── FOOTER ── */}
      <footer style={{ borderTop: '1px solid rgba(26,26,26,0.10)', background: '#fff' }}>
        <div
          className="mx-auto flex max-w-2xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm sm:flex-row"
          style={{ color: 'rgba(26,26,26,0.55)' }}
        >
          <p>© {new Date().getFullYear()} Magic Lab. All rights reserved.</p>
          <nav className="flex gap-5">
            <Link href="/about" className="hover:text-[#1A1A1A] transition-colors">About</Link>
            <Link href="/privacy" className="hover:text-[#1A1A1A] transition-colors">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-[#1A1A1A] transition-colors">Terms of Service</Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
