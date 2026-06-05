import { createContext, useContext } from 'react'

interface SequenceContextValue {
  sequence: string
  accession: string | undefined
}

export const SequenceContext = createContext<SequenceContextValue | null>(null)

export function useSequenceContext(): SequenceContextValue {
  const ctx = useContext(SequenceContext)
  if (!ctx) {
    throw new Error(
      'useSequenceContext must be used within a SequenceContext.Provider',
    )
  }
  return ctx
}
