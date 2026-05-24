import PortalLoginForm from './portal-login-form'

interface Props {
  searchParams: { next?: string; error?: string }
}

export default function PortalLoginPage({ searchParams }: Props) {
  const next = searchParams.next?.startsWith('/portal')
    ? searchParams.next
    : '/portal'
  const hasError = searchParams.error === 'auth_failed'

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <span className="text-4xl">✨</span>
          <h1 className="mt-3 text-2xl font-bold text-gray-900">Magic Engine</h1>
          <p className="mt-1 text-sm text-gray-500">Client portal</p>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <PortalLoginForm next={next} authFailed={hasError} />
        </div>

        <p className="mt-6 text-center text-xs text-gray-400">
          Magic Lab · Powered by Magic Engine
        </p>
      </div>
    </div>
  )
}
