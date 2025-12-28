/**
 * Deduplication & Idempotency Layer
 * 
 * Challenge: No guaranteed unique event ID, unreliable timestamps
 * Solution: Generate idempotency key from content hash + client_id + timestamp
 * 
 * This approach:
 * - Uses a combination of content hash and metadata to detect duplicates
 * - Doesn't rely on fragile event IDs from clients
 * - Handles retries safely: same request = same idempotency key = no reprocessing
 * 
 * Trade-off: Very similar events from same client may collide (acceptable since
 * we can't reliably distinguish them without unique IDs anyway)
 */

const crypto = require('crypto');
const { getDb } = require('./database');

/**
 * Generate idempotency key from normalized event
 * Combines: client_id + content_hash + timestamp (minute precision)
 * 
 * This ensures:
 * - Same event retried = same key (idempotent)
 * - Different events = different keys (unless exact duplicates)
 */
const generateIdempotencyKey = (normalizedEvent) => {
  // Include critical fields in hash
  const contentHash = crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        client_id: normalizedEvent.client_id,
        metric: normalizedEvent.metric,
        amount: normalizedEvent.amount
      })
    )
    .digest('hex')
    .substring(0, 16);
  
  // Parse timestamp to minute precision (handles slight variations)
  const timestamp = new Date(normalizedEvent.timestamp);
  const timeKey = Math.floor(timestamp.getTime() / 60000); // Round to minute
  
  return `${normalizedEvent.client_id}-${timeKey}-${contentHash}`;
};

/**
 * Check if event already processed
 * 
 * Returns:
 * - { isDuplicate: false } - Safe to process
 * - { isDuplicate: true, processedEventId } - Already processed, skip
 */
const checkDuplicate = (idempotencyKey) => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    db.get(
      'SELECT processed_event_id FROM idempotency_keys WHERE idempotency_key = ?',
      [idempotencyKey],
      (err, row) => {
        if (err) reject(err);
        else resolve(row ? { isDuplicate: true, processedEventId: row.processed_event_id } : { isDuplicate: false });
      }
    );
  });
};

/**
 * Record successful processing to idempotency table
 * 
 * This is the critical step that makes retries safe.
 * Even if the response is lost, the record exists and prevents reprocessing.
 */
const recordProcessing = (idempotencyKey, processedEventId) => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    db.run(
      'INSERT INTO idempotency_keys (idempotency_key, processed_event_id) VALUES (?, ?)',
      [idempotencyKey, processedEventId],
      function(err) {
        if (err) {
          // If insert fails with UNIQUE constraint, event was already processed
          if (err.message.includes('UNIQUE')) {
            resolve({ alreadyProcessed: true });
          } else {
            reject(err);
          }
        } else {
          resolve({ recorded: true, id: this.lastID });
        }
      }
    );
  });
};

module.exports = {
  generateIdempotencyKey,
  checkDuplicate,
  recordProcessing
};
