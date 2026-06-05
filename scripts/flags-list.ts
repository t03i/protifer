#!/usr/bin/env bun
import {
  FLAG_REGISTRY,
  InMemoryFlagOverrideStore,
  FlagsProvider,
} from '@protifer/shared'
import type { Plan } from '@protifer/shared'

interface Args {
  userId?: string
  plan?: Plan
}

function parseArgs(): Args {
  const args: Args = {}
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--user' && argv[i + 1]) {
      args.userId = argv[++i]
    } else if (a === '--plan' && argv[i + 1]) {
      const p = argv[++i]
      if (p === 'free' || p === 'pro' || p === 'enterprise') args.plan = p
    }
  }
  return args
}

const { userId, plan } = parseArgs()
const provider = new FlagsProvider({
  registry: FLAG_REGISTRY,
  store: new InMemoryFlagOverrideStore(),
})

console.log(
  `Resolved flags${userId ? ` for user=${userId}` : ''}${plan ? ` plan=${plan}` : ''}:`,
)
for (const [name, def] of Object.entries(FLAG_REGISTRY)) {
  const ctx = { userId, plan }
  let value: unknown
  if (typeof def.default === 'boolean') {
    value = (
      await provider.resolveBooleanEvaluation(name, def.default as boolean, ctx)
    ).value
  } else if (typeof def.default === 'string') {
    value = (
      await provider.resolveStringEvaluation(name, def.default as string, ctx)
    ).value
  } else if (typeof def.default === 'number') {
    value = (
      await provider.resolveNumberEvaluation(name, def.default as number, ctx)
    ).value
  } else {
    value = def.default
  }
  console.log(
    `  ${name.padEnd(28)} default=${JSON.stringify(def.default)}  resolved=${JSON.stringify(value)}  (${def.targeting})`,
  )
}
