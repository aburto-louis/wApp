import { hc } from "hono/client"
import type app from "./app"

export type { ClientResponse } from "hono/client"

export type Client = ReturnType<typeof hc<typeof app>>

export const hcWithType = (...args: Parameters<typeof hc>): Client =>
  hc<typeof app>(...args)
