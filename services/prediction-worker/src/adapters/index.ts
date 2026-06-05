import { bindEmbedAdapter } from './bind_embed.ts'
import { lightAttentionMembraneAdapter } from './light_attention_membrane.ts'
import { lightAttentionSubcellAdapter } from './light_attention_subcell.ts'
import { prott5ConsAdapter } from './prott5_cons.ts'
import { prott5SecAdapter } from './prott5_sec.ts'
import { sethAdapter } from './seth.ts'
import { tmbedAdapter } from './tmbed.ts'
import { vespagAdapter } from './vespag.ts'

export {
  vespagAdapter,
  tmbedAdapter,
  sethAdapter,
  bindEmbedAdapter,
  prott5ConsAdapter,
  prott5SecAdapter,
  lightAttentionMembraneAdapter,
  lightAttentionSubcellAdapter,
}

export type { ModelAdapter, AdapterContext } from './types.ts'
export { ShapeError, DtypeError, DecodeError } from './errors.ts'

/**
 * Triton model name → adapter. Iterated by dispatch.ts for fan-out.
 * Key = Triton model_name (must match a directory under model-repository/).
 * Each adapter's `outputKey` maps to the PredictionOutputs slice it populates.
 *
 * Note: prot_t5_pipeline is the embedding pipeline, handled by the embedding worker.
 */
export const ADAPTER_REGISTRY = {
  prott5_sec: prott5SecAdapter,
  tmbed: tmbedAdapter,
  seth: sethAdapter,
  bind_embed: bindEmbedAdapter,
  prott5_cons: prott5ConsAdapter,
  vespag: vespagAdapter,
  light_attention_subcell: lightAttentionSubcellAdapter,
  light_attention_membrane: lightAttentionMembraneAdapter,
} as const

export type AdapterRegistry = typeof ADAPTER_REGISTRY
export type TritonModelName = keyof AdapterRegistry
