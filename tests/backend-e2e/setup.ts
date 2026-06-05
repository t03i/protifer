import { execSync } from 'node:child_process'

const COMPOSE_FILE = 'infra/docker-compose.test.yml'
const PROJECT_NAME = 'protifer-test'

let weStartedStack = false

export async function setup() {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)
    const res = await fetch('http://localhost:13001/health', {
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (res.ok) {
      console.log('Test stack already running, skipping compose up')
      return
    }
  } catch {
    // Stack not running — start it
  }

  console.log('Starting test stack...')
  execSync(
    `docker compose -f ${COMPOSE_FILE} -p ${PROJECT_NAME} up -d --build --wait --wait-timeout 120`,
    { stdio: 'inherit', timeout: 180_000 },
  )
  weStartedStack = true
  console.log('Test stack ready')
}

export async function teardown() {
  if (!weStartedStack) {
    console.log('Stack was pre-existing, skipping teardown')
    return
  }

  console.log('Tearing down test stack...')
  execSync(`docker compose -f ${COMPOSE_FILE} -p ${PROJECT_NAME} down -v`, {
    stdio: 'inherit',
    timeout: 60_000,
  })
}
