import { afterEach, describe, expect, it, vi } from 'vitest'

import { logger, setLogger } from './logger'
import type { Logger } from './logger'

function mockLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

afterEach(() => {
  setLogger({ info: console.info, warn: console.warn, error: console.error })
})

describe('logger', () => {
  it('delegates info to injected implementation', () => {
    const mock = mockLogger()
    setLogger(mock)
    logger.info('hello', { key: 'value' })
    expect(mock.info).toHaveBeenCalledWith('hello', { key: 'value' })
  })

  it('delegates warn to injected implementation', () => {
    const mock = mockLogger()
    setLogger(mock)
    logger.warn('watch out')
    expect(mock.warn).toHaveBeenCalledWith('watch out', undefined)
  })

  it('delegates error to injected implementation', () => {
    const mock = mockLogger()
    const err = new Error('boom')
    setLogger(mock)
    logger.error('failed', err, { seq: 'MTEYK' })
    expect(mock.error).toHaveBeenCalledWith('failed', err, { seq: 'MTEYK' })
  })

  it('setLogger swap takes effect immediately on existing import', () => {
    const first = mockLogger()
    const second = mockLogger()
    setLogger(first)
    logger.info('via first')
    setLogger(second)
    logger.info('via second')
    expect(first.info).toHaveBeenCalledTimes(1)
    expect(second.info).toHaveBeenCalledTimes(1)
  })
})
