import { Database } from "bun:sqlite"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const MIGRATIONS_DIR = join(import.meta.dir, "migrations")

type Migration = {
  version: number
  name: string
  sql: string
}

function loadMigrations(): Migration[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()

  return files.map((file) => {
    const match = /^(\d+)_(.+)\.sql$/.exec(file)
    const versionRaw = match?.[1]
    const name = match?.[2]

    if (!versionRaw || !name) {
      throw new Error(
        `Invalid migration filename: ${file} (expected NNN_name.sql)`
      )
    }

    return {
      version: Number(versionRaw),
      name,
      sql: readFileSync(join(MIGRATIONS_DIR, file), "utf8"),
    }
  })
}

function ensureMigrationsTable(db: Database) {
  db.run(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version    INTEGER PRIMARY KEY,
			name       TEXT NOT NULL,
			applied_at INTEGER NOT NULL DEFAULT (unixepoch())
		) STRICT
	`)
}

function getAppliedVersions(db: Database): Set<number> {
  const rows = db.query("SELECT version FROM schema_migrations").all() as {
    version: number
  }[]

  return new Set(rows.map((row) => row.version))
}

export function runMigrations(db: Database): number[] {
  ensureMigrationsTable(db)

  const applied = getAppliedVersions(db)
  const migrations = loadMigrations()
  const ran: number[] = []

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue

    db.transaction(() => {
      db.run(migration.sql)
      db.run("INSERT INTO schema_migrations (version, name) VALUES (?, ?)", [
        migration.version,
        migration.name,
      ])
    })()

    ran.push(migration.version)
  }

  return ran
}

if (import.meta.main) {
  const dbPath = join(import.meta.dir, "data", "db.sqlite")
  const db = new Database(dbPath, { create: true })

  db.run("PRAGMA journal_mode = WAL;")
  db.run("PRAGMA foreign_keys = ON;")

  const ran = runMigrations(db)

  if (ran.length === 0) {
    console.log("No pending migrations.")
  } else {
    console.log(`Applied migrations: ${ran.join(", ")}`)
  }

  db.close()
}
