import type { PredictionModelName, PredictionOutputs } from '@protifer/shared'
import type { InferRequest, InferResponse } from '@protifer/triton-client'

/**
 * Context passed to every adapter's buildRequest. The dispatch fan-out in
 * services/prediction-worker/src/dispatch.ts constructs this once per job after
 * up-converting the FP16-stored embedding to FP32.
 */
export interface AdapterContext {
  /** Row-major [seqLen * 1024] — worker up-converts FP16 bytes from Garage once per job. */
  embeddingFp32: Float32Array
  /** [seqLen] — 1.0 for present residues, 0.0 for padding. Single-sequence workers fill with 1.0. */
  mask: Float32Array
  /** Number of residues (derived from embedding byte length / 1024 / 2). */
  seqLen: number
  /** Original protein sequence letters — variation adapter uses this for x_axis. */
  sequence: string
}

/**
 * Per-model adapter contract. K binds the Triton response to the @protifer/shared
 * PredictionOutputs key this adapter populates — the compiler enforces one-to-one
 * adapter↔output binding.
 */
export interface ModelAdapter<
  K extends PredictionModelName = PredictionModelName,
> {
  /** Exact Triton model name — must match a directory under model-repository/. Used for ModelReady probes. */
  readonly modelName: string
  /** Which PredictionOutputs key this adapter writes (may differ from modelName; see RESEARCH table). */
  readonly outputKey: K
  /** Produce a KServe v2 InferRequest. Must use raw_input_contents. */
  buildRequest(ctx: AdapterContext): InferRequest
  /** Decode the response into the non-nullable variant of PredictionOutputs[K]. */
  decodeResponse(response: InferResponse): NonNullable<PredictionOutputs[K]>
}
