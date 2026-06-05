import type { InferResponse } from './client.ts'

/** Read FP32 output tensor preferring raw_output_contents (KServe v2 default) with fallback to contents.fp32_contents. */
export function readFp32Output(
  response: InferResponse,
  idx: number,
): Float32Array {
  const raw = response.raw_output_contents[idx]
  if (raw && raw.length > 0) {
    if (raw.length % 4 !== 0) {
      throw new Error(
        `raw_output_contents[${String(idx)}] length ${String(raw.length)} is not a multiple of 4 (FP32)`,
      )
    }
    // Copy to a fresh typed array to avoid alias-sharing the underlying ArrayBuffer.
    const n = raw.length / 4
    const out = new Float32Array(n)
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
    for (let i = 0; i < n; i++) out[i] = dv.getFloat32(i * 4, true)
    return out
  }
  const fp32 = response.outputs[idx]?.contents.fp32_contents
  return fp32 && fp32.length > 0 ? Float32Array.from(fp32) : new Float32Array(0)
}

/** Split concatenated BYTES tensor into its individual payload buffers (KServe v2 length-prefix layout). */
export function readBytesTensor(raw: Buffer): Buffer[] {
  const out: Buffer[] = []
  let off = 0
  while (off < raw.length) {
    if (off + 4 > raw.length) {
      throw new Error(
        `readBytesTensor: truncated length prefix at offset ${String(off)}`,
      )
    }
    const len = raw.readUInt32LE(off)
    off += 4
    if (off + len > raw.length) {
      throw new Error(
        `readBytesTensor: truncated payload — need ${String(len)} bytes at offset ${String(off)}, have ${String(raw.length - off)}`,
      )
    }
    out.push(raw.subarray(off, off + len))
    off += len
  }
  return out
}

/** Helper: read an output as a raw Buffer (for BYTES tensors), preferring raw_output_contents. */
export function readInferOutputBuffer(
  response: InferResponse,
  idx: number,
): Buffer {
  const raw = response.raw_output_contents[idx]
  if (raw && raw.length > 0) return raw
  const bytes = response.outputs[idx]?.contents.bytes_contents
  if (bytes && bytes.length > 0) {
    // Synthesize KServe v2 length-prefixed layout from the legacy contents array.
    const parts: Buffer[] = []
    for (const b of bytes) {
      const hdr = Buffer.alloc(4)
      hdr.writeUInt32LE(b.length, 0)
      parts.push(hdr, b)
    }
    return Buffer.concat(parts)
  }
  return Buffer.alloc(0)
}
