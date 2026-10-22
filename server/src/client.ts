import { hc } from "hono/client"
import type app from "@server/app"

type AppType = typeof app
export type Client = ReturnType<typeof hc<AppType>>

export const hcWithType = (...args: Parameters<typeof hc>): Client =>
  hc<AppType>(...args)
