import { SQLiteError } from "bun:sqlite"
import type { ContentfulStatusCode } from "hono/utils/http-status"

export type DatabaseErrorCode =
  | "UNIQUE_VIOLATION"
  | "FOREIGN_KEY_VIOLATION"
  | "NOT_NULL_VIOLATION"
  | "CHECK_VIOLATION"
  | "CONSTRAINT_VIOLATION"
  | "DATABASE_BUSY"
  | "DATABASE_UNAVAILABLE"
  | "DATABASE_CORRUPT"
  | "PAYLOAD_TOO_LARGE"
  | "DATABASE_ERROR"

export type DatabaseErrorBody = {
  error: string
  code: DatabaseErrorCode
  fields?: string[]
  constraint?: string
}

export type DatabaseHttpError = {
  status: ContentfulStatusCode
  body: DatabaseErrorBody
  headers?: Record<string, string>
}

const DETAIL = /constraint failed: (.+)$/
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Pulls the offending columns out of a constraint message. SQLite writes them
 * as `UNIQUE constraint failed: users.email, users.tenant_id`.
 */
function fieldsIn(message: string): string[] | undefined {
  const detail = DETAIL.exec(message)?.[1]

  if (!detail) return undefined

  return detail.split(", ").map((part) => part.split(".").at(-1) ?? part)
}

/**
 * A named CHECK reports its name, an anonymous one reports its expression.
 * Only the name is safe to hand back.
 */
function constraintIn(message: string): string | undefined {
  const detail = DETAIL.exec(message)?.[1]

  return detail && IDENTIFIER.test(detail) ? detail : undefined
}

/**
 * Maps a `bun:sqlite` failure onto an HTTP response, or returns null when the
 * error did not come from the database.
 */
export function toHttpError(error: unknown): DatabaseHttpError | null {
  if (!(error instanceof SQLiteError)) return null

  const code = error.code ?? ""
  const { message } = error

  switch (code) {
    case "SQLITE_CONSTRAINT_UNIQUE":
    case "SQLITE_CONSTRAINT_PRIMARYKEY":
      return {
        status: 409,
        body: {
          error: "Unique constraint violation",
          code: "UNIQUE_VIOLATION",
          fields: fieldsIn(message),
        },
      }

    case "SQLITE_CONSTRAINT_FOREIGNKEY":
      // SQLite reports no detail for these, so there is nothing to surface.
      return {
        status: 409,
        body: {
          error: "Foreign key constraint violation",
          code: "FOREIGN_KEY_VIOLATION",
        },
      }

    case "SQLITE_CONSTRAINT_NOTNULL":
      return {
        status: 400,
        body: {
          error: "Missing required value",
          code: "NOT_NULL_VIOLATION",
          fields: fieldsIn(message),
        },
      }

    case "SQLITE_CONSTRAINT_CHECK":
      return {
        status: 400,
        body: {
          error: "Check constraint violation",
          code: "CHECK_VIOLATION",
          constraint: constraintIn(message),
        },
      }

    case "SQLITE_FULL":
      return {
        status: 503,
        body: {
          error: "Database is out of space",
          code: "DATABASE_UNAVAILABLE",
        },
      }

    case "SQLITE_TOOBIG":
      return {
        status: 413,
        body: { error: "Value is too large", code: "PAYLOAD_TOO_LARGE" },
      }

    case "SQLITE_CORRUPT":
    case "SQLITE_NOTADB":
      return {
        status: 500,
        body: { error: "Database is corrupt", code: "DATABASE_CORRUPT" },
      }

    default:
      break
  }

  if (code.startsWith("SQLITE_BUSY") || code.startsWith("SQLITE_LOCKED")) {
    return {
      status: 503,
      headers: { "Retry-After": "1" },
      body: { error: "Database is busy", code: "DATABASE_BUSY" },
    }
  }

  if (code.startsWith("SQLITE_READONLY") || code.startsWith("SQLITE_IOERR")) {
    return {
      status: 503,
      body: { error: "Database is unavailable", code: "DATABASE_UNAVAILABLE" },
    }
  }

  if (code.startsWith("SQLITE_CONSTRAINT")) {
    return {
      status: 400,
      body: {
        error: "Constraint violation",
        code: "CONSTRAINT_VIOLATION",
        fields: fieldsIn(message),
      },
    }
  }

  return {
    status: 500,
    body: { error: "Database error", code: "DATABASE_ERROR" },
  }
}
