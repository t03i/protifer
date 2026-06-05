import { describe, it, expect } from 'vitest'

import type { InferResponse } from './client.ts'
import {
  readFp32Output,
  readBytesTensor,
  readInferOutputBuffer,
} from './tensor-io.ts'

function makeFp32RawBuffer(values: number[]): Buffer {
  const buf = Buffer.allocUnsafe(values.length * 4)
  for (let i = 0; i < values.length; i++)
    buf.writeFloatLE(values[i] ?? 0, i * 4)
  return buf
}

function makeResponse(overrides: Partial<InferResponse> = {}): InferResponse {
  return {
    model_name: 'test',
    outputs: [],
    raw_output_contents: [],
    ...overrides,
  }
}

describe('readFp32Output', () => {
  it('reads from raw_output_contents when non-empty', () => {
    const values = [1.0, 2.0, 3.0]
    const raw = makeFp32RawBuffer(values)
    const response = makeResponse({
      outputs: [
        {
          name: 'out',
          datatype: 'FP32',
          shape: [3],
          contents: {
            fp32_contents: [],
            bytes_contents: [],
            int64_contents: [],
          },
        },
      ],
      raw_output_contents: [raw],
    })
    const result = readFp32Output(response, 0)
    expect(result).toBeInstanceOf(Float32Array)
    expect(result.length).toBe(3)
    expect(result[0]).toBeCloseTo(1.0, 5)
    expect(result[1]).toBeCloseTo(2.0, 5)
    expect(result[2]).toBeCloseTo(3.0, 5)
  })

  it('falls back to contents.fp32_contents when raw_output_contents is empty', () => {
    const response = makeResponse({
      outputs: [
        {
          name: 'out',
          datatype: 'FP32',
          shape: [3],
          contents: {
            fp32_contents: [4.0, 5.0, 6.0],
            bytes_contents: [],
            int64_contents: [],
          },
        },
      ],
      raw_output_contents: [Buffer.alloc(0)],
    })
    const result = readFp32Output(response, 0)
    expect(result).toBeInstanceOf(Float32Array)
    expect(result.length).toBe(3)
    expect(result[0]).toBeCloseTo(4.0, 5)
    expect(result[1]).toBeCloseTo(5.0, 5)
    expect(result[2]).toBeCloseTo(6.0, 5)
  })

  it('returns zero-length Float32Array when both sources are empty', () => {
    const response = makeResponse({
      outputs: [
        {
          name: 'out',
          datatype: 'FP32',
          shape: [0],
          contents: {
            fp32_contents: [],
            bytes_contents: [],
            int64_contents: [],
          },
        },
      ],
      raw_output_contents: [],
    })
    const result = readFp32Output(response, 0)
    expect(result).toBeInstanceOf(Float32Array)
    expect(result.length).toBe(0)
  })
})

describe('readBytesTensor', () => {
  function lenLE(n: number): Buffer {
    const b = Buffer.alloc(4)
    b.writeUInt32LE(n, 0)
    return b
  }

  it('splits two length-prefixed entries correctly', () => {
    const hello = Buffer.from('hello')
    const world = Buffer.from('world')
    const raw = Buffer.concat([lenLE(5), hello, lenLE(5), world])
    const result = readBytesTensor(raw)
    expect(result.length).toBe(2)
    expect(result.at(0)?.toString('utf8')).toBe('hello')
    expect(result.at(1)?.toString('utf8')).toBe('world')
  })

  it('returns empty array for empty buffer', () => {
    expect(readBytesTensor(Buffer.alloc(0))).toEqual([])
  })

  it('throws on truncated length prefix', () => {
    const truncated = Buffer.alloc(2) // only 2 bytes, need 4 for length prefix
    expect(() => readBytesTensor(truncated)).toThrow(/truncated|malformed/)
  })

  it('throws on truncated payload', () => {
    const buf = Buffer.concat([Buffer.from([5, 0, 0, 0]), Buffer.from('hi')]) // claims 5 bytes but only 2 present
    expect(() => readBytesTensor(buf)).toThrow(/truncated|malformed/)
  })
})

describe('readInferOutputBuffer', () => {
  it('returns raw_output_contents buffer when non-empty', () => {
    const raw = Buffer.from('rawdata')
    const response = makeResponse({
      outputs: [
        {
          name: 'out',
          datatype: 'BYTES',
          shape: [1],
          contents: {
            fp32_contents: [],
            bytes_contents: [],
            int64_contents: [],
          },
        },
      ],
      raw_output_contents: [raw],
    })
    const result = readInferOutputBuffer(response, 0)
    expect(result.equals(raw)).toBe(true)
  })
})
