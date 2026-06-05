import { readFileSync } from 'node:fs'

import { z } from 'zod'

import { readSecretOptional } from './secrets.ts'

export class ConfigReadError extends Error {
  constructor(name: string, path: string, cause: unknown) {
    super(
      `Failed to read config ${name} from ${path}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    )
    this.name = 'ConfigReadError'
  }
}

export class ConfigValidationError extends Error {
  constructor(public readonly issues: ConfigIssue[]) {
    const lines = issues.map(
      (i) =>
        `  • ${i.path.join('.') || '(root)'}${
          i.envName ? ` [${i.envName}]` : ''
        }: ${i.message}`,
    )
    super(`Configuration validation failed:\n${lines.join('\n')}`)
    this.name = 'ConfigValidationError'
  }
}

export interface ConfigIssue {
  path: string[]
  envName?: string
  message: string
}

/**
 * Reads a non-secret config value with env-wins precedence.
 *
 * 1. If `${name}` is set (non-empty), return the env value.
 * 2. Else if `${name}_FILE` is set, read the file (trim trailing whitespace).
 * 3. Else return `undefined` so the caller's default applies.
 *
 * Env-wins matches 12-factor / k8s / Helm layering: file is the base, env
 * is the override. Throws `ConfigReadError` when `_FILE` is set but the
 * file is unreadable — silent fallback would hide misconfiguration.
 */
export function readConfig(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const envValue = env[name]
  if (envValue !== undefined && envValue !== '') return envValue
  const filePath = env[`${name}_FILE`]
  if (filePath !== undefined && filePath !== '') {
    try {
      return readFileSync(filePath, 'utf8').replace(/\s+$/, '')
    } catch (err) {
      throw new ConfigReadError(name, filePath, err)
    }
  }
  return undefined
}

const FIELD_TAG = Symbol.for('@protifer/shared/config-field')
const SECTION_TAG = Symbol.for('@protifer/shared/config-section')

export type FieldKind = 'secret' | 'config'

export interface FieldDef<T = unknown> {
  readonly [FIELD_TAG]: true
  readonly kind: FieldKind
  readonly envName: string
  readonly description: string
  readonly zodType: z.ZodType<T>
  readonly hasDefault: boolean
  readonly defaultValue?: T
}

export interface FieldOptions<T> {
  envName: string
  description: string
  type: z.ZodType<T>
}

export interface ConfigFieldOptions<T> extends FieldOptions<T> {
  default?: T
}

export function secretField<T>(opts: FieldOptions<T>): FieldDef<T> {
  validateDescription('secretField', opts.envName, opts.description)
  return {
    [FIELD_TAG]: true,
    kind: 'secret',
    envName: opts.envName,
    description: opts.description,
    zodType: opts.type,
    hasDefault: false,
  }
}

export function configField<T>(opts: ConfigFieldOptions<T>): FieldDef<T> {
  validateDescription('configField', opts.envName, opts.description)
  return {
    [FIELD_TAG]: true,
    kind: 'config',
    envName: opts.envName,
    description: opts.description,
    zodType: opts.type,
    hasDefault: opts.default !== undefined,
    defaultValue: opts.default,
  }
}

function validateDescription(fn: string, envName: string, desc: string): void {
  if (typeof desc !== 'string' || desc.trim().length === 0) {
    throw new Error(`${fn}(${envName}): description is required and non-empty`)
  }
}

function isField(v: unknown): v is FieldDef {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as Record<symbol, unknown>)[FIELD_TAG] === true
  )
}

export interface SectionLoader<T> {
  readonly [SECTION_TAG]: true
  load(env: NodeJS.ProcessEnv): T
  describe(): FieldDoc[]
}

function isSection(v: unknown): v is SectionLoader<unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as Record<symbol, unknown>)[SECTION_TAG] === true
  )
}

/**
 * Wraps a hand-written loader (e.g. `loadSheddingConfig`) so it can be
 * embedded in a `defineConfig` tree alongside `secretField` / `configField`
 * leaves.
 */
export function customSection<T>(opts: {
  load: (env: NodeJS.ProcessEnv) => T
  /** Optional `describe()` doc output. Omit for sections that emit no field docs. */
  describe?: () => FieldDoc[]
}): SectionLoader<T> {
  return {
    [SECTION_TAG]: true,
    load: opts.load,
    describe: opts.describe ?? (() => []),
  }
}

export interface FieldDoc {
  path: string[]
  envName: string
  kind: FieldKind
  description: string
  hasDefault: boolean
  defaultRepr?: string
  typeRepr: string
}

export type ConfigTree = {
  [key: string]: FieldDef | SectionLoader<unknown> | ConfigTree
}

type InferField<F> = F extends FieldDef<infer T> ? T : never
type InferSection<S> = S extends SectionLoader<infer T> ? T : never

export type InferTree<T extends ConfigTree> = {
  [K in keyof T]: T[K] extends FieldDef
    ? InferField<T[K]>
    : T[K] extends SectionLoader<unknown>
      ? InferSection<T[K]>
      : T[K] extends ConfigTree
        ? InferTree<T[K]>
        : never
}

export interface ConfigLoader<T> {
  load(env?: NodeJS.ProcessEnv): T
  describe(): FieldDoc[]
}

/**
 * Builds a typed loader from a tree of `secretField` / `configField` / nested
 * objects / `customSection` loaders. Validates every field with its declared
 * Zod type, aggregates issues, and freezes the resulting object.
 */
export function defineConfig<T extends ConfigTree>(
  tree: T,
): ConfigLoader<InferTree<T>> {
  const docs: FieldDoc[] = []
  collectDocs(tree, [], docs)

  return {
    load(env: NodeJS.ProcessEnv = process.env): InferTree<T> {
      const issues: ConfigIssue[] = []
      const value = loadTree(tree, [], env, issues) as InferTree<T>
      if (issues.length > 0) throw new ConfigValidationError(issues)
      return deepFreeze(value)
    },
    describe(): FieldDoc[] {
      return docs.slice()
    },
  }
}

function collectDocs(tree: ConfigTree, path: string[], out: FieldDoc[]): void {
  for (const [key, val] of Object.entries(tree)) {
    const next = [...path, key]
    if (isField(val)) {
      out.push({
        path: next,
        envName: val.envName,
        kind: val.kind,
        description: val.description,
        hasDefault: val.hasDefault,
        defaultRepr: val.hasDefault ? reprDefault(val.defaultValue) : undefined,
        typeRepr: zodTypeRepr(val.zodType),
      })
    } else if (isSection(val)) {
      for (const childDoc of val.describe()) {
        out.push({ ...childDoc, path: [...next, ...childDoc.path] })
      }
    } else {
      collectDocs(val, next, out)
    }
  }
}

function loadTree(
  tree: ConfigTree,
  path: string[],
  env: NodeJS.ProcessEnv,
  issues: ConfigIssue[],
): unknown {
  const result: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(tree)) {
    const next = [...path, key]
    if (isField(val)) {
      const loaded = loadField(val, next, env, issues)
      if (loaded.ok) result[key] = loaded.value
    } else if (isSection(val)) {
      try {
        result[key] = val.load(env)
      } catch (err) {
        issues.push({
          path: next,
          message: err instanceof Error ? err.message : String(err),
        })
      }
    } else {
      result[key] = loadTree(val, next, env, issues)
    }
  }
  return result
}

function loadField(
  field: FieldDef,
  path: string[],
  env: NodeJS.ProcessEnv,
  issues: ConfigIssue[],
): { ok: true; value: unknown } | { ok: false } {
  let raw: string | undefined
  try {
    raw =
      field.kind === 'secret'
        ? readSecretOptional(field.envName, env)
        : readConfig(field.envName, env)
  } catch (err) {
    issues.push({
      path,
      envName: field.envName,
      message: err instanceof Error ? err.message : String(err),
    })
    return { ok: false }
  }

  if (raw === undefined) {
    if (field.hasDefault) return { ok: true, value: field.defaultValue }
    const result = field.zodType.safeParse(undefined)
    if (result.success) return { ok: true, value: result.data }
    const detail =
      field.kind === 'secret'
        ? `Set ${field.envName}_FILE or ${field.envName}.`
        : `Set ${field.envName} (or ${field.envName}_FILE) in the service environment.`
    issues.push({
      path,
      envName: field.envName,
      message: `Missing required ${field.kind === 'secret' ? 'secret' : 'config value'}. ${detail}`,
    })
    return { ok: false }
  }

  const result = field.zodType.safeParse(raw)
  if (!result.success) {
    issues.push({
      path,
      envName: field.envName,
      message: result.error.issues.map((i) => i.message).join('; '),
    })
    return { ok: false }
  }
  return { ok: true, value: result.data }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  for (const v of Object.values(value as object)) deepFreeze(v)
  return Object.freeze(value)
}

function reprDefault(v: unknown): string {
  if (v === undefined) return 'undefined'
  if (typeof v === 'string') return JSON.stringify(v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return '[unserializable]'
  }
}

// Zod v4 exposes a stable lowercase `def.type` tag (e.g. "string", "number",
// "enum"). Degrade to the constructor name if a future release restructures it
// — `typeRepr` is only used for generated docs.
function zodTypeRepr(t: z.ZodType): string {
  const type = (t as { def?: { type?: string } }).def?.type
  return type ?? t.constructor.name
}

/**
 * Zod helper for boolean env strings. Accepts true/false/1/0/yes/no.
 */
export const zBooleanString = z.string().transform((raw, ctx) => {
  const v = raw.trim().toLowerCase()
  if (v === 'true' || v === '1' || v === 'yes') return true
  if (v === 'false' || v === '0' || v === 'no') return false
  ctx.addIssue({
    code: 'custom',
    message: `Invalid boolean: "${raw}" (expected true/false/1/0/yes/no)`,
  })
  return z.NEVER
})

/**
 * Zod helper for comma-separated lists. Trims, drops empties.
 */
export const zCsv = z.string().transform((raw) =>
  raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0),
)
