// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { LoginContent } from './LoginContent'

describe('LoginContent', () => {
  it('renders sign-in heading', () => {
    render(<LoginContent onLogin={vi.fn()} />)
    expect(screen.getByText('Sign in to continue')).toBeInTheDocument()
  })

  it('renders GitHub sign-in button', () => {
    render(<LoginContent onLogin={vi.fn()} />)
    expect(
      screen.getByRole('button', { name: /sign in with github/i }),
    ).toBeInTheDocument()
  })

  it('calls onLogin when button is clicked', async () => {
    const onLogin = vi.fn()
    render(<LoginContent onLogin={onLogin} />)
    await userEvent.click(
      screen.getByRole('button', { name: /sign in with github/i }),
    )
    expect(onLogin).toHaveBeenCalledOnce()
  })

  it('disables button when isPending is true', () => {
    render(<LoginContent onLogin={vi.fn()} isPending />)
    const button = screen.getByRole('button', { name: /sign in with github/i })
    expect(button).toBeDisabled()
  })

  it('shows spinner when isPending is true', () => {
    const { container } = render(<LoginContent onLogin={vi.fn()} isPending />)
    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('renders error message when error prop is set', () => {
    render(
      <LoginContent
        onLogin={vi.fn()}
        error="Something went wrong. Try again or visit github.com to verify your account."
      />,
    )
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
  })

  it('does not render error when error is null', () => {
    const { container } = render(
      <LoginContent onLogin={vi.fn()} error={null} />,
    )
    expect(container.querySelector('.text-destructive')).toBeNull()
  })
})
