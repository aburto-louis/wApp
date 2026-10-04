# `server/src/db/migrations/`

Applied schema history — the only directory the migration runner reads.

[`data/`](../data/) · **`migrations/`** · [`seeds/`](../seeds/)

Git does not track empty directories. This file is the only tracked occupant.
Only `.sql` files are loaded, so this README is invisible to the runner.

## Naming

`NNN_name.sql` — a version of at least three digits, an underscore, then a
snake_case description.

| Filename                 | Verdict | Reason                              |
| ------------------------ | ------- | ----------------------------------- |
| `001_users.sql`          | Good    | —                                   |
| `002_add_user_email.sql` | Good    | —                                   |
| `1_users.sql`            | Throws  | Version must be at least three digits |
| `users.sql`              | Throws  | Runner requires a `NNN_` prefix     |

Files are sorted by the parsed version number, not by filename. Padding is
still the convention so listings stay readable.

## How they run

The server applies anything pending on boot in development. Production only
verifies: it refuses to start if a migration is still pending.

```sh
bun run --cwd server db:migrate
bun run --cwd server db:status
```

- The whole batch runs inside one **IMMEDIATE** transaction — a failure
  rolls everything back, and nothing is recorded.
- A single file may contain **multiple statements**, separated by `;`.
- Applied versions are recorded in `schema_migrations` and skipped later.
- Each file is checksummed. Editing an applied migration, deleting its file,
  or inserting a version below the latest applied one all fail the run.

## `schema_migrations`

The runner creates and maintains this bookkeeping table itself; it is not part
of your schema and needs no migration of its own.

| Column        | Type    | Value                         |
| ------------- | ------- | ----------------------------- |
| `version`     | INTEGER | Primary key, the `NNN` prefix |
| `name`        | TEXT    | The filename's description    |
| `checksum`    | TEXT    | sha256 of the file contents   |
| `applied_at`  | INTEGER | Unix seconds, set on insert   |
| `duration_ms` | INTEGER | How long that file took       |

Reading it is the quickest way to find out what a database has actually run:

```sh
sqlite3 server/src/db/data/db.sqlite "SELECT * FROM schema_migrations"
```

> [!WARNING]
> **Treat an applied migration as immutable.** The runner will refuse to start
> if the file no longer matches the recorded checksum. Correct course with a
> new migration instead.
>
> In development you can simply start over: `bun run --cwd server db:reset`
> discards the recorded history along with the data.
