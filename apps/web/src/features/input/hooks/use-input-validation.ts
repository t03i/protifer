import { useMemo } from 'react'

import { evalInputType } from '#/services/sequence/validation'
import type { InputValidation } from '#/types/sequence'
import { InputAlphabet, InputType } from '#/types/sequence'

export function useInputValidation(input: string): InputValidation {
  return useMemo(() => {
    if (!input.trim()) {
      return {
        type: InputType.invalid,
        alphabet: InputAlphabet.undefined,
        isValid: false,
      }
    }

    const [type, alphabet] = evalInputType(input)
    return {
      type,
      alphabet,
      isValid: type !== InputType.invalid,
    }
  }, [input])
}
