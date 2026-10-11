import { SQLocalDrizzle } from 'sqlocal/drizzle';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { sql as drizzleSql } from 'drizzle-orm';
import * as schema from './schema';

let driver: any;
let sql: any;

try {
  const sqlocal = new SQLocalDrizzle('video-editor.sqlite');
  driver = sqlocal.driver;
  sql = sqlocal.sql;
} catch (err) {
  console.warn('[AI Studio] SQLocal client not available — using in-memory stub', err);
  driver = async () => ({ rows: [] });
  sql = async () => [];
}

let db: any;
try {
  db = drizzle(driver, { schema });
} catch {
  console.warn('[AI Studio] Database not connected — using mock');
  const noOp = {
    findMany: async () => [],
    findFirst: async () => null,
    findUnique: async () => null,
    create: async (d: any) => d?.data ?? {},
    update: async (d: any) => d?.data ?? {},
    delete: async () => ({})
  };
  db = new Proxy({}, {
    get: (_, prop) => (prop === 'query' ? new Proxy({}, { get: () => noOp }) : async () => [])
  });
}

export { driver, sql, db };

// Helper to execute raw SQL for triggers
export async function initializeDatabase() {
  if (!sql) return;
  try {
  // Create tables using Drizzle's generated SQL, but here we can just write it manually or rely on Drizzle if we generate migrations.
  // Wait, Drizzle doesn't auto-migrate client-side without drizzle-kit output. Let's just create tables manually or use raw queries to make it standalone.
  
  await sql`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      width INTEGER NOT NULL DEFAULT 1920,
      height INTEGER NOT NULL DEFAULT 1080,
      fps REAL NOT NULL DEFAULT 30,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      opfs_handle_uri TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      duration REAL NOT NULL,
      width INTEGER,
      height INTEGER,
      created_at INTEGER NOT NULL
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      order_index INTEGER NOT NULL
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS clips (
      id TEXT PRIMARY KEY,
      track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
      start_time REAL NOT NULL,
      duration REAL NOT NULL,
      trim_in REAL NOT NULL DEFAULT 0,
      trim_out REAL NOT NULL,
      opacity REAL NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS undo_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      action TEXT NOT NULL,
      undo_sql TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );
  `;

  // Enable foreign keys
  await sql`PRAGMA foreign_keys = ON;`;

  // --- TRIGGERS for Undo/Redo ---
  
  // Track Clips Insert
  await sql`
    CREATE TRIGGER IF NOT EXISTS log_clip_insert
    AFTER INSERT ON clips
    BEGIN
      INSERT INTO undo_log (table_name, action, undo_sql, timestamp)
      VALUES (
        'clips',
        'INSERT',
        'DELETE FROM clips WHERE id = ''' || NEW.id || ''';',
        strftime('%s','now')
      );
    END;
  `;

  // Track Clips Delete
  await sql`
    CREATE TRIGGER IF NOT EXISTS log_clip_delete
    BEFORE DELETE ON clips
    BEGIN
      INSERT INTO undo_log (table_name, action, undo_sql, timestamp)
      VALUES (
        'clips',
        'DELETE',
        'INSERT INTO clips (id, track_id, asset_id, start_time, duration, trim_in, trim_out, opacity, created_at) ' ||
        'VALUES (''' || OLD.id || ''', ''' || OLD.track_id || ''', ' || 
        COALESCE('''' || OLD.asset_id || '''', 'NULL') || ', ' || 
        OLD.start_time || ', ' || OLD.duration || ', ' || OLD.trim_in || ', ' || OLD.trim_out || ', ' || OLD.opacity || ', ' || OLD.created_at || ');',
        strftime('%s','now')
      );
    END;
  `;

  // Track Clips Update
  await sql`
    CREATE TRIGGER IF NOT EXISTS log_clip_update
    AFTER UPDATE ON clips
    BEGIN
      INSERT INTO undo_log (table_name, action, undo_sql, timestamp)
      VALUES (
        'clips',
        'UPDATE',
        'UPDATE clips SET ' ||
        'track_id = ''' || OLD.track_id || ''', ' ||
        'asset_id = ' || COALESCE('''' || OLD.asset_id || '''', 'NULL') || ', ' ||
        'start_time = ' || OLD.start_time || ', ' ||
        'duration = ' || OLD.duration || ', ' ||
        'trim_in = ' || OLD.trim_in || ', ' ||
        'trim_out = ' || OLD.trim_out || ', ' ||
        'opacity = ' || OLD.opacity || 
        ' WHERE id = ''' || OLD.id || ''';',
        strftime('%s','now')
      );
    END;
  `;

    console.log('Database initialized successfully with schema and triggers.');
  } catch (err) {
    console.warn('[AI Studio] Database initialization bypassed:', err);
  }
}

// Function to perform Undo
export async function undoLastAction() {
  try {
    const lastLog = await db.select().from(schema.undoLog).orderBy(drizzleSql`id DESC`).limit(1).then((res: any) => res?.[0]);
    if (lastLog) {
      // Execute the raw undo SQL
      await db.run(drizzleSql.raw(lastLog.undoSql));
      await db.delete(schema.undoLog).where(drizzleSql`id = ${lastLog.id}`);
      return true;
    }
  } catch (err) {
    console.warn('[AI Studio] Undo action failed:', err);
  }
  return false;
}
