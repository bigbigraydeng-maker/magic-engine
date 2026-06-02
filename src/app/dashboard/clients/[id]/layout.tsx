import { ZhugeGlobalFab } from './_components/ZhugeGlobalFab'

export default function ClientLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { id: string }
}) {
  return (
    <>
      {children}
      <ZhugeGlobalFab clientId={params.id} />
    </>
  )
}
