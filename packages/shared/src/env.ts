/**
 * Reads a single environment variable by name and throws a descriptive error
 * if it is missing or empty.
 *
 * Use only when a single variable is needed outside a Zod schema context;
 * prefer `defineConfig` / `loadConfig` for bulk validation.
 */
export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Set it before starting the process.`,
    )
  }
  return value
}
