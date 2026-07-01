import React from 'react'

import { logger } from '#/lib/logger'

interface Props {
  children: React.ReactNode
  fallback: string
}

export class WebComponentErrorBoundary extends React.Component<Props> {
  override state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    logger.error('web-component render error', error, {
      componentStack: info.componentStack,
    })
  }

  override render() {
    if (this.state.failed) {
      return (
        <p className="text-sm text-muted-foreground py-2">
          {this.props.fallback}
        </p>
      )
    }
    return this.props.children
  }
}
