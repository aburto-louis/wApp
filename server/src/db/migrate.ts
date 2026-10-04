import { type Database, SQLiteError } from "bun:sqlite"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { createDatabase, DB_PATH } from "./sqlite"

const MIGRATIONS_DIR = join(import.meta.dir, "migrations")
const FILENAME = /^(\d{3,})_([a-z0-9_]+)\.sql$/

export type Migration = {
  version: number
  name: string
  file: string
  sql: string
  checksum: string
}

export type AppliedMigration = {
  version: number
  name: string
  checksum: string
  applied_at: number
  duration_ms: number
}

export type MigrationStatus = {
  current: number | null
  applied: AppliedMigration[]
  pending: Migration[]
}

export class MigrationError extends Error {
  version: number
  file: string
  code: string | undefined

  constructor(migration: Migration, cause: unknown) {
    const sqlite = cause instanceof SQLiteError ? cause : undefined
    const reason = cause instanceof Error ? cause.message : String(cause)
    const code = sqlite?.code ? ` [${sqlite.code}]` : ""

    // No line number: SQLite's byteOffset is relative to the statement that
    // failed, and a migration file may hold several. Its message names the
    // offending token instead.
    super(`Migration ${migration.file} failed${code}: ${reason}`, { cause })

    this.name = "MigrationError"
    this.version = migration.version
    this.file = migration.file
    this.code = sqlite?.code
  }
}

function read(dir: string, file: string): Migration {
  const [, version, name] = FILENAME.exec(file) ?? []

  if (!version || !name) {
    throw new Error(
      `Invalid migration filename: ${file} — expected NNN_name.sql, with a ` +
        "version of at least three digits and a snake_case name"
    )
  }

  const sql = readFileSync(join(dir, file), "utf8")

  if (sql.trim().length === 0) {
    throw new Error(`Migration ${file} is empty`)
  }

  return {
    version: Number(version),
    name,
    file,
    sql,
    checksum: new Bun.CryptoHasher("sha256").update(sql).digest("hex"),
  }
}

export function loadMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  let entries: string[]

  try {
    entries = readdirSync(dir)
  } catch (cause) {
    throw new Error(`Cannot read the migrations directory: ${dir}`, { cause })
  }

  // Sorted numerically: a lexical sort puts 010 before 002.
  const migrations = entries
    .filter((entry) => entry.endsWith(".sql"))
    .map((file) => read(dir, file))
    .sort((a, b) => a.version - b.version)

  const seen = new Map<number, string>()

  for (const migration of migrations) {
    const clash = seen.get(migration.version)

    if (clash) {
      throw new Error(
        `Two migrations share version ${migration.version}: ` +
          `${clash} and ${migration.file}`
      )
    }

    seen.set(migration.version, migration.file)
  }

  return migrations
}

