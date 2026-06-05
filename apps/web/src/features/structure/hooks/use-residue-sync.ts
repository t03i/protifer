import { useEffect } from 'react'
import type { RefObject } from 'react'

import type { PdbeMolstarElement } from './use-pdbe-molstar-plugin'

import { useSelection } from '#/features/structure/context/selection'

export function useResidueSync(
  molstarRef: RefObject<PdbeMolstarElement | null>,
  isReady: boolean,
): void {
  const { selectResidues } = useSelection()

  useEffect(() => {
    if (!isReady) return

    const el = molstarRef.current
    if (!el) return

    const handler = (e: Event) => {
      const eventData = (
        e as MouseEvent & {
          eventData?: {
            seq_id?: number
            seq_id_begin?: number
            seq_id_end?: number
          }
        }
      ).eventData

      const residueStart = eventData?.seq_id_begin ?? eventData?.seq_id
      const residueEnd = eventData?.seq_id_end ?? eventData?.seq_id

      if (!residueStart || !residueEnd) return

      selectResidues(residueStart, residueEnd)
    }

    el.addEventListener('PDB.molstar.click', handler)
    return () => el.removeEventListener('PDB.molstar.click', handler)
  }, [isReady, molstarRef, selectResidues])
}
