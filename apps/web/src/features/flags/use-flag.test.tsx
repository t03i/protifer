import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { FeatureFlagsProvider } from './provider'
import { useFlag } from './use-flag'

function ShowBoolean({ name, fallback }: { name: string; fallback: boolean }) {
  const value = useFlag(name, fallback)
  return <div>{value ? 'on' : 'off'}</div>
}

function ShowString({ name, fallback }: { name: string; fallback: string }) {
  const value = useFlag(name, fallback)
  return <div>{value}</div>
}

describe('useFlag', () => {
  it('returns the server-evaluated boolean when set', () => {
    render(
      <FeatureFlagsProvider evaluatedFlags={{ 'a.b': true }}>
        <ShowBoolean name="a.b" fallback={false} />
      </FeatureFlagsProvider>,
    )
    expect(screen.getByText('on')).toBeInTheDocument()
  })

  it('returns the default when flag is not in seeded set', () => {
    render(
      <FeatureFlagsProvider evaluatedFlags={{}}>
        <ShowBoolean name="missing" fallback={false} />
      </FeatureFlagsProvider>,
    )
    expect(screen.getByText('off')).toBeInTheDocument()
  })

  it('returns string flag value', () => {
    render(
      <FeatureFlagsProvider evaluatedFlags={{ greeting: 'hi' }}>
        <ShowString name="greeting" fallback="bye" />
      </FeatureFlagsProvider>,
    )
    expect(screen.getByText('hi')).toBeInTheDocument()
  })

  it('updates when evaluatedFlags prop changes', () => {
    const { rerender } = render(
      <FeatureFlagsProvider evaluatedFlags={{ 'a.b': false }}>
        <ShowBoolean name="a.b" fallback={true} />
      </FeatureFlagsProvider>,
    )
    expect(screen.getByText('off')).toBeInTheDocument()

    rerender(
      <FeatureFlagsProvider evaluatedFlags={{ 'a.b': true }}>
        <ShowBoolean name="a.b" fallback={true} />
      </FeatureFlagsProvider>,
    )
    expect(screen.getByText('on')).toBeInTheDocument()
  })
})
