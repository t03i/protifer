// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DownloadButton } from './DownloadButton'

import { SequenceContext } from '#/features/predictions/context/sequence-context'
import type { PredictionResponse } from '#/types/features'

const mockDownloadData = vi.fn()
vi.mock('#/lib/download', () => ({
  downloadData: (payload: string, filename: string) =>
    mockDownloadData(payload, filename),
}))

const FAKE_PREDICTIONS = {
  fake: 'predictions',
} as unknown as PredictionResponse
const SEQUENCE = 'MKTAYIAKQRQISFVKS'

beforeEach(() => {
  mockDownloadData.mockReset()
})

function renderWithContext(accession: string | undefined) {
  return render(
    <SequenceContext.Provider value={{ sequence: SEQUENCE, accession }}>
      <DownloadButton data={FAKE_PREDICTIONS} sequence={SEQUENCE} />
    </SequenceContext.Provider>,
  )
}

describe('DownloadButton payload shape', () => {
  it('includes accession when present in SequenceContext', async () => {
    const user = userEvent.setup()
    renderWithContext('P04637')

    await user.click(screen.getByRole('button', { name: /download json/i }))

    expect(mockDownloadData).toHaveBeenCalledOnce()
    const [payloadJson] = mockDownloadData.mock.calls[0]!
    const payload = JSON.parse(payloadJson as string)
    expect(payload).toEqual({
      sequence: SEQUENCE,
      accession: 'P04637',
      predictions: FAKE_PREDICTIONS,
    })
  })

  it('omits accession key entirely when SequenceContext has no accession', async () => {
    const user = userEvent.setup()
    renderWithContext(undefined)

    await user.click(screen.getByRole('button', { name: /download json/i }))

    expect(mockDownloadData).toHaveBeenCalledOnce()
    const [payloadJson] = mockDownloadData.mock.calls[0]!
    const payload = JSON.parse(payloadJson as string)
    expect(payload).toEqual({
      sequence: SEQUENCE,
      predictions: FAKE_PREDICTIONS,
    })
    expect('accession' in payload).toBe(false)
  })
})
