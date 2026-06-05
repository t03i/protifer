import { createBullBoard } from '@bull-board/api'
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter'
import type { IServerAdapter } from '@bull-board/api/typings/app'
import { HonoAdapter } from '@bull-board/hono'
import type { Queue } from '@protifer/shared'
import type { MiddlewareHandler } from 'hono'

export function createBullBoardRouter(
  queues: Queue[],
  serveStatic: (options: { root: string }) => MiddlewareHandler,
) {
  const serverAdapter = new HonoAdapter(serveStatic)
  serverAdapter.setBasePath('/admin/queues')

  createBullBoard({
    queues: queues.map((q) => new BullMQAdapter(q)),
    serverAdapter: serverAdapter as unknown as IServerAdapter,
  })

  return serverAdapter.registerPlugin()
}
