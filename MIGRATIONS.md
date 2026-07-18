# Schema Changes / Database Migrations

Every change to `prisma/schema.prisma` follows this workflow. Migrations are auto-applied to all users on next app launch — no manual SQL, no asking users to run anything.

## When you change the schema

1. Edit `prisma/schema.prisma` — add a field, add a model, rename, whatever.
2. Generate a migration:
   ```bash
   npx prisma migrate dev --name short_description_of_change
   ```
   This creates `prisma/migrations/<timestamp>_<name>/migration.sql`.
3. Commit the new migration folder alongside your code change.
4. Build and ship: `npm run build:win`.
5. Users install the new version. On first launch, `migrate deploy` applies any new migrations automatically.

That's it. Don't skip step 2 — it's not optional. The schema change without a migration file = users get the new code but their DB stays old, and they hit "Cannot find column X" errors.

## What runs at app startup

`electron/main/database.ts:ensureTablesExist()` runs on every launch and handles three populations:

- **Fresh install** (no `neuinvoicing.db` yet): `migrate deploy` creates every table from scratch.
- **Existing user already on the migrate-deploy track**: `migrate deploy` applies only the migrations they're missing (no-op if they're current).
- **Existing user from before this system** (their DB was created via `db push`, has no `_prisma_migrations` tracking table): one-time fallback runs `db push` to align the schema with the latest, then marks every shipped migration as applied via `migrate resolve --applied`. After that single launch, they're on the migrate-deploy track for life.

The user never sees any of this. They just open the app and it works.

## DON'Ts

- ❌ **Don't run `prisma db push` against a user's production data manually.** It's only used internally by the auto-baseline path.
- ❌ **Don't hand-edit `prisma/migrations/<...>/migration.sql` after it's been committed.** Once a migration ships in any release, it's effectively immutable — modifying it creates drift between users who ran the old version vs the new.
- ❌ **Don't delete migration folders.** Users' DBs track migrations by name; removing a name breaks `migrate deploy` for everyone who has it recorded.
- ❌ **Don't ship a schema change without the migration folder.** Both must be in the same commit.
- ❌ **Don't run `prisma migrate reset` on production data.** It wipes the DB. Only use in dev.

## Troubleshooting

**"tsc says my new column doesn't exist right after `prisma generate`" (pnpm dual-client quirk)**
- pnpm keeps TWO copies of the generated client: the app's custom output (`apps/desktop/node_modules/.prisma/client`, fresh) and the pnpm-store copy `@prisma/client` actually resolves to (stale after a schema change).
- FIXED AUTOMATICALLY: `pnpm prisma:generate` now chains `scripts/sync-prisma-client.mjs`, which overwrites the store copy with the fresh one. If you ran raw `prisma generate` instead, run that script (or the pnpm script) and the errors disappear.
- CI runs the same chain, and the schema-parity guard (`pnpm verify:parity`) fails the build if `schema.prisma` and the shared Drizzle schema ever drift apart.

**"User updated but their data isn't showing / a column is missing"**
- Have them open the app's devtools (`Ctrl+Shift+I` → Console tab) and look for `migrate deploy failed` or `Migration error` lines.
- If a migration's SQL has a bug, it'll show up there. Fix the SQL, ship a new migration that corrects it, NOT an edit to the old one.

**"My local `prisma migrate dev` refuses, says my DB drifted"**
- Means your local DB was hand-edited or schema-pushed and no longer matches what the migrations describe.
- Quick fix (DEV ONLY): `npx prisma migrate reset` — wipes local DB and replays all migrations from scratch.
- Back up your local data first if you care about it.

**"Two devs both ran `migrate dev` and now there are merge conflicts"**
- Don't try to merge two `.sql` files by hand.
- Decide which one to keep, delete BOTH migration folders, pull main, run `migrate dev` once with the combined schema changes from both branches.

**"Boss / colleague's app crashes with `Cannot find module '.prisma/client/default'`"**
- Different bug — has to do with electron-builder's asar packaging of Prisma's generated client, not migrations.
- Check that `package.json:build.files` still has the `node_modules/.prisma/client/` from/to entry, and that `extraResources` and `asarUnpack` still include the prisma directories.

## File locations

| Thing | Where |
|---|---|
| Schema definition | `prisma/schema.prisma` |
| Migration files | `prisma/migrations/<timestamp>_<name>/migration.sql` |
| Startup migration runner | `electron/main/database.ts` (`ensureTablesExist`) |
| Tracking table (in user's DB) | `_prisma_migrations` |
| User's DB on disk (Windows) | `%APPDATA%\neu-invoicing\neuinvoicing.db` |

## Why this whole system exists

Production Electron apps have one DB per user, on the user's machine. Each user has their own data. A schema change ships from us → their DB has to update without losing data → without them running anything.

The standard solution is a migration system: numbered SQL files, each describing one change, each tracked in a `_prisma_migrations` table inside the user's DB. On launch, the app checks "what's recorded as applied?", compares to "what migrations are bundled?", and runs only the missing ones in order.

Prisma provides this via `migrate deploy`. That's what we use. The auto-baseline path in `database.ts` exists only because some users started before we adopted this system — it transitions them in once, and they're normal from there on.
