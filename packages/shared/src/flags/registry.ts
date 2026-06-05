import type { FlagDefinition, FlagRegistry, TargetingMode } from './types.ts'

export class FlagRegistryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FlagRegistryError'
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const TARGETING_MODES: readonly TargetingMode[] = [
  'global',
  'plan',
  'percentage',
]

function parseDate(name: string, field: string, value: unknown): Date {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) {
    throw new FlagRegistryError(
      `Flag "${name}": ${field} must be ISO date YYYY-MM-DD, got ${JSON.stringify(value)}`,
    )
  }
  const d = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) {
    throw new FlagRegistryError(
      `Flag "${name}": ${field} is not a valid date: ${value}`,
    )
  }
  return d
}

function validateDefinition<T>(
  name: string,
  def: FlagDefinition<T>,
  seen: Set<string>,
): void {
  if (seen.has(name)) {
    throw new FlagRegistryError(`Duplicate flag name: "${name}"`)
  }
  seen.add(name)

  if (typeof def.description !== 'string' || def.description.trim() === '') {
    throw new FlagRegistryError(
      `Flag "${name}": description is required and must be a non-empty string`,
    )
  }
  if (typeof (def.type as { safeParse?: unknown }).safeParse !== 'function') {
    throw new FlagRegistryError(`Flag "${name}": type must be a Zod schema`)
  }
  if (typeof def.owner !== 'string' || def.owner.trim() === '') {
    throw new FlagRegistryError(
      `Flag "${name}": owner is required and must be a non-empty string`,
    )
  }
  if (!TARGETING_MODES.includes(def.targeting)) {
    throw new FlagRegistryError(
      `Flag "${name}": targeting must be one of ${TARGETING_MODES.join('|')}, got "${def.targeting}"`,
    )
  }

  const created = parseDate(name, 'createdAt', def.createdAt)
  const expires = parseDate(name, 'expiresAt', def.expiresAt)
  if (expires < created) {
    throw new FlagRegistryError(
      `Flag "${name}": expiresAt (${def.expiresAt}) is earlier than createdAt (${def.createdAt})`,
    )
  }

  const parsed = def.type.safeParse(def.default)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    throw new FlagRegistryError(
      `Flag "${name}": default value fails type validation — ${issues}`,
    )
  }
}

export function defineFlags<R extends FlagRegistry>(registry: R): R {
  const seen = new Set<string>()
  for (const [name, def] of Object.entries(registry)) {
    validateDefinition(name, def, seen)
  }
  return registry
}
