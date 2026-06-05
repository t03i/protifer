import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'
import type { ReactNode } from 'react'

interface SelectionState {
  start: number | null
  end: number | null
}

interface SelectionContextValue {
  start: number | null
  end: number | null
  selectResidues: (start: number, end: number) => void
  clearSelection: () => void
}

const SelectionContext = createContext<SelectionContextValue>({
  start: null,
  end: null,
  selectResidues: () => {},
  clearSelection: () => {},
})

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<SelectionState>({
    start: null,
    end: null,
  })

  const selectResidues = useCallback(
    (start: number, end: number) => setSelection({ start, end }),
    [],
  )
  const clearSelection = useCallback(
    () => setSelection({ start: null, end: null }),
    [],
  )

  const value = useMemo(
    () => ({ ...selection, selectResidues, clearSelection }),
    [selection, selectResidues, clearSelection],
  )

  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  )
}

export function useSelection(): SelectionContextValue {
  return useContext(SelectionContext)
}
