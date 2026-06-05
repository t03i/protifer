import { describe, it, expect } from 'vitest'

import { ShapeError, DtypeError, DecodeError } from './errors.ts'

describe('ShapeError', () => {
  it('is an instance of Error', () => {
    const err = new ShapeError('bad shape')
    expect(err instanceof Error).toBe(true)
  })

  it('is an instance of ShapeError', () => {
    const err = new ShapeError('bad shape')
    expect(err instanceof ShapeError).toBe(true)
  })

  it('sets name to ShapeError', () => {
    const err = new ShapeError('bad shape')
    expect(err.name).toBe('ShapeError')
  })

  it('preserves the message', () => {
    const err = new ShapeError('expected [seqLen, 1024] got [512]')
    expect(err.message).toBe('expected [seqLen, 1024] got [512]')
  })
})

describe('DtypeError', () => {
  it('is an instance of Error', () => {
    const err = new DtypeError('wrong dtype')
    expect(err instanceof Error).toBe(true)
  })

  it('is an instance of DtypeError', () => {
    const err = new DtypeError('wrong dtype')
    expect(err instanceof DtypeError).toBe(true)
  })

  it('sets name to DtypeError', () => {
    const err = new DtypeError('wrong dtype')
    expect(err.name).toBe('DtypeError')
  })

  it('preserves the message', () => {
    const err = new DtypeError('expected FP32 got INT64')
    expect(err.message).toBe('expected FP32 got INT64')
  })
})

describe('DecodeError', () => {
  it('is an instance of Error', () => {
    const err = new DecodeError('decode failed')
    expect(err instanceof Error).toBe(true)
  })

  it('is an instance of DecodeError', () => {
    const err = new DecodeError('decode failed')
    expect(err instanceof DecodeError).toBe(true)
  })

  it('sets name to DecodeError', () => {
    const err = new DecodeError('decode failed')
    expect(err.name).toBe('DecodeError')
  })

  it('preserves the message', () => {
    const err = new DecodeError('argmax on empty slice')
    expect(err.message).toBe('argmax on empty slice')
  })
})

describe('Error class isolation', () => {
  it('ShapeError is not instanceof DtypeError', () => {
    const err = new ShapeError('shape')
    expect(err instanceof DtypeError).toBe(false)
  })

  it('DtypeError is not instanceof DecodeError', () => {
    const err = new DtypeError('dtype')
    expect(err instanceof DecodeError).toBe(false)
  })

  it('DecodeError is not instanceof ShapeError', () => {
    const err = new DecodeError('decode')
    expect(err instanceof ShapeError).toBe(false)
  })
})
