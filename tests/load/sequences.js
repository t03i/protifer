// Shared helpers for the k6 load scripts. Run by the k6 Go binary only.
// See README.md for why this directory is intentionally not a Bun workspace package.

const AMINO_ACIDS = 'ACDEFGHIKLMNPQRSTVWY'

// Build a unique, valid amino-acid sequence of the given length.
// Unique inputs are required because prediction/embedding results are stored
// hash-keyed and immutable in S3: a fixed sequence becomes a permanent cache hit
// after its first run, so it would exercise the cache path instead of real Triton
// inference. Randomising residues guarantees a cache miss on every request.
export function randomSequence(length) {
  let seq = ''
  for (let i = 0; i < length; i++) {
    seq += AMINO_ACIDS[Math.floor(Math.random() * AMINO_ACIDS.length)]
  }
  return seq
}

// Weighted sequence-length buckets approximating real single-chain submissions
// while deliberately including long sequences — GPU/Triton cost scales with
// residue count, so a realistic mix is needed to measure true compute latency.
// Max stays under the 4096 MAX_SEQUENCE_LENGTH ceiling.
const LENGTH_BUCKETS = [
  { min: 150, max: 400, weight: 0.6 }, // typical single-chain protein
  { min: 400, max: 1024, weight: 0.25 }, // large globular
  { min: 1024, max: 3500, weight: 0.15 }, // long, bracketing the ceiling
]

// Sample a sequence length from the weighted distribution above.
export function sampleLength() {
  const r = Math.random()
  let cumulative = 0
  for (const bucket of LENGTH_BUCKETS) {
    cumulative += bucket.weight
    if (r <= cumulative) {
      return (
        bucket.min + Math.floor(Math.random() * (bucket.max - bucket.min + 1))
      )
    }
  }
  // Floating-point guard: the weights sum to 1, but round-off can leave r just
  // above the final cumulative — fall back to the last bucket's max.
  return LENGTH_BUCKETS[LENGTH_BUCKETS.length - 1].max
}
