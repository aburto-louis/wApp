# `server/src/db/migrations/`

**written by Claude Opus 5**

Applied schema history — the only directory the migration runner reads.

[`data/`](../data/) · [`drafts/`](../drafts/) · **`migrations/`**

---

> [!IMPORTANT]
> **This README is load-bearing.** The directory ships empty, and Git does not
> track empty directories — this file is the only thing keeping it in version
> control. `../migrate.ts` calls `readdirSync` on this path and throws `ENOENT`
> if it is missing. Only `.sql` files are loaded, so this file is invisible to
> the runner.

## Naming

`NNN_name.sql` — a zero-padded version number, an underscore, then a short
description of the change.

| Filename                 | Verdict | Reason                              |
| ------------------------ | ------- | ----------------------------------- |
| `001_users.sql`          | Good    | —                                   |
| `002_add_user_email.sql` | Good    | —                                   |
| `1_users.sql`            | Avoid   | Runs, but misorders past `010_`     |
| `users.sql`              | Throws  | Runner requires a `NNN_` prefix     |

Filenames are sorted as **strings**, not numbers, so the padding is what keeps
the order correct. Unpadded, `1_a.sql`, `2_b.sql` and `10_c.sql` load in the
order `10_c.sql`, `1_a.sql`, `2_b.sql`.

## How they run

`../sqlite.ts` applies anything pending on every boot, so usually you do
nothing. To apply on demand:

```sh
bun server/src/db/migrate.ts
```

- Each file runs inside a **transaction** — a migration that fails partway
  rolls back whole, and nothing is recorded.
- A single file may contain **multiple statements**, separated by `;`.
- Applied versions are recorded in `schema_migrations` and skipped on every
  later run.

## `schema_migrations`

The runner creates and maintains this bookkeeping table itself; it is not part
of your schema and needs no migration of its own.

| Column       | Type    | Value                         |
| ------------ | ------- | ----------------------------- |
| `version`    | INTEGER | Primary key, the `NNN` prefix |
| `name`       | TEXT    | The filename's description    |
| `applied_at` | INTEGER | Unix seconds, set on insert   |

Reading it is the quickest way to find out what a database has actually run:

```sh
sqlite3 server/src/db/data/db.sqlite "SELECT * FROM schema_migrations"
```

> [!WARNING]
> **Treat an applied migration as immutable.** Editing it will not re-run it —
> the version is already recorded — so the file and the live schema drift apart
> silently. Correct course with a new migration instead.
>
> In development you can simply start over: `rm server/src/db/data/db.sqlite*`
> discards the recorded history along with the data.

Unfinished work belongs in [`../drafts/`](../drafts/), which the runner ignores.
