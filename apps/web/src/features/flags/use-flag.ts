import { useFlagsClient } from './provider'

export function useFlag(name: string, defaultValue: boolean): boolean
export function useFlag(name: string, defaultValue: string): string
export function useFlag(name: string, defaultValue: number): number
export function useFlag<T>(name: string, defaultValue: T): T {
  const client = useFlagsClient()
  if (typeof defaultValue === 'boolean') {
    return client.getBooleanValue(name, defaultValue) as T
  }
  if (typeof defaultValue === 'string') {
    return client.getStringValue(name, defaultValue) as T
  }
  if (typeof defaultValue === 'number') {
    return client.getNumberValue(name, defaultValue) as T
  }
  return client.getObjectValue(name, defaultValue as never) as T
}
