import { Database } from "bun:sqlite"
import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { toHttpError } from "./errors"
import { createDatabase } from "./sqlite"

let db: Database
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wapp-errors-"))
  db = createDatabase(":memory:")

  db.run(`
    CREATE TABLE users (
      id    INTEGER PRIMARY KEY,
      name  TEXT NOT NULL,
      email TEXT UNIQUE,
      age   INTEGER CONSTRAINT age_positive CHECK (age > 0),
      score INTEGER CHECK (score > 0),
      a     TEXT,
      b     TEXT,
      UNIQUE (a, b)
    ) STRICT;

    CREATE TABLE posts (
      id      INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id)
    ) STRICT;

    INSERT INTO users (id, name, email, a, b) VALUES (1, 'ada', 'a@b.c', 'x', 'y');
  `)
})

afterEach(() => {
  db.close(false)
  rmSync(dir, { recursive: true, force: true })
})

/** Runs SQL that is expected to fail and hands back whatever it threw. */
function failure(run: () => void): unknown {
  try {
    run()
  } catch (error) {
    return error
  }

  throw new Error("expected the statement to fail")
}

test("maps a unique violation to 409 with the offending column", () => {
  const mapped = toHttpError(
    failure(() =>
      db.run("INSERT INTO users (name, email) VALUES ('bob', 'a@b.c')")
    )
  )

  expect(mapped?.status).toBe(409)
  expect(mapped?.body).toEqual({
    error: "Unique constraint violation",
    code: "UNIQUE_VIOLATION",
    fields: ["email"],
  })
})

test("maps a composite unique violation to every column in the index", () => {
  const mapped = toHttpError(
    failure(() =>
      db.run("INSERT INTO users (name, a, b) VALUES ('bob', 'x', 'y')")
    )
  )

  expect(mapped?.body.fields).toEqual(["a", "b"])
})

test("maps a duplicate primary key to the same unique violation", () => {
  const mapped = toHttpError(
    failure(() => db.run("INSERT INTO users (id, name) VALUES (1, 'bob')"))
  )

  expect(mapped?.status).toBe(409)
  expect(mapped?.body.code).toBe("UNIQUE_VIOLATION")
  expect(mapped?.body.fields).toEqual(["id"])
})

test("maps a not null violation to 400 with the column", () => {
  const mapped = toHttpError(
    failure(() => db.run("INSERT INTO users (email) VALUES ('c@d.e')"))
  )

  expect(mapped?.status).toBe(400)
  expect(mapped?.body).toEqual({
    error: "Missing required value",
    code: "NOT_NULL_VIOLATION",
    fields: ["name"],
  })
})

test("maps a foreign key violation to 409 without leaking detail", () => {
  const mapped = toHttpError(
    failure(() => db.run("INSERT INTO posts (user_id) VALUES (999)"))
  )

  expect(mapped?.status).toBe(409)
  expect(mapped?.body).toEqual({
    error: "Foreign key constraint violation",
    code: "FOREIGN_KEY_VIOLATION",
  })
})

test("names a check constraint when the schema named it", () => {
  const mapped = toHttpError(
    failure(() => db.run("INSERT INTO users (name, age) VALUES ('bob', -1)"))
  )

  expect(mapped?.status).toBe(400)
  expect(mapped?.body.code).toBe("CHECK_VIOLATION")
  expect(mapped?.body.constraint).toBe("age_positive")
})

test("withholds the expression of an anonymous check constraint", () => {
  const mapped = toHttpError(
    failure(() => db.run("INSERT INTO users (name, score) VALUES ('bob', -1)"))
  )

  expect(mapped?.body.code).toBe("CHECK_VIOLATION")
  expect(mapped?.body.constraint).toBeUndefined()
})

test("maps a readonly database to 503", () => {
  const path = join(dir, "readonly.sqlite")
  // Deliberately not createDatabase: a WAL database cannot be opened readonly
  // without its -shm sidecar, which a clean close removes.
  const writer = new Database(path, { create: true })
  writer.run("CREATE TABLE t (id INTEGER PRIMARY KEY) STRICT")
  writer.close(false)

  const reader = new Database(path, { readonly: true })

  const mapped = toHttpError(
    failure(() => reader.run("INSERT INTO t (id) VALUES (1)"))
  )

  reader.close(false)

  expect(mapped?.status).toBe(503)
  expect(mapped?.body.code).toBe("DATABASE_UNAVAILABLE")
})

test("maps a locked database to 503 with Retry-After", () => {
  const path = join(dir, "busy.sqlite")
  const holder = createDatabase(path)
  holder.run("CREATE TABLE t (id INTEGER PRIMARY KEY) STRICT")

  const contender = createDatabase(path)
  // Without this the contender would wait out the lock instead of failing.
  contender.run("PRAGMA busy_timeout = 0")

  holder.run("BEGIN EXCLUSIVE")

  const mapped = toHttpError(
    failure(() => contender.run("INSERT INTO t (id) VALUES (1)"))
  )

  holder.run("ROLLBACK")
  contender.close(false)
  holder.close(false)

  expect(mapped?.status).toBe(503)
  expect(mapped?.body.code).toBe("DATABASE_BUSY")
  expect(mapped?.headers).toEqual({ "Retry-After": "1" })
})

test("falls back to a generic database error", () => {
  const mapped = toHttpError(failure(() => db.run("SELEC 1")))

  expect(mapped?.status).toBe(500)
  expect(mapped?.body).toEqual({
    error: "Database error",
    code: "DATABASE_ERROR",
  })
})

test("ignores errors that did not come from the database", () => {
  expect(
    toHttpError(new Error("UNIQUE constraint failed: users.email"))
  ).toBeNull()
  expect(toHttpError("not an error")).toBeNull()
})
