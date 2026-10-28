/**
 * Six-dimension scoring is retired. Bookmarks land here instead of the old scorecard.
 */
export default function RetiredDiagnosticPage({ params }: { params: { id: string } }) {
  const prescriptionHref = `/dashboard/clients/${encodeURIComponent(params.id)}/prescription/new`
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-me-ochre">处方</p>
      <h1 className="mt-3 text-2xl font-black text-me-charcoal">已废弃</h1>
      <p className="mt-3 text-sm leading-6 text-me-charcoal/70">
        华佗六维体检不再打分，也不再列出问题。要开方或改已有的方，走处方。
      </p>
      <a href={prescriptionHref} className="mt-6 inline-block text-sm font-black text-me-charcoal underline">
        打开处方
      </a>
    </main>
  )
}
