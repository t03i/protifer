import React from 'react'
import { toast } from 'sonner'

import { ErrorFallback } from './ErrorFallback'

import { logger } from '#/lib/logger'

interface State {
  hasError: boolean
  error: unknown
}

export class AppErrorBoundary extends React.Component<
  React.PropsWithChildren,
  State
> {
  override state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, error }
  }

  override componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    logger.error('Uncaught render error', error, {
      componentStack: info.componentStack,
    })
    toast.error('Something went wrong. Please refresh the page.')
  }

  override render() {
    if (this.state.hasError) {
      return <ErrorFallback error={this.state.error} />
    }
    return this.props.children
  }
}
