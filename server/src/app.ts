import { Hono } from "hono"
import { HTTPException } from "hono/http-exception"
import { ZodError } from "zod"
import { toHttpError } from "./db/errors"
import { currentVersion } from "./db/migrate"
import db from "./db/sqlite"

const app = new Hono()

  .get("/health", (c) => {
    try {
      db.query("SELECT 1").get()

      return c.json({ status: "ok", migration: currentVersion(db) })
    } catch (err) {
      console.error(err)

      return c.json({ status: "unavailable" }, 503)
    }
  })

  // mount routes here;

  .onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status)
    }

    if (err instanceof ZodError) {
      return c.json({ error: "Validation failed", issues: err.issues }, 400)
    }

    // The full SQLiteError, code and all, only ever goes to the log.
    console.error(err)

    const database = toHttpError(err)

    if (database) {
      return c.json(database.body, database.status, database.headers)
    }

    return c.json({ error: "Internal server error" }, 500)
  })

export default app
