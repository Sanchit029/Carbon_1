const crypto = require('crypto');
const { getDb } = require('./database');

// generate unique key for each event to detect duplicates
// using hash of the content so same event = same key
const generateIdempotencyKey = (normalizedEvent) => {
  // create hash from important fields
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
  
  // round timestamp to minute so small time differences don't matter
  const timestamp = new Date(normalizedEvent.timestamp);
  const timeKey = Math.floor(timestamp.getTime() / 60000);
  
  return `${normalizedEvent.client_id}-${timeKey}-${contentHash}`;
};

// check if we already processed this event
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

// save to idempotency table after successful processing
const recordProcessing = (idempotencyKey, processedEventId) => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    db.run(
      'INSERT INTO idempotency_keys (idempotency_key, processed_event_id) VALUES (?, ?)',
      [idempotencyKey, processedEventId],
      function(err) {
        if (err) {
          // if UNIQUE constraint error, already processed
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
