export interface SequenceDescriptor {
  sequenceHash: string
  seqLen: number
}

/**
 * Browser SHA-256 hex of a sequence. MUST stay byte-identical to the backend
 * `computeSequenceHash` (`packages/shared/src/hash.ts`) — the same join key the
 * submission log and the Garage cache key use. Enforced by the parity test.
 */
export async function computeSequenceHash(sequence: string): Promise<string> {
  const bytes = new TextEncoder().encode(sequence)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Privacy-safe descriptor attached to sequence-input errors — never residues. */
export async function describeSequence(
  sequence: string,
): Promise<SequenceDescriptor> {
  return {
    sequenceHash: await computeSequenceHash(sequence),
    seqLen: sequence.length,
  }
}
