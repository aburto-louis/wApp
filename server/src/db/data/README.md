# `server/src/db/data/`

**written by Claude Opus 5**

Runtime home of the SQLite database file and its seed scripts.

**`data/`** · [`drafts/`](../drafts/) · [`migrations/`](../migrations/)

---

> [!IMPORTANT]
> **This README is load-bearing.** The directory ships empty, and Git does not
> track empty directories — this file is the only thing keeping it in version
> control. `bun:sqlite` creates the database **file**, never its parent
> directory, so deleting this README makes the next clone fail on boot with
> `unable to open database file`.

## What lands here

| Path            | Tracked | Created by                          |
| --------------- | :-----: | ----------------------------------- |
| `db.sqlite`     |   No    | `../sqlite.ts`, on first connection |
| `db.sqlite-wal` |   No    | SQLite — write-ahead log            |
| `db.sqlite-shm` |   No    | SQLite — shared-memory index        |
| `seed-*.ts`     |   Yes   | You                                 |

The `-wal` and `-shm` sidecars appear because `../sqlite.ts` opts into
write-ahead logging with `PRAGMA journal_mode = WAL`. All three database files
are ignored in `.gitignore`, so local data never leaves your machine.

## Seed scripts

Seeds belong here as standalone scripts that import the shared connection.
Importing it also applies any pending migrations, so a seed always runs against
an up-to-date schema:

```ts
import db from "../sqlite"

db.run("INSERT INTO ...")
```

Run one from anywhere in the repo:

```sh
bun server/src/db/data/seed-admin.ts
```

Nothing invokes seeds automatically — neither the server nor the migration
runner knows they exist.

## Resetting

Deleting the database is safe in development. `../sqlite.ts` recreates the file
and replays every migration on the next boot.

```sh
rm server/src/db/data/db.sqlite*
```

Keep the `*`: it clears the `-wal` and `-shm` sidecars along with the database,
leaving the directory in the same state as a fresh clone.
