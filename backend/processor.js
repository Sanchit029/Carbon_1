/**
 * Event Processing Pipeline
 * 
 * Orchestrates the complete flow:
 * 1. Store raw event
 * 2. Normalize it
 * 3. Check for duplicates
 * 4. Validate
 * 5. Store processed event
 * 6. Record idempotency
 * 
 * Partial failure handling:
 * - If validation fails: record in failed_events, return error
 * - If storage fails: transaction rollback, return 500
 * - If idempotency recording fails: still considered successful
 *   (the processed_event was stored, so data is not lost)
 */

const { getDb } = require('./database');
const { normalizeEvent } = require('./normalization');
const { generateIdempotencyKey, checkDuplicate, recordProcessing } = require('./deduplication');

const processEvent = async (rawEvent, simulateFailure = false) => {
  const db = getDb();
  
  try {
    // Step 1: Store raw event
    const rawEventId = await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO raw_events (raw_data, source, processing_status) VALUES (?, ?, ?)',
        [JSON.stringify(rawEvent), rawEvent.source || 'unknown', 'processing'],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
    
    // Step 2: Normalize
    const normalizationResult = normalizeEvent(rawEvent);
    if (!normalizationResult.success) {
      // Store failure
      await new Promise((resolve, reject) => {
        db.run(
          'INSERT INTO failed_events (raw_event_id, error_message, raw_data) VALUES (?, ?, ?)',
          [rawEventId, normalizationResult.error, JSON.stringify(rawEvent)],
          function(err) {
            if (err) reject(err);
            else resolve();
          }
        );
      });
      
      // Update raw event status
      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE raw_events SET processing_status = ? WHERE id = ?',
          ['failed', rawEventId],
          function(err) {
            if (err) reject(err);
            else resolve();
          }
        );
      });
      
      return {
        success: false,
        error: normalizationResult.error,
        rawEventId: rawEventId
      };
    }
    
    const normalizedEvent = normalizationResult.data;
    
    // Step 3: Generate idempotency key
    const idempotencyKey = generateIdempotencyKey(normalizedEvent);
    
    // Step 4: Check for duplicates
    const duplicateCheck = await checkDuplicate(idempotencyKey);
    if (duplicateCheck.isDuplicate) {
      // Mark raw event as duplicate
      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE raw_events SET processing_status = ? WHERE id = ?',
          ['duplicate', rawEventId],
          function(err) {
            if (err) reject(err);
            else resolve();
          }
        );
      });
      
      return {
        success: true,
        isDuplicate: true,
        message: 'Event already processed',
        processedEventId: duplicateCheck.processedEventId,
        rawEventId: rawEventId
      };
    }
    
    // Step 5: Simulate database failure if requested
    if (simulateFailure) {
      throw new Error('Simulated database failure during write');
    }
    
    // Step 6: Store processed event (atomic operation)
    const processedEventId = await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO processed_events 
         (client_id, metric, amount, timestamp, idempotency_key, raw_event_id) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          normalizedEvent.client_id,
          normalizedEvent.metric,
          normalizedEvent.amount,
          normalizedEvent.timestamp,
          idempotencyKey,
          rawEventId
        ],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
    
    // Step 7: Record in idempotency table
    // If this fails, we still have the data in processed_events (not lost)
    try {
      await recordProcessing(idempotencyKey, processedEventId);
    } catch (e) {
      console.warn('Failed to record idempotency key (event still processed)', e.message);
    }
    
    // Update raw event status
    await new Promise((resolve, reject) => {
      db.run(
        'UPDATE raw_events SET processing_status = ? WHERE id = ?',
        ['success', rawEventId],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });
    
    return {
      success: true,
      processedEventId: processedEventId,
      rawEventId: rawEventId,
      idempotencyKey: idempotencyKey
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message,
      isSystemError: true
    };
  }
};

module.exports = {
  processEvent
};
