import Link from 'next/link'
import { MeMark, MeMarkDefs } from '@/components/ui/me-mark'
import RegisterForm from './register-form'

const benefits = [
  {
    icon: '🌐',
    label: 'A real website, free forever',
    body: 'A live page on your own subdomain, ready to share with customers — no credit card, no expiry.',
  },
  {
    icon: '🔧',
    label: 'Self-serve tools',
    body: 'Blog drafts, social posts, keyword reports and more — all at your own pace.',
  },
  {
    icon: '📈',
    label: 'Upgrade any time',
    body: 'Ready for fully managed execution? Talk to us to upgrade to the FDE programme.',
  },
]

interface Props {
  searchParams: {
    next?: string
  }
}

export default function RegisterPage({ searchParams }: Props) {
  const next = searchParams.next?.startsWith('/') && !searchParams.next.startsWith('//')
    ? searchParams.next
    : '/dashboard'
  const fromProspect = next === '/prospect'
  const signInHref = `/portal/login?next=${encodeURIComponent(next)}`

  return (
    <main className="flex min-h-screen">
      <MeMarkDefs />

      {/* ── Left dark panel ── */}
      <div className="hidden lg:flex lg:w-[44%] lg:flex-col lg:min-h-screen bg-me-black px-10 py-8">
        <Link
          href="https://magicengine.com.au"
          className="flex items-center gap-2.5 text-[#FBF8F3] no-underline"
        >
          <MeMark className="h-7 w-8 flex-none" />
          <span className="font-display text-sm font-bold">Magic Engine</span>
        </Link>

        <div className="mt-auto mb-10">
          <div className="mb-5 text-xs font-bold uppercase tracking-[0.16em] text-me-gold">
            {fromProspect ? 'Discovery to workspace' : 'Free to start'}
          </div>
          <h1 className="font-display text-[2.6rem] font-bold leading-[1.08] tracking-tight text-white">
            {fromProspect ? (
              <>Save your report.<br />Open your workspace.</>
            ) : (
              <>Your website.<br />Free forever.</>
            )}
          </h1>
          <p className="mt-4 text-sm leading-[1.75] text-white/60">
            {fromProspect
              ? 'We will carry your latest Discovery Report into a new workspace, then guide you through a short brand brief before you unlock the tools.'
              : 'A live website, a monthly traffic report, and inbox visibility — free, no card required. Upgrade any time to unlock the growth tools.'}
          </p>

          <div className="mt-8 flex flex-col gap-3">
            {benefits.map(item => (
              <div
                key={item.label}
                className="rounded-xl border border-white/[.08] bg-white/[.055] p-4"
              >
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="text-base">{item.icon}</span>
                  <p className="text-sm font-bold text-white">{item.label}</p>
                </div>
                <p className="text-xs leading-[1.65] text-white/50">{item.body}</p>
              </div>
            ))}
          </div>
        </div>

        <Link
          href="https://magicengine.com.au"
          className="text-xs text-white/35 no-underline transition-colors hover:text-white/55"
        >
          ← Back to magicengine.com.au
        </Link>
      </div>

      {/* ── Right paper panel ── */}
      <div className="flex flex-1 flex-col items-center justify-center min-h-screen bg-me-ivory px-6 py-12 font-sans">
        <div className="mb-8 flex items-center gap-2.5 lg:hidden">
          <MeMark className="h-6 w-7" />
          <span className="font-display text-sm font-bold text-me-charcoal">Magic Engine</span>
        </div>

        <div className="w-full max-w-[360px]">
          <div className="mb-7">
            <h2 className="font-display text-[2rem] font-bold leading-tight tracking-tight text-me-charcoal">
              {fromProspect ? 'Create your workspace.' : 'Create your account.'}
            </h2>
            <p className="mt-2 text-sm leading-6 text-me-charcoal/60">
              {fromProspect
                ? 'Verify your email, then we will take you from your Discovery Report into your workspace brief.'
                : 'Free to start — no credit card required.'}
            </p>
          </div>

          <RegisterForm next={next} fromProspect={fromProspect} />

          <p className="mt-7 text-center text-xs text-me-charcoal/45">
            Already have an account?{' '}
            <Link href={signInHref} className="font-semibold text-me-ochre no-underline hover:underline">
              Sign in →
            </Link>
          </p>
        </div>
      </div>
    </main>
  )
}
