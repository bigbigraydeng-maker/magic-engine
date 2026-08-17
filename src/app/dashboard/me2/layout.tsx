/**
 * Admin guard for /dashboard/me2/*
 * Middleware sets x-user-role for /dashboard/* paths, so we just read the header.
 * client-viewer / scoped admins are already bounced by middleware; this is the
 * second layer of defence (同 admin/users 的做法).
 */
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'

export default async function Me2Layout({ children }: { children: React.ReactNode }) {
  const headersList = await headers()
  const userRole = headersList.get('x-user-role')

  if (userRole !== 'admin') {
    redirect('/unauthorized')
  }

  return <>{children}</>
}
