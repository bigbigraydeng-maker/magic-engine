export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="text-center">
        <div className="text-5xl mb-4">🔒</div>
        <h1 className="text-2xl font-bold text-white mb-2">Access Denied</h1>
        <p className="text-gray-400 text-sm mb-6">
          Your email is not on the admin whitelist.
          <br />Contact your Magic Engine administrator.
        </p>
        <a
          href="/login"
          className="text-indigo-400 hover:text-indigo-300 text-sm underline underline-offset-4"
        >
          Back to login
        </a>
      </div>
    </div>
  )
}
