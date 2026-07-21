// Drizzle type + operator bridge — kills the pnpm dual-instance problem.
//
// pnpm creates a SEPARATE drizzle-orm instance per distinct peer-dependency
// set, so desktop (peered with @libsql/client) and this package resolve two
// copies of the same version. Runtime is fine — drizzle is built for that
// (entityKind + Symbol.for keys instead of instanceof) — but the two copies'
// TYPES are nominally incompatible (protected members), so a desktop-copy
// operator can't type-accept a shared-copy column.
//
// Fix: every app builds queries with THIS package's operators and types the
// database handle with THIS package's BaseSQLiteDatabase. The only cast in
// the codebase is the one line where desktop wraps its libsql driver.

export {
  and,
  asc,
  between,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  not,
  notInArray,
  or,
  sql,
  sum,
} from 'drizzle-orm'
export type { Column, SQL } from 'drizzle-orm'

import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'

/** An async drizzle SQLite database typed from THIS package's drizzle-orm
 *  instance — desktop casts its libsql driver to this once, and every query
 *  against the shared schema tables typechecks from then on. */
export type SharedSqliteDb = BaseSQLiteDatabase<'async', any, Record<string, unknown>>
