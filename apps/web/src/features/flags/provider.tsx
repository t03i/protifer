import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'

export interface FlagsClient {
  getBooleanValue: (name: string, defaultValue: boolean) => boolean
  getStringValue: (name: string, defaultValue: string) => string
  getNumberValue: (name: string, defaultValue: number) => number
  getObjectValue: <T>(name: string, defaultValue: T) => T
}

const FlagsClientContext = createContext<FlagsClient | null>(null)

export function useFlagsClient(): FlagsClient {
  const client = useContext(FlagsClientContext)
  if (!client)
    throw new Error('useFlagsClient must be used within FeatureFlagsProvider')
  return client
}

export interface FeatureFlagsProviderProps {
  evaluatedFlags: Record<string, unknown>
  children: ReactNode
}

function buildClient(flags: Record<string, unknown>): FlagsClient {
  return {
    getBooleanValue(name, defaultValue) {
      const v = flags[name]
      return typeof v === 'boolean' ? v : defaultValue
    },
    getStringValue(name, defaultValue) {
      const v = flags[name]
      return typeof v === 'string' ? v : defaultValue
    },
    getNumberValue(name, defaultValue) {
      const v = flags[name]
      return typeof v === 'number' ? v : defaultValue
    },
    getObjectValue<T>(name: string, defaultValue: T): T {
      return name in flags ? (flags[name] as T) : defaultValue
    },
  }
}

export function FeatureFlagsProvider({
  evaluatedFlags,
  children,
}: FeatureFlagsProviderProps) {
  const client = useMemo(() => buildClient(evaluatedFlags), [evaluatedFlags])
  return (
    <FlagsClientContext.Provider value={client}>
      {children}
    </FlagsClientContext.Provider>
  )
}
