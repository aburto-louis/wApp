import type { Database } from "bun:sqlite"
import { afterEach, beforeEach, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createDatabase } from "./sqlite"

let dir: string
const open: Database[] = []

function database(path: string): Database {
  const db = createDatabase(path)
  open.push(db)

  return db
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wapp-sqlite-"))
})

afterEach(() => {
  for (const db of open.splice(0)) db.close(false)
  rmSync(dir, { recursive: true, force: true })
})

test("creates the parent directory of the database file", () => {
  const path = join(dir, "nested", "deeper", "db.sqlite")

  database(path)

  expect(existsSync(path)).toBe(true)
})

test("enables WAL on a file-backed database", () => {
  const db = database(join(dir, "db.sqlite"))
  const row = db.query("PRAGMA journal_mode").get() as { journal_mode: string }

  expect(row.journal_mode).toBe("wal")
})

test("enforces foreign keys and waits out a busy database", () => {
  const db = database(":memory:")

  expect(db.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 })
  expect(db.query("PRAGMA busy_timeout").get()).toEqual({ timeout: 5000 })
})

test("binds named parameters without a sigil and rejects missing ones", () => {
  const db = database(":memory:")
  db.run("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL) STRICT")

  db.query("INSERT INTO t (name) VALUES ($name)").run({ name: "ada" })

  expect(db.query("SELECT name FROM t").get()).toEqual({ name: "ada" })
  expect(() =>
    db.query("INSERT INTO t (name) VALUES ($name)").run({} as never)
  ).toThrow(/Missing parameter/)
})

test("does not run migrations", () => {
  const db = database(":memory:")
  const row = db
    .query("SELECT name FROM sqlite_master WHERE name = 'schema_migrations'")
    .get()

  expect(row).toBeNull()
})
