'use client'

/**
 * Last line of defence for the 付款总览 ready view: if rendering the data throws (a field the
 * shape guard did not expect), show the plain error instead of a blank page. Nothing about the
 * error or the data is logged or shown. `resetKey` changing (new data arrived) clears the error.
 */

import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback: ReactNode
  resetKey: unknown
}

export class PaymentsErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false })
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
