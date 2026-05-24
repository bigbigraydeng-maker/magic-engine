import UserManagementTab from './UserManagementTab'

export default function FdeTab() {
  return (
    <UserManagementTab
      accessType="fde"
      title="FDE Accounts"
      description="Frontline Deployment Engineers — can log in to the client dashboard workspace but cannot access admin tools or other clients."
      addLabel="Create FDE account"
    />
  )
}
