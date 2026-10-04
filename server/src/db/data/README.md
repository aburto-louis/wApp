# `server/src/db/data/`

Runtime home of the SQLite database file.

[`data/`](.) · [`migrations/`](../migrations/) · [`seeds/`](../seeds/)

Git does not track empty directories. This file is the only tracked occupant —
the directory is otherwise created on demand by `createDatabase()`.

## What lands here

| Path            | Tracked | Created by                          |
| --------------- | :-----: | ----------------------------------- |
| `db.sqlite`     |   No    | `../sqlite.ts`, on first connection |
| `db.sqlite-wal` |   No    | SQLite — write-ahead log            |
| `db.sqlite-shm` |   No    | SQLite — shared-memory index        |

The `-wal` and `-shm` sidecars appear because `../sqlite.ts` opts into
write-ahead logging with `PRAGMA journal_mode = WAL`. All three database files
are ignored in `.gitignore`, so local data never leaves your machine.

Override the location with `DB_PATH` when you need the file somewhere else.

## Resetting

Deleting the database is safe in development. The next `bun run dev` recreates
the file and replays every migration.

```sh
bun run --cwd server db:reset
```

That is equivalent to `rm -f server/src/db/data/db.sqlite*` — keep the `*` so
the sidecars go with the database.
