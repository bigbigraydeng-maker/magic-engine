import Link from 'next/link'
import { MeMark, MeMarkDefs } from '@/components/ui/me-mark'
import ResetPasswordForm from './_components/ResetPasswordForm'

export const metadata = {
  title: 'Reset Password',
  description: 'Set a new password for your Magic Engine account.',
}

export default function ResetPasswordPage() {
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
            Almost there
          </div>
          <h1 className="font-display text-[2.6rem] font-bold leading-[1.08] tracking-tight text-white">
            New password,<br />same loop.
          </h1>
          <p className="mt-4 text-sm leading-[1.75] text-white/60">
            Set a strong password and you're straight back into your workspace. Your execution loop is still running.
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
              Set a new password.
            </h2>
            <p className="mt-2 text-sm leading-6 text-me-charcoal/60">
              Choose a strong password of at least 8 characters.
            </p>
          </div>

          <ResetPasswordForm />
        </div>
      </div>
    </main>
  )
}
