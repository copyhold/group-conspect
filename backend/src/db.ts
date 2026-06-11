import { Database } from 'bun:sqlite'
import path from 'node:path'
import fs from 'node:fs'

const DB_PATH = process.env.DB_PATH ?? path.join(import.meta.dir, '../../data/meetings.db')

let _db: Database | null = null

export function getDb(): Database {
  if (_db) return _db
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
  _db = new Database(DB_PATH, { create: true })
  _db.exec('PRAGMA journal_mode = WAL')
  migrate(_db)
  // Add embedding column if missing (idempotent)
  try { _db.exec(`ALTER TABLE meetings ADD COLUMN embedding TEXT`) } catch {}
  return _db
}

function migrate(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meetings (
      id        TEXT PRIMARY KEY,
      filename  TEXT NOT NULL,
      title     TEXT NOT NULL,
      date      TEXT,
      content   TEXT NOT NULL,
      indexed_at TEXT NOT NULL,
      embedding TEXT
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS meetings_fts USING fts5(
      id UNINDEXED,
      title,
      content,
      content=meetings,
      content_rowid=rowid
    );

    CREATE TRIGGER IF NOT EXISTS meetings_ai AFTER INSERT ON meetings BEGIN
      INSERT INTO meetings_fts(rowid, id, title, content)
      VALUES (new.rowid, new.id, new.title, new.content);
    END;

    CREATE TRIGGER IF NOT EXISTS meetings_ad AFTER DELETE ON meetings BEGIN
      INSERT INTO meetings_fts(meetings_fts, rowid, id, title, content)
      VALUES ('delete', old.rowid, old.id, old.title, old.content);
    END;

    CREATE TRIGGER IF NOT EXISTS meetings_au AFTER UPDATE ON meetings BEGIN
      INSERT INTO meetings_fts(meetings_fts, rowid, id, title, content)
      VALUES ('delete', old.rowid, old.id, old.title, old.content);
      INSERT INTO meetings_fts(rowid, id, title, content)
      VALUES (new.rowid, new.id, new.title, new.content);
    END;
  `)
}
