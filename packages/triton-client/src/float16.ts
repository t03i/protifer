import { getFloat16, setFloat16 } from '@petamoriken/float16'

/** FP16 buffer of `count` identical values — fills the 2-byte pattern instead
 * of running `count` per-element conversions (mock payloads are constant). */
export function constantFp16Buffer(count: number, value: number): Buffer {
  const pattern = Buffer.alloc(2)
  setFloat16(
    new DataView(pattern.buffer, pattern.byteOffset, 2),
    0,
    value,
    true,
  )
  return Buffer.alloc(count * 2).fill(pattern)
}

export function fp16BufferToFp32Array(buf: Buffer): Float32Array {
  if (buf.length % 2 !== 0) throw new Error('FP16 buffer length must be even')
  const n = buf.length / 2
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = getFloat16(dv, i * 2, true)
  return out
}

export function fp32ArrayToFp16Buffer(arr: Float32Array | number[]): Buffer {
  const buf = Buffer.alloc(arr.length * 2)
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  for (let i = 0; i < arr.length; i++) setFloat16(dv, i * 2, arr[i] ?? 0, true)
  return buf
}
