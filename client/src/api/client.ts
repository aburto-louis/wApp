import { hcWithType, type Client } from "server"

export const client: Client = hcWithType("/api")
