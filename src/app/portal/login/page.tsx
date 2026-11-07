import Link from 'next/link'
import { MeMark, MeMarkDefs } from '@/components/ui/me-mark'
import PortalLoginForm from './portal-login-form'
import { isChinaPhoneOtpEnabled } from '@/lib/auth/china-phone-otp'

interface Props {
  searchParams: { next?: string; error?: string; emailCode?: string }
}

const portalLoops = [
  {
    icon: '🔍',
    label: 'Reports',
    body: 'Review the latest diagnostic report and priority visibility actions.',
  },
  {
    icon: '🔧',
    label: 'Content',
    body: 'See published search and social assets created for your business.',
  },
  {
    icon: '📈',
    label: 'Proof',
    body: 'Track every shipped improvement back to the results it drove.',
  },
]

export default function PortalLoginPage({ searchParams }: Props) {
  const next = searchParams.next?.startsWith('/') && !searchParams.next.startsWith('//')
    ? searchParams.next
    : '/portal'
  const hasError = searchParams.error === 'auth_failed'
  const fromProspect = next === '/prospect'
  const firstPhoneBinding = next === '/account/phone'
  const phoneEnabled = isChinaPhoneOtpEnabled()
  const emailCodeFirst = firstPhoneBinding || searchParams.emailCode === '1' || !phoneEnabled
  const registerHref = `/portal/register?next=${encodeURIComponent(next)}`

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
            {fromProspect ? 'Discovery report access' : 'Workspace access'}
          </div>
          <h1 className="font-display text-[2.6rem] font-bold leading-[1.08] tracking-tight text-white">
            {fromProspect ? (
              <>Open your report.<br />Then keep going.</>
            ) : (
              <>See what has<br />shipped.</>
            )}
          </h1>
          <p className="mt-4 text-sm leading-[1.75] text-white/60">
            {fromProspect
              ? 'Sign in to view your Discovery Report, then move it into a workspace whenever you are ready.'
              : 'Your portal brings monthly reports, approved content, and execution proof into one view.'}
          </p>

          <div className="mt-8 flex flex-col gap-3">
            {portalLoops.map(item => (
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
        {/* Mobile logo */}
        <div className="mb-8 flex items-center gap-2.5 lg:hidden">
          <MeMark className="h-6 w-7" />
          <span className="font-display text-sm font-bold text-me-charcoal">Magic Engine</span>
        </div>

        <div className="w-full max-w-[360px]">
          <div className="mb-7">
            <h2 className="font-display text-[2rem] font-bold leading-tight tracking-tight text-me-charcoal">
              {firstPhoneBinding ? '验证原账号并绑定手机号' : fromProspect ? 'Open your Discovery Report.' : '登录 Magic Engine 工作区'}
            </h2>
            <p className="mt-2 text-sm leading-6 text-me-charcoal/60">
              {firstPhoneBinding
                ? '请用原账号邮箱收取一次性验证码。验证后会直接进入绑定页面，不会创建新账号。'
                : !phoneEnabled
                  ? '手机号验证码登录暂未开放。请先用原账号邮箱验证码或 Google 登录。'
                  : fromProspect
                    ? '使用手机验证码、Google 或邮箱登录继续查看报告。'
                    : '使用中国大陆手机号接收验证码登录工作区。'}
            </p>
          </div>

          <PortalLoginForm next={next} authFailed={hasError} phoneEnabled={phoneEnabled} emailCodeFirst={emailCodeFirst} />

          {firstPhoneBinding ? (
            <p className="mt-7 text-center text-xs text-me-charcoal/45">
              员工请使用 <Link href="/login" className="font-semibold text-me-ochre no-underline hover:underline">员工登录</Link>。
            </p>
          ) : (
            <>
              <p className="mt-7 text-center text-xs text-me-charcoal/45">
                New customer?{' '}
                <Link href={registerHref} className="font-semibold text-me-ochre no-underline hover:underline">
                  Create a free account →
                </Link>
              </p>
              <p className="mt-3 text-center text-xs leading-5 text-me-charcoal/45">
                已有账号首次绑定手机？
                <Link
                  href="/portal/login?next=%2Faccount%2Fphone&emailCode=1"
                  className="ml-1 font-semibold text-me-ochre no-underline hover:underline"
                >
                  用原邮箱验证码进入并绑定
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  )
}
