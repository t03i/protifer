import { describe, it, expect } from 'vitest'

import { createSemaphore } from './semaphore.ts'

describe('createSemaphore', () => {
  it('rejects non-positive permit counts', () => {
    expect(() => createSemaphore(0)).toThrow()
    expect(() => createSemaphore(-1)).toThrow()
    expect(() => createSemaphore(1.5)).toThrow()
  })

  it('grants up to `permits` immediately, then queues', async () => {
    const sem = createSemaphore(2)
    const r1 = await sem.acquire()
    const r2 = await sem.acquire()
    expect(sem.available).toBe(0)

    let third = false
    const p3 = sem.acquire().then((r) => {
      third = true
      return r
    })
    await Promise.resolve()
    expect(third).toBe(false)

    r1()
    const r3 = await p3
    expect(third).toBe(true)
    r2()
    r3()
    expect(sem.available).toBe(2)
  })

  it('hands a released permit to the longest-waiting acquirer (FIFO)', async () => {
    const sem = createSemaphore(1)
    const held = await sem.acquire()
    const order: number[] = []
    const a = sem.acquire().then((r) => {
      order.push(1)
      return r
    })
    const b = sem.acquire().then((r) => {
      order.push(2)
      return r
    })

    held()
    ;(await a)()
    ;(await b)()
    expect(order).toEqual([1, 2])
  })

  it('is idempotent: releasing twice does not over-credit permits', async () => {
    const sem = createSemaphore(1)
    const r = await sem.acquire()
    r()
    r()
    expect(sem.available).toBe(1)
  })
})