function ensureMigrationsTable(db: Database) {
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INTEGER PRIMARY KEY,
      name        TEXT    NOT NULL,
      checksum    TEXT    NOT NULL,
      applied_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      duration_ms INTEGER NOT NULL
    ) STRICT
  `)
}

function appliedMigrations(db: Database): AppliedMigration[] {
  return db
    .query(
      `SELECT version, name, checksum, applied_at, duration_ms
       FROM schema_migrations
       ORDER BY version`
    )
    .all() as AppliedMigration[]
}

/**
 * Returns what is left to apply, refusing to proceed if the recorded history
 * and the files on disk have diverged.
 */
function pendingFrom(db: Database, migrations: Migration[]): Migration[] {
  const applied = appliedMigrations(db)
  const byVersion = new Map(migrations.map((m) => [m.version, m]))

  for (const row of applied) {
    const migration = byVersion.get(row.version)

    if (!migration) {
      throw new Error(
        `Migration ${row.version} (${row.name}) is recorded as applied but ` +
          "its file is gone. Restore the file or reset the database."
      )
    }

    if (migration.checksum !== row.checksum) {
      throw new Error(
        `Migration ${migration.file} changed after it was applied. Applied ` +
          "migrations are immutable — correct course with a new one."
      )
    }
  }

  const done = new Set(applied.map((row) => row.version))
  const pending = migrations.filter((m) => !done.has(m.version))
  const latest = applied.at(-1)?.version ?? 0

  for (const migration of pending) {
    if (migration.version < latest) {
      throw new Error(
        `Migration ${migration.file} is numbered below the latest applied ` +
          `migration (${latest}). Renumber it above ${latest} so every ` +
          "database converges on the same schema."
      )
    }
  }

  return pending
}

function apply(db: Database, migration: Migration) {
  const started = Bun.nanoseconds()

  try {
    db.run(migration.sql)
  } catch (cause) {
    throw new MigrationError(migration, cause)
  }

  db.run(
    `INSERT INTO schema_migrations (version, name, checksum, duration_ms)
     VALUES (?, ?, ?, ?)`,
    [
      migration.version,
      migration.name,
      migration.checksum,
      Math.round((Bun.nanoseconds() - started) / 1e6),
    ]
  )
}

function assertForeignKeysIntact(db: Database) {
  const violations = db.query("PRAGMA foreign_key_check").all()

  if (violations.length > 0) {
    throw new Error(
      `Migrations left ${violations.length} foreign key violation(s): ` +
        JSON.stringify(violations)
    )
  }
}

/**
 * Applies every pending migration in one transaction, returning the versions
 * that ran. Either all of them land or none do.
 */
export function runMigrations(
  db: Database,
  dir: string = MIGRATIONS_DIR
): number[] {
  ensureMigrationsTable(db)

  const migrations = loadMigrations(dir)

  if (pendingFrom(db, migrations).length === 0) return []

  // A table rebuild needs foreign keys off, and the pragma is a silent no-op
  // inside a transaction, so the toggle has to wrap BEGIN rather than sit in it.
  const enforcing = foreignKeysEnabled(db)
  if (enforcing) db.run("PRAGMA foreign_keys = OFF")

  let ran: Migration[] = []

  try {
    // IMMEDIATE takes the write lock up front, so a second process booting at
    // the same time waits on busy_timeout instead of racing us.
    db.transaction(() => {
      ran = pendingFrom(db, migrations)

      for (const migration of ran) apply(db, migration)

      if (enforcing) assertForeignKeysIntact(db)
    }).immediate()
  } finally {
    if (enforcing) db.run("PRAGMA foreign_keys = ON")
  }

  return ran.map((migration) => migration.version)
}

function foreignKeysEnabled(db: Database): boolean {
  const row = db.query("PRAGMA foreign_keys").get() as {
    foreign_keys: number
  } | null

  return row?.foreign_keys === 1
}

export function pendingMigrations(
  db: Database,
  dir: string = MIGRATIONS_DIR
): number[] {
  ensureMigrationsTable(db)

  return pendingFrom(db, loadMigrations(dir)).map(({ version }) => version)
}

export function migrationStatus(
  db: Database,
  dir: string = MIGRATIONS_DIR
): MigrationStatus {
  ensureMigrationsTable(db)

  const pending = pendingFrom(db, loadMigrations(dir))
  const applied = appliedMigrations(db)

  return { current: applied.at(-1)?.version ?? null, applied, pending }
}

/** The cheap half of `migrationStatus`, for hot paths like health checks. */
export function currentVersion(db: Database): number | null {
  ensureMigrationsTable(db)

  const row = db
    .query("SELECT max(version) AS version FROM schema_migrations")
    .get() as { version: number | null } | null

  return row?.version ?? null
}

if (import.meta.main) {
  const db = createDatabase()

  try {
    if (process.argv.includes("--status")) {
      const { current, applied, pending } = migrationStatus(db)

      console.log(`database ${DB_PATH}`)
      console.log(`current  ${current ?? "none"}`)

      for (const row of applied) {
        console.log(
          `  applied  ${row.version} ${row.name} (${row.duration_ms}ms)`
        )
      }

      for (const migration of pending) {
        console.log(`  pending  ${migration.version} ${migration.name}`)
      }
    } else {
      const ran = runMigrations(db)

      console.log(
        ran.length === 0
          ? "No pending migrations."
          : `Applied migrations: ${ran.join(", ")}`
      )
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  } finally {
    db.close(false)
  }
}
