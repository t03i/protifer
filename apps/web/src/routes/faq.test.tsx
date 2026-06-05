// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AnchorHTMLAttributes, FunctionComponent, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute:
    () =>
    ({ component }: { component: FunctionComponent }) => ({ component }),
  Link: ({
    to,
    children,
    ...rest
  }: {
    to: string
    children: ReactNode
  } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

const { Route } = await import('./faq')
const { faqItems } = await import('#/content/faq')

const FaqPage = (Route as unknown as { component: FunctionComponent }).component

describe('/faq', () => {
  it('renders the heading', () => {
    render(<FaqPage />)
    expect(
      screen.getByRole('heading', { level: 1, name: 'FAQ' }),
    ).toBeInTheDocument()
  })

  it('lists at least 8 questions', () => {
    render(<FaqPage />)
    expect(faqItems.length).toBeGreaterThanOrEqual(8)
    for (const item of faqItems) {
      expect(
        screen.getByRole('button', { name: item.question }),
      ).toBeInTheDocument()
    }
  })

  it('reveals an answer when the trigger is clicked', async () => {
    const user = userEvent.setup()
    render(<FaqPage />)
    const first = faqItems[0]!
    const trigger = screen.getByRole('button', { name: first.question })
    await user.click(trigger)
    expect(trigger).toHaveAttribute('data-state', 'open')
    expect(screen.getByText(first.answer)).toBeVisible()
  })
})
