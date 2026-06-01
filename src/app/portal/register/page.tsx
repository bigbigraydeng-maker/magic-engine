import Link from 'next/link'
import { MeMark, MeMarkDefs } from '@/components/ui/me-mark'
import RegisterForm from './register-form'

const benefits = [
  {
    icon: '🎯',
    label: 'Free tokens included',
    body: 'Start with 500 MTC — enough to generate blog posts, social content, and SEO reports.',
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

export default function RegisterPage() {
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
            Free to start
          </div>
          <h1 className="font-display text-[2.6rem] font-bold leading-[1.08] tracking-tight text-white">
            500 MTC.<br />On us.
          </h1>
          <p className="mt-4 text-sm leading-[1.75] text-white/60">
            Magic Token Coins power every content, SEO, and AI visibility action on the platform. Start free, top up when you need more.
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
              Create your account.
            </h2>
            <p className="mt-2 text-sm leading-6 text-me-charcoal/60">
              Free to start — no credit card required.
            </p>
          </div>

          <RegisterForm />

          <p className="mt-7 text-center text-xs text-me-charcoal/45">
            Already have an account?{' '}
            <Link href="/portal/login" className="font-semibold text-me-ochre no-underline hover:underline">
              Sign in →
            </Link>
          </p>
        </div>
      </div>
    </main>
  )
}
