import { SQLiteError, type Database } from "bun:sqlite"
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
    const code = sqlite?.code ? ` [${sqlite.code}] ` : ""

    super(`Migration ${migration.file} failed ${code}: ${reason}`, { cause })

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
      `Invalid migration filename: ${file} — expected NNN_name.sql`
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

  const migrations = entries
    .filter((entry) => entry.endsWith(".sql"))
    .map((file) => read(dir, file))
    .sort((a, b) => a.version - b.version)

  const seen = new Map<number, string>()

  for (const migration of migrations) {
    const clash = seen.get(migration.version)

    if (clash) {
      throw new Error(
        `Duplicate migration version ${migration.version}: ` +
          `${clash} & ${migration.file}`
      )
    }

    seen.set(migration.version, migration.file)
  }

  return migrations
}

function ensureMigrationsTable(db: Database) {
  db.run(
    `
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INTEGER PRIMARY KEY,
      name        TEXT    NOT NULL,
      checksum    TEXT    NOT NULL,
      applied_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      duration_ms INTEGER NOT NULL
    ) STRICT
    `
  )
}

function appliedMigrations(db: Database): AppliedMigration[] {
  return db
    .query(
      `
      SELECT version, name, checksum, applied_at, duration_ms
      FROM schema_migrations
      ORDER BY version
      `
    )
    .all() as AppliedMigration[]
}

function pendingFrom(db: Database, migrations: Migration[]): Migration[] {
  const applied = appliedMigrations(db)
  const migrationByVersion = new Map(migrations.map((m) => [m.version, m]))

  for (const row of applied) {
    const migration = migrationByVersion.get(row.version)

    if (!migration) {
      throw new Error(`Migration ${row.version} (${row.name}) file is missing`)
    }

    if (migration.checksum !== row.checksum) {
      throw new Error(
        `Migration ${migration.file} changed after it was applied`
      )
    }
  }

  const done = new Set(applied.map((row) => row.version))
  const pending = migrations.filter((m) => !done.has(m.version))
  const latest = applied.at(-1)?.version ?? 0

  for (const migration of pending) {
    if (migration.version < latest) {
      throw new Error(
        `Migration ${migration.file} is numbered below the latest applied`
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
    `
    INSERT INTO schema_migrations (version, name, checksum, duration_ms)
    VALUES (?, ?, ?, ?)
    `,
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

export function runMigrations(
  db: Database,
  dir: string = MIGRATIONS_DIR
): number[] {
  ensureMigrationsTable(db)

  const migrations = loadMigrations(dir)

  if (pendingFrom(db, migrations).length === 0) return []

  const enforcing = foreignKeysEnabled(db)
  if (enforcing) db.run("PRAGMA foreign_keys = OFF")

  let ran: Migration[] = []

  try {
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

      console.log(`Database ${DB_PATH}`)
      console.log(`Current  ${current ?? "none"}`)

      for (const row of applied) {
        console.log(`Applied ${row.version} ${row.name} (${row.duration_ms}ms)`)
      }

      for (const migration of pending) {
        console.log(`Pending  ${migration.version} ${migration.name}`)
      }
    } else {
      const ran = runMigrations(db)

      console.log(
        ran.length === 0
          ? "No pending migrations"
          : `Applied migrations: ${ran.join(", ")}`
      )
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  } finally {
    db.close(false)
  }
}
