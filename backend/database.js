const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'data.db');
const db = new sqlite3.Database(dbPath);

/**
 * Initialize database schema
 * 
 * Key tables:
 * - raw_events: Store raw incoming events for audit trail
 * - processed_events: Normalized, validated events ready for aggregation
 * - idempotency_keys: Track processed events to prevent duplicates
 */
const initDatabase = () => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Raw events - audit trail of what we received
      db.run(`
        CREATE TABLE IF NOT EXISTS raw_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          raw_data TEXT NOT NULL,
          source TEXT NOT NULL,
          processing_status TEXT DEFAULT 'pending'
        )
      `, (err) => {
        if (err && !err.message.includes('already exists')) reject(err);
      });

      // Processed events - canonical form
      db.run(`
        CREATE TABLE IF NOT EXISTS processed_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          client_id TEXT NOT NULL,
          metric TEXT,
          amount REAL NOT NULL,
          timestamp TEXT NOT NULL,
          idempotency_key TEXT UNIQUE NOT NULL,
          raw_event_id INTEGER,
          processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (raw_event_id) REFERENCES raw_events(id)
        )
      `, (err) => {
        if (err && !err.message.includes('already exists')) reject(err);
      });

      // Idempotency tracking - prevent duplicate processing
      db.run(`
        CREATE TABLE IF NOT EXISTS idempotency_keys (
          idempotency_key TEXT PRIMARY KEY,
          processed_event_id INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (processed_event_id) REFERENCES processed_events(id)
        )
      `, (err) => {
        if (err && !err.message.includes('already exists')) reject(err);
      });

      // Failed events - track what couldn't be processed
      db.run(`
        CREATE TABLE IF NOT EXISTS failed_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          raw_event_id INTEGER,
          error_message TEXT,
          raw_data TEXT,
          failed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (raw_event_id) REFERENCES raw_events(id)
        )
      `, (err) => {
        if (err && !err.message.includes('already exists')) reject(err);
        else resolve();
      });

      // Create indices for common queries
      db.run('CREATE INDEX IF NOT EXISTS idx_processed_client_time ON processed_events(client_id, timestamp)');
      db.run('CREATE INDEX IF NOT EXISTS idx_raw_events_source ON raw_events(source)');
    });
  });
};

const getDb = () => db;

module.exports = {
  initDatabase,
  getDb
};
