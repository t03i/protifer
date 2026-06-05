import { TEST_ENV } from './src/config/schema.ts'

for (const [k, v] of Object.entries(TEST_ENV)) {
  if (process.env[k] === undefined) process.env[k] = v
}
