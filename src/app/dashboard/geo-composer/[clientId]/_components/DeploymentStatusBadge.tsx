/**
 * Reusable Component: DeploymentStatusBadge
 *
 * Status indicator badge showing deployment state (active, pending, revoked).
 * Can be extracted and reused across other pages.
 */

'use client';

interface DeploymentStatusBadgeProps {
  status: 'active' | 'pending' | 'revoked';
  size?: 'sm' | 'md' | 'lg';
}

export function DeploymentStatusBadge({ status, size = 'md' }: DeploymentStatusBadgeProps) {
  const sizeClasses = {
    sm: 'px-2 py-1 text-xs',
    md: 'px-3 py-1.5 text-sm',
    lg: 'px-4 py-2 text-base',
  };

  const statusColors = {
    active: 'bg-[#5C8A4A]/12 text-[#5C8A4A]',
    pending: 'bg-me-ochre/10 text-me-ochre',
    revoked: 'bg-me-ivory text-me-charcoal/55',
  };

  const statusLabels = {
    active: 'Active',
    pending: 'Pending',
    revoked: 'Revoked',
  };

  return (
    <span className={`inline-block rounded-full font-medium ${sizeClasses[size]} ${statusColors[status]}`}>
      {statusLabels[status]}
    </span>
  );
}
