import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import path from 'path';

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'editor.db');

let db: Database.Database | null = null;

/**
 * Opens the SQLite database and runs schema setup + migrations.
 * Uses WAL mode for better concurrent read performance.
 */
export function connectDatabase(): Database.Database {
  if (db) return db;

  mkdirSync(path.dirname(DB_PATH), { recursive: true });

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      room_id    TEXT    PRIMARY KEY,
      content    TEXT    NOT NULL DEFAULT '',
      yjs_state  BLOB,
      updated_at INTEGER NOT NULL
    );
  `);

  runMigrations(db);

  console.log(`[Database] SQLite ready at ${DB_PATH}`);
  return db;
}

/**
 * Additive, idempotent migrations for databases created before this column
 * existed. Safe to run on every startup — checks PRAGMA table_info first
 * and only runs ALTER TABLE if the column is actually missing.
 */
function runMigrations(database: Database.Database): void {
  const columns = database.prepare('PRAGMA table_info(documents)').all() as Array<{ name: string }>;
  const hasLanguageColumn = columns.some((col) => col.name === 'language');

  if (!hasLanguageColumn) {
    database.exec(`ALTER TABLE documents ADD COLUMN language TEXT NOT NULL DEFAULT 'plaintext';`);
    console.log('[Database] Migration applied: added "language" column to documents.');
  }
}

/** Returns the shared database handle. Throws if not yet connected. */
export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialised — call connectDatabase() first.');
  }
  return db;
}
