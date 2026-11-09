/**
 * Diagnostic report is retired with the six-dimension scorecard.
 */
export default function RetiredDiagnosticReportPage({ params }: { params: { id: string } }) {
  const prescriptionHref = `/dashboard/clients/${encodeURIComponent(params.id)}/prescription/new`
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-2xl font-black text-me-charcoal">已废弃</h1>
      <p className="mt-3 text-sm leading-6 text-me-charcoal/70">
        这份体检报告不再生成。六维分数和问题清单都停了。
      </p>
      <a href={prescriptionHref} className="mt-6 inline-block text-sm font-black text-me-charcoal underline">
        打开处方
      </a>
    </main>
  )
}
