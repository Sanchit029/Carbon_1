const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'data.db');
const db = new sqlite3.Database(dbPath);

// initialize database tables
const initDatabase = () => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // store raw events as they come in
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

      // normalized events after processing
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

      // track which events we already processed
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
