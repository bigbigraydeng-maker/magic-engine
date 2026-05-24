import UserManagementTab from './UserManagementTab'

export default function PortalTab() {
  return (
    <UserManagementTab
      accessType="portal"
      title="Portal Users"
      description="Client-facing users who log in to their dedicated /portal page to view reports and insights."
      addLabel="Grant portal access"
    />
  )
}
