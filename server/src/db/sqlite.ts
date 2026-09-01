import { Database } from "bun:sqlite"
import { join } from "node:path"
import { runMigrations } from "./migrate"

const db = new Database(join(import.meta.dir, "data", "db.sqlite"), {
  create: true,
})
db.run("PRAGMA journal_mode = WAL;")
db.run("PRAGMA foreign_keys = ON;")
runMigrations(db)

export default db
