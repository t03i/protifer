// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiKeysPage } from '../components/ApiKeysPage'

vi.mock('#/services/auth/client', () => ({
  authClient: {
    apiKey: {
      list: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
  },
}))

const { authClient } = await import('#/services/auth/client')
const apiKey = (
  authClient as unknown as {
    apiKey: {
      list: ReturnType<typeof vi.fn>
      create: ReturnType<typeof vi.fn>
      delete: ReturnType<typeof vi.fn>
    }
  }
).apiKey

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
  return render(<ApiKeysPage />, { wrapper: Wrapper })
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  })
})

afterEach(() => {
  cleanup()
})

describe('ApiKeysPage', () => {
  it('renders empty state when user has no keys', async () => {
    apiKey.list.mockResolvedValue({
      data: { apiKeys: [], total: 0 },
      error: null,
    })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText(/no api keys yet/i)).toBeTruthy()
    })
  })

  it('renders existing keys in a table', async () => {
    apiKey.list.mockResolvedValue({
      data: {
        apiKeys: [
          {
            id: 'k1',
            name: 'CI pipeline',
            start: 'protifer_abc',
            prefix: null,
            createdAt: '2026-01-01T00:00:00Z',
            expiresAt: '2027-01-01T00:00:00Z',
            lastRequest: null,
            enabled: true,
          },
        ],
        total: 1,
      },
      error: null,
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('CI pipeline')).toBeTruthy()
    })
    expect(screen.getByText('protifer_abc')).toBeTruthy()
    expect(screen.getByText('Never used')).toBeTruthy()
  })

  it('shows the new key in the reveal dialog after a successful create', async () => {
    apiKey.list.mockResolvedValue({
      data: { apiKeys: [], total: 0 },
      error: null,
    })
    apiKey.create.mockResolvedValue({
      data: { id: 'new-1', key: 'protifer_NEWSECRET', name: 'My key' },
      error: null,
    })

    renderPage()
    const user = userEvent.setup()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /new key/i })).toBeTruthy()
    })

    await user.click(screen.getByRole('button', { name: /new key/i }))
    const labelInput = await screen.findByLabelText(/label/i)
    await user.type(labelInput, 'My key')

    await user.click(screen.getByRole('button', { name: /create key/i }))

    await waitFor(() => {
      expect(screen.getByTestId('reveal-key-value').textContent).toBe(
        'protifer_NEWSECRET',
      )
    })
  })

  it('clears the revealed key from the DOM after dismissing the dialog', async () => {
    apiKey.list.mockResolvedValue({
      data: { apiKeys: [], total: 0 },
      error: null,
    })
    apiKey.create.mockResolvedValue({
      data: { id: 'new-1', key: 'protifer_TOPSECRET', name: 'Another' },
      error: null,
    })

    renderPage()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: /new key/i }))
    await user.type(await screen.findByLabelText(/label/i), 'Another')
    await user.click(screen.getByRole('button', { name: /create key/i }))

    await waitFor(() => {
      expect(screen.getByTestId('reveal-key-value').textContent).toBe(
        'protifer_TOPSECRET',
      )
    })

    await user.click(screen.getByRole('button', { name: /done/i }))

    await waitFor(() => {
      expect(screen.queryByTestId('reveal-key-value')).toBeNull()
    })
    expect(document.body.textContent).not.toContain('protifer_TOPSECRET')
  })

  it('opens revoke confirmation and calls delete on confirm', async () => {
    apiKey.list.mockResolvedValue({
      data: {
        apiKeys: [
          {
            id: 'k1',
            name: 'CI pipeline',
            start: 'protifer_abc',
            prefix: null,
            createdAt: '2026-01-01T00:00:00Z',
            expiresAt: null,
            lastRequest: null,
            enabled: true,
          },
        ],
        total: 1,
      },
      error: null,
    })
    apiKey.delete.mockResolvedValue({ data: { success: true }, error: null })

    renderPage()
    const user = userEvent.setup()

    await waitFor(() => {
      expect(screen.getByText('CI pipeline')).toBeTruthy()
    })

    await user.click(
      screen.getByRole('button', { name: /revoke ci pipeline/i }),
    )
    await user.click(screen.getByRole('button', { name: /revoke key/i }))

    await waitFor(() => {
      expect(apiKey.delete).toHaveBeenCalledWith({ keyId: 'k1' })
    })
  })

  it('shows a validation error when the label is empty', async () => {
    apiKey.list.mockResolvedValue({
      data: { apiKeys: [], total: 0 },
      error: null,
    })

    renderPage()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: /new key/i }))
    const form = (await screen.findByLabelText(/label/i)).closest('form')!
    fireEvent.submit(form)

    await waitFor(() => {
      expect(screen.getByText(/label is required/i)).toBeTruthy()
    })
    expect(apiKey.create).not.toHaveBeenCalled()
  })
})
