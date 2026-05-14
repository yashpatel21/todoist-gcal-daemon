import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { runMigrations } from './schema.js'

export type DB = Database.Database

export function openDatabase(filePath: string): DB {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })

  const db = new Database(filePath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')
  db.pragma('busy_timeout = 5000')

  runMigrations(db)
  return db
}

export function nowIso(): string {
  return new Date().toISOString()
}
