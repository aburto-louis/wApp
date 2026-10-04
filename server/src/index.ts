import app from "./app"
import { pendingMigrations, runMigrations } from "./db/migrate"
import db, { closeDatabase } from "./db/sqlite"

const port = Number(process.env.PORT ?? 3000)

try {
  if (process.env.NODE_ENV === "production") {
    const pending = pendingMigrations(db)

    if (pending.length > 0) {
      throw new Error(
        `${pending.length} pending migration(s): ${pending.join(", ")}. ` +
          "Run `bun run db:migrate` first."
      )
    }
  } else {
    const ran = runMigrations(db)

    if (ran.length > 0) console.log(`Applied migrations: ${ran.join(", ")}`)
  }
} catch (error) {
  console.error(
    `Refusing to boot — ${error instanceof Error ? error.message : error}`
  )
  process.exit(1)
}

const server = Bun.serve({ port, fetch: app.fetch })

console.log(`000 server listening on ${server.url}`)

async function shutdown() {
  await server.stop()
  closeDatabase()
  process.exit(0)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
