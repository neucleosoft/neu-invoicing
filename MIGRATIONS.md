# Schema Changes / Database Migrations

**One schema, one migration lineage, both apps.** Since the Prisma→Drizzle
migration (2026-07-18) the entire product runs on the Drizzle schema at
`packages/shared/src/schema.ts`, and every migration lives in
`packages/shared/drizzle/`. Desktop (libsql) and mobile (expo-sqlite) apply
the SAME files. Migrations are auto-applied to all users on next app launch —
no manual SQL, no asking users to run anything.

## When you change the schema

1. Edit `packages/shared/src/schema.ts` — add a column, add a table, whatever.
2. Generate a migration (run from `apps/mobile`, whose drizzle.config.ts
   points `out` at the shared folder):
   ```bash
   cd apps/mobile
   pnpm exec drizzle-kit generate
   ```
   This creates `packages/shared/drizzle/<nnnn>_<name>.sql`, updates
   `meta/_journal.json` + the snapshot, and regenerates `migrations.js`
   (the bundle mobile imports).
3. Commit ALL of those files alongside your code change.
4. Ship. On next launch, both apps apply anything newer than what the user's
   DB has recorded in `__drizzle_migrations`.

Don't skip step 2 — a schema change without a migration file = users get the
new code but their DB stays old, and they hit "no such column" errors.

## What runs at desktop startup

`electron/main/bootMigrate.ts:ensureTablesExist()` +
`database.ts:setupDatabase()` handle three populations:

- **Fresh install** (no `neuinvoicing.db` yet): drizzle's migrator builds
  every table from `packages/shared/drizzle` (0000 onward).
- **Drizzle-tracked DB** (has `__drizzle_migrations` — every install after
  the ORM migration, and any DB restored from a mobile backup): the migrator
  applies only entries newer than the tracker's high-water mark. No-op when
  current.
- **Prisma-era DB** (has `_prisma_migrations` — every install from before
  the ORM migration, including the boss's): a one-time **deploy-lite** pass
  reads the Prisma tracker and executes any still-pending
  `prisma/migrations/*.sql` shipped with the app (exactly what
  `prisma migrate deploy` used to do, without spawning the Prisma CLI), then
  ADOPTS the drizzle tracker — `__drizzle_migrations` is seeded with every
  bundled migration at its real `folderMillis`, so from then on the DB is a
  normal drizzle-tracked DB. Proven on a copy of the real May-era production
  DB: 7 pending migrations applied, zero row loss, idempotent on re-boot.
  (A DB with tables but NO tracker at all — ancient `db push` installs —
  gets a tolerant statement-by-statement catch-up first.)

The `prisma/migrations` SQL folder ships with the app FOREVER as data for
that deploy-lite path — it is frozen history, not an active system.

Mobile startup is unchanged: `db/index.ts:runMigrations()` (drizzle expo
migrator) + the restore path's tracker seeding in `sync/drive.ts`.

## DON'Ts

- ❌ **Don't hand-edit a committed migration `.sql`.** Once it ships, it's
  immutable — users' DBs track it by journal position; editing it creates
  drift between users who ran the old vs new text.
- ❌ **Don't delete migration files or journal entries.** Same reason.
- ❌ **Don't ship a schema.ts change without its generated migration.** Both
  in the same commit.
- ❌ **Don't touch the `prisma/migrations` folder.** It's frozen upgrade data
  for pre-2026-07 installs.
- ❌ **Don't add columns to synced tables without thinking about sync.** New
  columns ride diaries automatically (packets carry whole rows), but BOTH
  apps must ship together — an old app can't insert a row carrying a column
  it doesn't know.

## Troubleshooting

**"User updated but a column is missing"**
- Desktop: devtools console (`Ctrl+Shift+I`) → look for `[boot-migrate]`
  lines or migration errors. Mobile: Share logs (app-log.txt).
- If a migration's SQL has a bug, ship a NEW migration that corrects it —
  never edit the old one.

**"Two devs both ran `drizzle-kit generate` and the journal conflicts"**
- Don't merge journal/snapshot JSON by hand. Keep one branch's generated
  files, delete the other's, re-run `drizzle-kit generate` once with the
  combined schema state.

**"Desktop crashes on boot with a libsql/native module error"**
- The `@libsql` native binaries must stay OUTSIDE the asar archive — check
  `package.json:build.asarUnpack` still lists `node_modules/@libsql/**/*`.

## File locations

| Thing | Where |
|---|---|
| Schema definition (both apps) | `packages/shared/src/schema.ts` |
| Migration files (both apps) | `packages/shared/drizzle/<nnnn>_<name>.sql` |
| Migration journal | `packages/shared/drizzle/meta/_journal.json` |
| Desktop startup runner | `apps/desktop/electron/main/bootMigrate.ts` + `database.ts` |
| Mobile startup runner | `apps/mobile/db/index.ts` (`runMigrations`) |
| Tracking table (in user's DB) | `__drizzle_migrations` (legacy: `_prisma_migrations`, frozen) |
| Frozen Prisma-era upgrade SQL | `apps/desktop/prisma/migrations/` |
| User's DB on disk (Windows) | `%APPDATA%\neu-invoicing\neuinvoicing.db` |

## Why this whole system exists

Production offline apps have one DB per user, on the user's machine. A schema
change ships from us → their DB has to update without losing data → without
them running anything. The standard solution is a migration system: numbered
SQL files, each describing one change, tracked in a table inside the user's
DB. On launch, the app compares "what's recorded" to "what's bundled" and
runs only the missing ones, in order.

Drizzle provides this on both platforms from one folder. The deploy-lite +
adoption path in `bootMigrate.ts` exists only because desktop installs from
before 2026-07 recorded their history in Prisma's tracker — it transitions
each of them exactly once, and they're normal from there on.
