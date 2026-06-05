import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

import type { Logger } from 'pino'

import type { EmbeddingModelConfig, PredictionModelVersion } from './types.ts'

export interface CorrelationContext {
  requestId: string
  traceId: string
  spanId: string
  userId?: string
  authMethod?: 'api-key' | 'session'
}

const als = new AsyncLocalStorage<CorrelationContext>()

export function runWithCorrelation<T>(ctx: CorrelationContext, fn: () => T): T {
  return als.run(ctx, fn)
}

export function getCorrelation(): CorrelationContext | undefined {
  return als.getStore()
}

export function pinoCorrelationMixin(): () =>
  | CorrelationContext
  | Record<string, never> {
  return () => als.getStore() ?? {}
}

export function mintRequestId(): string {
  return randomUUID().replaceAll('-', '')
}

export interface SubmissionLogPayload {
  userId: string
  sequenceHash: string
  seqLen: number
  embeddingModel: EmbeddingModelConfig
  predictionModels: PredictionModelVersion[]
  submittedAt: string
}

export function logSubmission(
  logger: Logger,
  payload: SubmissionLogPayload,
): void {
  logger.info(payload, 'submission')
}
