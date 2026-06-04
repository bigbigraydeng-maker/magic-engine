'use client'

/**
 * 魏征 Hotfix-5: minimal error boundary scoped to one SerpRow.
 *
 * Problem: PM reported the entire /dashboard/industry-baselines page crashes
 * with "Application error" when expanding a row in the Google 排名 tab. With
 * no usable console trace available at the time of writing, we isolate the
 * blast radius — one bad row should not take down 50 other rows + the whole
 * tab system.
 *
 * If a SerpRow throws, we render an inline red notice with the snapshot id
 * so PM can copy it and we can debug that specific row's data shape.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  snapshotId: string
  questionPreview: string
  children: ReactNode
}

interface State {
  hasError: boolean
  errorMessage: string
}

export class SerpRowErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, errorMessage: '' }
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage: error?.message ?? String(error),
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface to console for production debugging — PM can F12 → Console
    console.error('[SerpRow] crashed', {
      snapshotId: this.props.snapshotId,
      question: this.props.questionPreview,
      error: error.message,
      stack: info.componentStack,
    })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="px-4 py-3 border-l-2 border-status-rej bg-status-rej/5">
          <p className="text-xs font-black text-status-rej">
            ✗ 该行渲染崩溃（snapshot {this.props.snapshotId.slice(0, 8)}…）
          </p>
          <p className="mt-1 text-[11px] text-me-charcoal/55">
            题目：{this.props.questionPreview}
          </p>
          <p className="mt-1 text-[11px] text-me-charcoal/45 italic">
            错误：{this.state.errorMessage}
          </p>
          <p className="mt-1 text-[11px] text-me-charcoal/35">
            打开 F12 → Console 查看完整堆栈，把 snapshot id 给开发者
          </p>
        </div>
      )
    }
    return this.props.children
  }
}
