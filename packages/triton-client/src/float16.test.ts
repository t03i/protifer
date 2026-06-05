import { describe, it, expect } from 'vitest'

import { fp16BufferToFp32Array, fp32ArrayToFp16Buffer } from './float16.ts'

describe('float16', () => {
  it('round-trips special values within FP16 precision', () => {
    const inputs = [0, -0, 1.0, -1.0, 65504, 5.96e-8, Infinity, -Infinity, NaN]
    const buf = fp32ArrayToFp16Buffer(inputs)
    const result = fp16BufferToFp32Array(buf)

    expect(result.length).toBe(inputs.length)
    expect(result[0]).toBe(0)
    // Object.is distinguishes -0 from 0
    expect(Object.is(result[1], -0)).toBe(true)
    expect(result[2]).toBe(1.0)
    expect(result[3]).toBe(-1.0)
    // 65504 is FP16 max, exact
    expect(result[4]).toBe(65504)
    // 5.96e-8 is the smallest FP16 subnormal
    expect(result[5]).toBeCloseTo(5.96e-8, 10)
    expect(result[6]).toBe(Infinity)
    expect(result[7]).toBe(-Infinity)
    expect(Number.isNaN(result[8])).toBe(true)
  })

  it('throws on odd-length buffer with message matching /FP16 buffer length must be even/', () => {
    const oddBuf = Buffer.alloc(3)
    expect(() => fp16BufferToFp32Array(oddBuf)).toThrow(
      /FP16 buffer length must be even/,
    )
  })

  it('encodes FP16 1.0 as little-endian 0x3c00 (bytes: 00 3c)', async () => {
    const { setFloat16 } = await import('@petamoriken/float16')
    const ab = new ArrayBuffer(2)
    const dv = new DataView(ab)
    setFloat16(dv, 0, 1.0, true)
    const hex = Buffer.from(ab).toString('hex')
    expect(hex).toBe('003c')
  })

  it('round-trips a 1024-element random Float32Array within 1e-3 absolute tolerance', () => {
    const arr = new Float32Array(1024)
    for (let i = 0; i < 1024; i++) {
      // Use values in [-1, 1] where FP16 absolute error is well below 1e-3
      arr[i] = Math.random() * 2 - 1
    }
    const buf = fp32ArrayToFp16Buffer(arr)
    expect(buf.length).toBe(2048)
    const result = fp16BufferToFp32Array(buf)
    expect(result.length).toBe(1024)
    for (let i = 0; i < 1024; i++) {
      expect(Math.abs((result[i] ?? 0) - (arr[i] ?? 0))).toBeLessThan(1e-3)
    }
  })
})
