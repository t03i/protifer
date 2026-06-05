import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ExampleSequenceChips } from './ExampleSequenceChips'

import { exampleSequences } from '#/content/example-sequences'

describe('ExampleSequenceChips', () => {
  it('renders one button per example', () => {
    render(<ExampleSequenceChips onSelect={() => {}} />)
    for (const ex of exampleSequences) {
      expect(
        screen.getByRole('button', { name: `Prefill ${ex.label} example` }),
      ).toBeInTheDocument()
    }
  })

  it('calls onSelect with value and format on click', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<ExampleSequenceChips onSelect={onSelect} />)
    const uniprot = exampleSequences.find((e) => e.format === 'uniprot_id')!
    await user.click(
      screen.getByRole('button', { name: `Prefill ${uniprot.label} example` }),
    )
    expect(onSelect).toHaveBeenCalledWith(uniprot.value)
  })

  it('activates via keyboard (Enter)', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<ExampleSequenceChips onSelect={onSelect} />)
    const fasta = exampleSequences.find((e) => e.format === 'fasta')!
    const button = screen.getByRole('button', {
      name: `Prefill ${fasta.label} example`,
    })
    button.focus()
    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith(fasta.value)
  })

  it('activates via keyboard (Space)', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<ExampleSequenceChips onSelect={onSelect} />)
    const seq = exampleSequences.find((e) => e.format === 'sequence')!
    const button = screen.getByRole('button', {
      name: `Prefill ${seq.label} example`,
    })
    button.focus()
    await user.keyboard(' ')
    expect(onSelect).toHaveBeenCalledWith(seq.value)
  })
})
