import Link from 'next/link'
import LoginForm from './login-form'

interface Props {
  searchParams: { next?: string; error?: string }
}

const portalLoops = [
  {
    icon: '🔍',
    label: 'Diagnose',
    body: 'See exactly how your business appears across Google, AI assistants, social, and review sites.',
  },
  {
    icon: '🔧',
    label: 'Execute',
    body: 'Approve content, ad fixes, and website changes — we handle the production.',
  },
  {
    icon: '📈',
    label: 'Prove',
    body: 'Track every visibility gain back to the actions that caused it.',
  },
]

function LogoMark({ size = 28 }: { size?: number }) {
  const h = Math.round(size * 64 / 68)
  return (
    <svg width={size} height={h} viewBox="0 0 68 64" fill="none" aria-hidden="true">
      <polygon points="3,60 13,6 22,6 12,60"  fill="#BE8A2E"/>
      <polygon points="13,6 22,6 33,38 24,38" fill="#9A6F1E"/>
      <polygon points="46,6 55,6 44,38 35,38" fill="#9A6F1E"/>
      <polygon points="46,6 55,6 65,60 55,60" fill="#BE8A2E"/>
      <polygon points="24,38 33,38 34,48 35,38 44,38 34,60" fill="#7A5518"/>
    </svg>
  )
}

export default function LoginPage({ searchParams }: Props) {
  const next = searchParams.next ?? '/dashboard'
  const hasError = searchParams.error === 'auth_failed'

  return (
    <main className="flex min-h-screen">
      {/* ── Left dark panel ── */}
      <div
        className="hidden lg:flex lg:w-[44%] lg:flex-col lg:min-h-screen px-10 py-8"
        style={{ background: '#16181D' }}
      >
        {/* Logo */}
        <Link
          href="https://magicengine.com.au"
          className="flex items-center gap-2.5 no-underline"
          style={{ color: '#fff' }}
        >
          <LogoMark size={28} />
          <span className="text-sm font-bold">Magic Engine</span>
        </Link>

        {/* Hero copy */}
        <div className="mt-auto mb-10">
          <div
            className="text-xs font-bold uppercase tracking-[0.16em] mb-5"
            style={{ color: '#BE8A2E' }}
          >
            Client portal
          </div>
          <h1
            className="text-[2.6rem] font-black leading-[1.08] text-white"
            style={{ fontFamily: "'Fraunces', Georgia, serif", letterSpacing: '-.02em' }}
          >
            Your visibility<br />dashboard.
          </h1>
          <p className="mt-4 text-sm leading-[1.75]" style={{ color: 'rgba(255,255,255,.60)' }}>
            See your discovery report, track improvements, and approve every action — all in one place.
          </p>

          <div className="mt-8 flex flex-col gap-3">
            {portalLoops.map(item => (
              <div
                key={item.label}
                className="rounded-xl p-4"
                style={{
                  background: 'rgba(255,255,255,.055)',
                  border: '1px solid rgba(255,255,255,.08)',
                }}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-base">{item.icon}</span>
                  <p className="text-sm font-bold text-white">{item.label}</p>
                </div>
                <p className="text-xs leading-[1.65]" style={{ color: 'rgba(255,255,255,.50)' }}>
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </div>

        <Link
          href="https://magicengine.com.au"
          className="text-xs no-underline transition-colors hover:opacity-70"
          style={{ color: 'rgba(255,255,255,.35)' }}
        >
          ← Back to magicengine.com.au
        </Link>
      </div>

      {/* ── Right paper panel ── */}
      <div
        className="flex flex-1 flex-col items-center justify-center min-h-screen px-6 py-12"
        style={{ background: '#FBFAF7' }}
      >
        {/* Mobile logo */}
        <div className="lg:hidden mb-8 flex items-center gap-2.5">
          <LogoMark size={26} />
          <span className="text-sm font-bold" style={{ color: '#16181D' }}>Magic Engine</span>
        </div>

        <div className="w-full max-w-[360px]">
          {/* Heading */}
          <div className="mb-7">
            <h2
              className="text-[2rem] font-black leading-tight"
              style={{
                fontFamily: "'Fraunces', Georgia, serif",
                color: '#16181D',
                letterSpacing: '-.02em',
              }}
            >
              Welcome back.
            </h2>
            <p className="mt-2 text-sm leading-6" style={{ color: 'rgba(22,24,29,.60)' }}>
              Sign in to your Magic Engine portal.
            </p>
          </div>

          <LoginForm next={next} authFailed={hasError} />

          <p className="mt-7 text-center text-xs" style={{ color: 'rgba(22,24,29,.45)' }}>
            No account?{' '}
            <Link
              href="https://magicengine.com.au/discover"
              className="font-semibold no-underline"
              style={{ color: '#9A6F1E' }}
            >
              Start with a free discovery →
            </Link>
          </p>
        </div>
      </div>
    </main>
  )
}
