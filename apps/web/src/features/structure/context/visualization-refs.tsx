import { createContext, useContext, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'

import type { PdbeMolstarElement } from '#/features/structure/hooks/use-pdbe-molstar-plugin'

interface VisualizationRefs {
  molstarRef: RefObject<PdbeMolstarElement | null>
  nightingaleRef: RefObject<HTMLElement | null>
}

const VisualizationRefsContext = createContext<VisualizationRefs>({
  molstarRef: { current: null },
  nightingaleRef: { current: null },
})

export function VisualizationRefsProvider({
  children,
}: {
  children: ReactNode
}) {
  const molstarRef = useRef<PdbeMolstarElement | null>(null)
  const nightingaleRef = useRef<HTMLElement | null>(null)
  return (
    <VisualizationRefsContext.Provider value={{ molstarRef, nightingaleRef }}>
      {children}
    </VisualizationRefsContext.Provider>
  )
}

export function useVisualizationRefs(): VisualizationRefs {
  return useContext(VisualizationRefsContext)
}
