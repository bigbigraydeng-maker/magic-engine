import Link from 'next/link'
import { MeMark, MeMarkDefs } from '@/components/ui/me-mark'
import ForgotPasswordForm from './_components/ForgotPasswordForm'

export const metadata = {
  title: 'Forgot Password',
  description: 'Reset your Magic Engine account password.',
}

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen">
      <MeMarkDefs />

      {/* ── Left dark panel ── */}
      <div className="hidden lg:flex lg:w-[44%] lg:flex-col lg:min-h-screen bg-me-black px-10 py-8">
        <Link href="https://magicengine.com.au" className="flex items-center gap-2.5 text-[#FBF8F3] no-underline">
          <MeMark className="h-7 w-8 flex-none" />
          <span className="font-display text-sm font-bold">Magic Engine</span>
        </Link>
        <div className="mt-auto mb-10">
          <div className="mb-5 text-xs font-bold uppercase tracking-[0.16em] text-me-gold">
            Account recovery
          </div>
          <h1 className="font-display text-[2.6rem] font-bold leading-[1.08] tracking-tight text-white">
            Back in the loop<br />in 60 seconds.
          </h1>
          <p className="mt-4 text-sm leading-[1.75] text-white/60">
            Enter your email and we'll send a reset link. Click it, set a new password, and you're straight back into your workspace.
          </p>
        </div>
        <Link href="https://magicengine.com.au" className="text-xs text-white/35 no-underline transition-colors hover:text-white/55">
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
              Reset your password.
            </h2>
            <p className="mt-2 text-sm leading-6 text-me-charcoal/60">
              Enter the email address on your account and we'll send a reset link.
            </p>
          </div>

          <ForgotPasswordForm />

          <p className="mt-7 text-center text-xs text-me-charcoal/45">
            Remember it?{' '}
            <Link href="/portal/login" className="font-semibold text-me-ochre no-underline hover:underline">
              Back to sign in →
            </Link>
          </p>
        </div>
      </div>
    </main>
  )
}
