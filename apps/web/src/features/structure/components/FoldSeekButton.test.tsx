import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FoldSeekButton } from './FoldSeekButton'

const mockApiFetch = vi.fn()
vi.mock('#/services/api/gateway/client', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}))

function makeClient() {
  return new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={makeClient()}>{children}</QueryClientProvider>
  )
}

const MODEL_URL = 'https://alphafold.ebi.ac.uk/files/AF-P04637-F1-model_v4.cif'

describe('FoldSeekButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(window, 'open').mockImplementation(() => null)
  })

  it('renders "FoldSeek" text and is enabled when modelUrl is provided', () => {
    render(
      <Wrapper>
        <FoldSeekButton modelUrl={MODEL_URL} />
      </Wrapper>,
    )
    const btn = screen.getByRole('button', { name: /foldseek/i })
    expect(btn).toBeInTheDocument()
    expect(btn).not.toBeDisabled()
  })

  it('is disabled when modelUrl is undefined', () => {
    render(
      <Wrapper>
        <FoldSeekButton />
      </Wrapper>,
    )
    expect(screen.getByRole('button', { name: /foldseek/i })).toBeDisabled()
  })

  it('calls apiFetch with /v1/foldseek and the correct body on click', async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ticketId: 'abc123' }),
    })
    render(
      <Wrapper>
        <FoldSeekButton modelUrl={MODEL_URL} />
      </Wrapper>,
    )
    await userEvent.click(screen.getByRole('button', { name: /foldseek/i }))
    expect(mockApiFetch).toHaveBeenCalledWith(
      '/v1/foldseek',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining(MODEL_URL),
      }),
    )
    const body = JSON.parse(
      (mockApiFetch.mock.calls[0] as [string, RequestInit])[1].body as string,
    )
    expect(body.databases).toEqual(['pdb100', 'afdb50', 'afdb-swissprot'])
  })

  it('shows a spinner (animate-spin) while the mutation is pending', async () => {
    // Never resolves, so the button stays pending.
    mockApiFetch.mockImplementation(() => new Promise(() => {}))
    render(
      <Wrapper>
        <FoldSeekButton modelUrl={MODEL_URL} />
      </Wrapper>,
    )
    await userEvent.click(screen.getByRole('button', { name: /foldseek/i }))
    const spinner = await screen.findByRole('button')
    expect(spinner).toBeDisabled()
    expect(spinner.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('opens Foldseek results tab on success and keeps button disabled', async () => {
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ticketId: 'ticket42' }),
    })
    render(
      <Wrapper>
        <FoldSeekButton modelUrl={MODEL_URL} />
      </Wrapper>,
    )
    await userEvent.click(screen.getByRole('button', { name: /foldseek/i }))
    await waitFor(() => {
      expect(window.open).toHaveBeenCalledWith(
        'https://search.foldseek.com/result/ticket42/0',
        '_blank',
      )
    })
    // Button must remain disabled after success
    expect(screen.getByRole('button', { name: /foldseek/i })).toBeDisabled()
  })

  it('calls toast.error on mutation error and keeps button disabled', async () => {
    mockApiFetch.mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: () => Promise.resolve({ error: 'Foldseek service unavailable' }),
    })
    render(
      <Wrapper>
        <FoldSeekButton modelUrl={MODEL_URL} />
      </Wrapper>,
    )
    await userEvent.click(screen.getByRole('button', { name: /foldseek/i }))
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining('Foldseek service unavailable'),
      )
    })
    expect(screen.getByRole('button', { name: /foldseek/i })).toBeDisabled()
  })
})
