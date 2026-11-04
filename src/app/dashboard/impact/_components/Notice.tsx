import Link from 'next/link'

export function Notice({ title, body, back }: { title: string; body: string; back?: boolean }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-6 sm:px-8">
      <div className="rounded-xl border border-me-charcoal/12 bg-white p-4">
        <h1 className="font-display text-2xl font-black text-me-charcoal">{title}</h1>
        <p className="mt-2 max-w-[65ch] text-sm leading-6 text-me-charcoal/80">{body}</p>
        {back ? (
          <Link href="/dashboard/impact" className="mt-3 inline-block text-sm font-bold text-me-ochre hover:underline">
            返回项目
          </Link>
        ) : null}
      </div>
    </div>
  )
}
