'use client'

/**
 * Error boundary for the CRM "订单与付款" block.
 *
 * If any child throws while rendering, the whole block is hidden instead of
 * taking down the surrounding client page. The error is logged for staff
 * support; nothing is shown to the user.
 */

import { Component } from 'react'
import type { ReactNode } from 'react'

export interface BookingsErrorBoundaryProps {
  children: ReactNode
}

interface BookingsErrorBoundaryState {
  failed: boolean
}

export class BookingsErrorBoundary extends Component<
  BookingsErrorBoundaryProps,
  BookingsErrorBoundaryState
> {
  state: BookingsErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): BookingsErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: unknown): void {
    console.error('[crm booking ui]', error)
  }

  render(): ReactNode {
    if (this.state.failed) return null
    return this.props.children
  }
}
