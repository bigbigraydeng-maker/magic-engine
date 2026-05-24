/**
 * Admin guard for /dashboard/admin/users/*
 * Middleware sets x-user-role for /dashboard/* paths, so we just read the header.
 * client-viewer and fde users are blocked here at the layout level as a second layer of defence.
 */
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'

export default async function AdminUsersLayout({ children }: { children: React.ReactNode }) {
  const headersList = await headers()
  const userRole = headersList.get('x-user-role')

  if (userRole !== 'admin') {
    redirect('/unauthorized')
  }

  return <>{children}</>
}
