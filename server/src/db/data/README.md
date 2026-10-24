# `server/src/db/data/`

Runtime home of the SQLite database file.

Git does not track empty directories. This file is the only tracked occupant —
the directory is otherwise created on demand by `createDatabase()`.

## What lands here

| Path            | Tracked | Created by                          |
| --------------- | :-----: | ----------------------------------- |
| `db.sqlite`     |   No    | `../sqlite.ts`, on first connection |
| `db.sqlite-wal` |   No    | SQLite — write-ahead log            |
| `db.sqlite-shm` |   No    | SQLite — shared-memory index        |

Override the location with `DB_PATH` when you need the file somewhere else.

## Resetting

Deleting the database is safe in development. The next `bun run dev` recreates
the file and replays every migration.

```sh
bun run --cwd server db:reset
```

That is equivalent to `rm -f server/src/db/data/db.sqlite*` — keep the `*` so
the sidecars go with the database.
