import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

const MEMORY = ":memory:"

const DEFAULT_PATH = join(import.meta.dir, "data", "db.sqlite")

function resolveDbPath(path: string): string {
  return path === MEMORY ? MEMORY : resolve(path)
}

export const DB_PATH = resolveDbPath(process.env.DB_PATH ?? DEFAULT_PATH)

export function createDatabase(path: string = DB_PATH): Database {
  const file = resolveDbPath(path)

  const persistent = file !== MEMORY
  if (persistent) mkdirSync(dirname(file), { recursive: true })

  const db = new Database(file, { create: true, strict: true })

  db.run("PRAGMA foreign_keys = ON")
  db.run("PRAGMA busy_timeout = 5000")
  db.run("PRAGMA temp_store = MEMORY")
  db.run("PRAGMA cache_size = -16000")

  if (persistent) {
    const journal = db.query("PRAGMA journal_mode = WAL").get() as {
      journal_mode: string
    } | null

    if (journal?.journal_mode !== "wal") {
      db.close(true)
      throw new Error(
        `Could not enable WAL on ${file}` +
          `journal_mode is "${journal?.journal_mode ?? "unknown"}"`
      )
    }

    db.run("PRAGMA synchronous = NORMAL")
  }

  return db
}

let instance: Database | undefined

export function getDatabase(): Database {
  instance ??= createDatabase()
  return instance
}

export function closeDatabase(): void {
  if (!instance) return

  if (instance.filename !== MEMORY) {
    instance.run("PRAGMA wal_checkpoint(TRUNCATE)")
  }

  instance.close(false)
  instance = undefined
}

export const db = new Proxy({} as Database, {
  get(_target, property) {
    const database = getDatabase()
    const value = Reflect.get(database, property) as unknown
    return typeof value === "function" ? value.bind(database) : value
  },
})
