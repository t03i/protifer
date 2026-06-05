// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SequenceInput } from './SequenceInput'

import { evalInputType } from '#/services/sequence/validation'
import { InputAlphabet, InputType } from '#/types/sequence'

const mockNavigate = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

const mockValidation = vi.fn()
vi.mock('../hooks/use-input-validation', () => ({
  useInputValidation: (input: string) => mockValidation(input),
}))

const mockRefetch = vi.fn()
vi.mock('../hooks/use-sequence', () => ({
  useSequence: () => ({ refetch: mockRefetch, isFetching: false }),
}))

beforeEach(() => {
  mockNavigate.mockClear()
  mockRefetch.mockClear()
  mockValidation.mockReset()
})

function setValidation(
  type: InputType,
  alphabet: InputAlphabet = InputAlphabet.iupac,
) {
  mockValidation.mockReturnValue({ isValid: true, type, alphabet })
}

describe('SequenceInput — FASTA accession routing', () => {
  it('passes both sequence and accession to /results/raw for SwissProt FASTA', async () => {
    const user = userEvent.setup()
    const fasta =
      '>sp|P04637|P53_HUMAN Cellular tumor antigen p53\nMEEPQSDPSVEPPLSVPEAPW'
    setValidation(InputType.fasta)
    mockRefetch.mockResolvedValue({
      data: { sequence: 'MEEPQSDPSVEPPLSVPEAPW', accession: 'P04637' },
      error: null,
    })

    render(<SequenceInput />)
    await user.type(screen.getByRole('textbox'), fasta)
    await user.click(screen.getByRole('button', { name: /predict/i }))

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/results/raw',
      search: {
        sequence: 'MEEPQSDPSVEPPLSVPEAPW',
        accession: 'P04637',
      },
    })
  })

  it('omits accession for plain FASTA without sp/tr header', async () => {
    const user = userEvent.setup()
    setValidation(InputType.fasta)
    mockRefetch.mockResolvedValue({
      data: { sequence: 'MKTAYI', accession: undefined },
      error: null,
    })

    render(<SequenceInput />)
    await user.type(screen.getByRole('textbox'), '>my_protein\nMKTAYI')
    await user.click(screen.getByRole('button', { name: /predict/i }))

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/results/raw',
      search: { sequence: 'MKTAYI' },
    })
  })

  it('omits accession for raw residue input (unchanged behavior)', async () => {
    const user = userEvent.setup()
    setValidation(InputType.residue)
    mockRefetch.mockResolvedValue({
      data: { sequence: 'MKTAYI', accession: undefined },
      error: null,
    })

    render(<SequenceInput />)
    await user.type(screen.getByRole('textbox'), 'MKTAYI')
    await user.click(screen.getByRole('button', { name: /predict/i }))

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/results/raw',
      search: { sequence: 'MKTAYI' },
    })
  })
})

describe('SequenceInput — examples', () => {
  const exampleLabels = [
    'FASTA',
    'UniProt accession',
    'Protein name',
    'Amino acids',
  ]

  it('shows exactly four one-click examples, one per input mode', () => {
    setValidation(InputType.residue)
    render(<SequenceInput />)
    for (const label of exampleLabels) {
      expect(
        screen.getByRole('button', { name: `Prefill ${label} example` }),
      ).toBeDefined()
    }
  })

  it('each example resolves to a non-invalid InputType', async () => {
    const user = userEvent.setup()
    setValidation(InputType.residue)
    render(<SequenceInput />)
    const textarea = screen.getByRole<HTMLTextAreaElement>('textbox')
    for (const label of exampleLabels) {
      await user.click(
        screen.getByRole('button', { name: `Prefill ${label} example` }),
      )
      const [type] = evalInputType(textarea.value)
      expect(type, `example "${label}" classified as invalid`).not.toBe(
        InputType.invalid,
      )
    }
  })
})
