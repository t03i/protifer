// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppErrorBoundary } from './AppErrorBoundary'

import type { Logger } from '#/lib/logger'
import { setLogger } from '#/lib/logger'

function Bomb(): never {
  throw new Error('test explosion')
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AppErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <AppErrorBoundary>
        <span>safe content</span>
      </AppErrorBoundary>,
    )
    expect(screen.getByText('safe content')).toBeInTheDocument()
  })

  it('renders fallback when child throws', () => {
    render(
      <AppErrorBoundary>
        <Bomb />
      </AppErrorBoundary>,
    )
    expect(
      screen.getByRole('heading', { name: /something went wrong/i }),
    ).toBeInTheDocument()
    expect(screen.getByText(/test explosion/i)).toBeInTheDocument()
  })

  it('logs the error via the injected logger', () => {
    const mock: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    setLogger(mock)

    render(
      <AppErrorBoundary>
        <Bomb />
      </AppErrorBoundary>,
    )

    expect(mock.error).toHaveBeenCalledWith(
      'Uncaught render error',
      expect.any(Error),
      expect.objectContaining({ componentStack: expect.any(String) }),
    )
  })
})
