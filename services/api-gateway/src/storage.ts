import { createObjectStore } from '@protifer/shared'
import type { ObjectStore } from '@protifer/shared'

import type { Config } from './config/index.ts'

export function createGatewayStore(storage: Config['storage']): ObjectStore {
  if (storage.driver === 'filesystem') {
    return createObjectStore({ driver: 'filesystem', path: storage.path })
  }
  return createObjectStore({
    driver: 's3',
    config: {
      endpoint: storage.garageEndpoint,
      region: storage.garageRegion,
      bucket: storage.garageBucket,
      accessKeyId: storage.garageAccessKeyId,
      secretAccessKey: storage.garageSecretAccessKey,
    },
  })
}
