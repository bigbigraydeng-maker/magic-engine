'use client'

type OAuthStatus = 'success' | 'denied' | 'error' | null

interface Props {
  clientId: string
  clientName: string
  connectedEmail: string | null
  oauthStatus: OAuthStatus
}

type BannerKey = 'denied' | 'error'

const BANNERS: Record<BannerKey, { tone: string; text: string }> = {
  denied: {
    tone: 'border-amber-200 bg-amber-50 text-amber-800',
    text: 'Authorisation was cancelled — you can try again below.',
  },
  error: {
    tone: 'border-red-200 bg-red-50 text-red-700',
    text: 'Something went wrong. Please try connecting again.',
  },
}

function bannerFor(status: OAuthStatus) {
  if (status === 'denied' || status === 'error') return BANNERS[status]
  return null
}

export default function ConnectScreen({
  clientId,
  clientName,
  connectedEmail,
  oauthStatus,
}: Props) {
  const startOAuth = () => {
    window.location.href = `/api/auth/google/connect?client_id=${clientId}&flow=connect`
  }

  const banner = bannerFor(oauthStatus)
  const isConnected = connectedEmail !== null

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <span className="text-base font-bold tracking-tight text-gray-900">
            Magic Engine
          </span>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          {banner && (
            <div
              className={`mb-5 rounded-lg border px-4 py-2.5 text-sm ${banner.tone}`}
            >
              {banner.text}
            </div>
          )}

          <div className="text-center">
            <div className="mb-3 text-3xl">🔎</div>
            <h1 className="text-lg font-semibold text-gray-900">
              Connect Google Search Console
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              for{' '}
              <span className="font-medium text-gray-700">{clientName}</span>
            </p>
          </div>

          {isConnected ? (
            <div className="mt-6 space-y-4">
              <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-center">
                <p className="text-sm font-semibold text-green-800">
                  ✓ Connected
                </p>
                <p className="mt-0.5 text-xs text-green-700">
                  {connectedEmail}
                </p>
              </div>
              <p className="text-center text-sm text-gray-500">
                All done — you can safely close this page.
              </p>
              <button
                onClick={startOAuth}
                className="w-full text-xs text-gray-400 transition-colors hover:text-gray-600"
              >
                Connect a different Google account
              </button>
            </div>
          ) : (
            <div className="mt-6 space-y-5">
              <p className="text-sm leading-relaxed text-gray-600">
                Authorise Magic Engine to read your Search Console performance
                data — search queries, clicks, impressions and average
                rankings. This is <strong>read-only</strong>: Magic Engine
                cannot change your website or your Google account.
              </p>
              <button
                onClick={startOAuth}
                className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                <GoogleIcon />
                Connect with Google
              </button>
            </div>
          )}
        </div>

        <p className="mt-5 text-center text-xs text-gray-400">
          You will be taken to Google to sign in and approve access.
        </p>
      </div>
    </main>
  )
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  )
}
