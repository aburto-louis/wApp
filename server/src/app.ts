import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { ZodError } from "zod"

const app = new Hono()

  // mount routes here;

  .onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status)
    }

    if (err instanceof ZodError) {
      return c.json({ error: "Validation failed", issues: err.issues }, 400)
    }

    const msg = err instanceof Error ? err.message : String(err)

    if (msg.includes("UNIQUE constraint failed")) {
      return c.json({ error: "UNIQUE constraint violation" }, 409)
    }

    if (msg.includes("FOREIGN KEY constraint failed")) {
      return c.json({ error: "FOREIGN KEY constraint violation" }, 400)
    }

    console.error(err)
    return c.json({ error: "Internal server error" }, 500)
  })

export default app
