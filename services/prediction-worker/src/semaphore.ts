export type Release = () => void

export interface Semaphore {
  acquire(): Promise<Release>
  readonly available: number
}

export function createSemaphore(permits: number): Semaphore {
  if (!Number.isInteger(permits) || permits < 1) {
    throw new Error(
      `semaphore permits must be a positive integer, got ${String(permits)}`,
    )
  }

  let available = permits
  const waiters: Array<(release: Release) => void> = []

  const makeRelease = (): Release => {
    let released = false
    return () => {
      if (released) return
      released = true
      const next = waiters.shift()
      if (next) {
        next(makeRelease())
      } else {
        available++
      }
    }
  }

  return {
    acquire(): Promise<Release> {
      if (available > 0) {
        available--
        return Promise.resolve(makeRelease())
      }
      return new Promise<Release>((resolve) => {
        waiters.push(resolve)
      })
    },
    get available(): number {
      return available
    },
  }
}
