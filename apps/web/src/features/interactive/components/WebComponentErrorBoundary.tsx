import React from 'react'

interface Props {
  children: React.ReactNode
  fallback: string
}

export class WebComponentErrorBoundary extends React.Component<Props> {
  override state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
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
