import type { Database } from "bun:sqlite"
import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  currentVersion,
  loadMigrations,
  MigrationError,
  migrationStatus,
  pendingMigrations,
  runMigrations,
} from "./migrate"
import { createDatabase } from "./sqlite"

let dir: string
let db: Database

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wapp-migrate-"))
  db = createDatabase(":memory:")
})

afterEach(() => {
  db.close(false)
  rmSync(dir, { recursive: true, force: true })
})

function write(file: string, sql: string) {
  writeFileSync(join(dir, file), sql)
}

function tables(): string[] {
  const rows = db
    .query(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name <> 'schema_migrations'
       ORDER BY name`
    )
    .all() as { name: string }[]

  return rows.map((row) => row.name)
}

test("applies pending migrations and records them", () => {
  write("001_users.sql", "CREATE TABLE users (id INTEGER PRIMARY KEY) STRICT;")

  expect(runMigrations(db, dir)).toEqual([1])
  expect(tables()).toEqual(["users"])

  const [applied] = migrationStatus(db, dir).applied

  expect(applied?.version).toBe(1)
  expect(applied?.name).toBe("users")
  expect(applied?.checksum).toHaveLength(64)
  expect(applied?.duration_ms).toBeGreaterThanOrEqual(0)
})

test("re-running applies nothing", () => {
  write("001_users.sql", "CREATE TABLE users (id INTEGER PRIMARY KEY) STRICT;")

  runMigrations(db, dir)

  expect(runMigrations(db, dir)).toEqual([])
  expect(pendingMigrations(db, dir)).toEqual([])
})

test("orders by version number rather than filename", () => {
  // Lexically 010 sorts before 002, so this only works under a numeric sort.
  write("002_users.sql", "CREATE TABLE users (id INTEGER PRIMARY KEY) STRICT;")
  write("010_email.sql", "ALTER TABLE users ADD COLUMN email TEXT;")

  expect(runMigrations(db, dir)).toEqual([2, 10])
  expect(loadMigrations(dir).map((m) => m.version)).toEqual([2, 10])
})

test("runs several statements from one file", () => {
  write(
    "001_schema.sql",
    `CREATE TABLE users (id INTEGER PRIMARY KEY) STRICT;
     CREATE TABLE posts (id INTEGER PRIMARY KEY) STRICT;`
  )

  runMigrations(db, dir)

  expect(tables()).toEqual(["posts", "users"])
})

test("rolls the whole batch back when one migration fails", () => {
  write("001_users.sql", "CREATE TABLE users (id INTEGER PRIMARY KEY) STRICT;")
  write("002_broken.sql", "CREATE TABLE users (id INTEGER PRIMARY KEY) STRICT;")

  expect(() => runMigrations(db, dir)).toThrow(MigrationError)

  expect(tables()).toEqual([])
  expect(currentVersion(db)).toBeNull()
})

test("names the file, version and cause of a failure", () => {
  write(
    "001_broken.sql",
    "CREATE TABLE users (id INTEGER PRIMARY KEY);\nSELEC 1;"
  )

  try {
    runMigrations(db, dir)
    throw new Error("expected the migration to fail")
  } catch (error) {
    expect(error).toBeInstanceOf(MigrationError)

    const failure = error as MigrationError

    expect(failure.file).toBe("001_broken.sql")
    expect(failure.version).toBe(1)
    expect(failure.code).toBe("SQLITE_ERROR")
    expect(failure.message).toContain('near "SELEC"')
    expect(failure.cause).toBeDefined()
  }
})

test("refuses to run when an applied migration was edited", () => {
  write("001_users.sql", "CREATE TABLE users (id INTEGER PRIMARY KEY) STRICT;")
  runMigrations(db, dir)

  write("001_users.sql", "CREATE TABLE people (id INTEGER PRIMARY KEY) STRICT;")

  expect(() => runMigrations(db, dir)).toThrow(/changed after it was applied/)
})

test("refuses to run when an applied migration's file is gone", () => {
  write("001_users.sql", "CREATE TABLE users (id INTEGER PRIMARY KEY) STRICT;")
  runMigrations(db, dir)

  unlinkSync(join(dir, "001_users.sql"))

  expect(() => runMigrations(db, dir)).toThrow(/its file is gone/)
})

test("refuses a new migration numbered below the latest applied", () => {
  write("002_users.sql", "CREATE TABLE users (id INTEGER PRIMARY KEY) STRICT;")
  runMigrations(db, dir)

  write("001_late.sql", "CREATE TABLE late (id INTEGER PRIMARY KEY) STRICT;")

  expect(() => runMigrations(db, dir)).toThrow(/numbered below/)
})

test("refuses two migrations sharing a version", () => {
  write("001_users.sql", "CREATE TABLE users (id INTEGER PRIMARY KEY) STRICT;")
  write("001_posts.sql", "CREATE TABLE posts (id INTEGER PRIMARY KEY) STRICT;")

  expect(() => loadMigrations(dir)).toThrow(/share version 1/)
})

test("refuses a filename the runner cannot order", () => {
  write("1_users.sql", "CREATE TABLE users (id INTEGER PRIMARY KEY) STRICT;")

  expect(() => loadMigrations(dir)).toThrow(/Invalid migration filename/)
})

test("refuses an empty migration", () => {
  write("001_empty.sql", "\n  \n")

  expect(() => loadMigrations(dir)).toThrow(/is empty/)
})

test("ignores files that are not SQL", () => {
  write("README.md", "# notes")
  write("001_users.sql", "CREATE TABLE users (id INTEGER PRIMARY KEY) STRICT;")

  expect(runMigrations(db, dir)).toEqual([1])
})

test("explains a missing migrations directory", () => {
  expect(() => loadMigrations(join(dir, "nope"))).toThrow(
    /Cannot read the migrations directory/
  )
})

test("rejects a migration that leaves a dangling foreign key", () => {
  write(
    "001_schema.sql",
    `CREATE TABLE users (id INTEGER PRIMARY KEY) STRICT;
     CREATE TABLE posts (
       id      INTEGER PRIMARY KEY,
       user_id INTEGER NOT NULL REFERENCES users(id)
     ) STRICT;
     INSERT INTO posts (id, user_id) VALUES (1, 999);`
  )

  // The insert itself succeeds because migrations run with enforcement off.
  expect(() => runMigrations(db, dir)).toThrow(/foreign key violation/)
  expect(tables()).toEqual([])
})

test("restores foreign key enforcement after migrating", () => {
  write("001_users.sql", "CREATE TABLE users (id INTEGER PRIMARY KEY) STRICT;")
  runMigrations(db, dir)

  const row = db.query("PRAGMA foreign_keys").get() as { foreign_keys: number }

  expect(row.foreign_keys).toBe(1)
})

test("restores foreign key enforcement after a failure", () => {
  write("001_broken.sql", "SELEC 1;")

  expect(() => runMigrations(db, dir)).toThrow(MigrationError)

  const row = db.query("PRAGMA foreign_keys").get() as { foreign_keys: number }

  expect(row.foreign_keys).toBe(1)
})

test("reports status without applying anything", () => {
  write("001_users.sql", "CREATE TABLE users (id INTEGER PRIMARY KEY) STRICT;")
  runMigrations(db, dir)
  write("002_posts.sql", "CREATE TABLE posts (id INTEGER PRIMARY KEY) STRICT;")

  const status = migrationStatus(db, dir)

  expect(status.current).toBe(1)
  expect(status.applied.map((row) => row.version)).toEqual([1])
  expect(status.pending.map((row) => row.file)).toEqual(["002_posts.sql"])
  expect(tables()).toEqual(["users"])
})

test("reports no version on an untouched database", () => {
  expect(currentVersion(db)).toBeNull()
  expect(pendingMigrations(db, dir)).toEqual([])
})
