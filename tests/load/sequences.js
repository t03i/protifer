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
