# Technical Concepts & Implementation Guide

This document explains the key technical concepts used in the system.

## 1. Idempotency & Deduplication

### The Problem
Clients may resend events due to:
- Network timeouts (no response received)
- Unsure if request succeeded
- Explicit retry logic
- Browser back button
- Mobile app resubmission

Without idempotency, retries cause duplicate processing and double-counting.

### Our Solution: Content-Hash Idempotency Keys

**Generation**:
```javascript
// From deduplication.js
const idempotencyKey = `${clientId}-${timeKey}-${contentHash}`;
// Example: "client_A-1704067200000-a3f2b1c9d4e5f6g7"
```

**Components**:
1. `clientId` - Which client sent it
2. `timeKey` - Timestamp rounded to minute (handles clock skew)
3. `contentHash` - SHA256 of metric + amount (fingerprint)

**Why This Works**:
- Same event retried = identical content hash = same key
- Key is deterministic (input → output always the same)
- Different events = different key (different metric or amount)

**Key Insight**:
> We don't wait for client ID. We create one from the event itself.

### The Flow

```
Request 1                          Request 2 (retry)
Generate key: "K1"                Generate key: "K1" ← SAME!
Check: "K1" not in table           Check: "K1" IN table!
Process & INSERT                   Return existing result
Record "K1" in table               Don't reprocess ✓
Return processedEventId: 42        Return processedEventId: 42
```

### Safety Guarantees

```
Level 1: Idempotency Check
├─ Check if key exists
├─ 99% efficient path (prevents unnecessary work)
└─ Fallback if missing:

Level 2: Database Constraints
├─ UNIQUE(idempotency_key) on processed_events
├─ If check fails, constraint catches it
└─ INSERT fails safely (no corruption)
```

---

## 2. Normalization & Type Conversion

### The Problem

Clients send data in inconsistent formats:

```javascript
// Client A (nested, string amounts)
{
  "source": "client_A",
  "payload": {
    "metric": "transaction",
    "amount": "1200",           // String!
    "timestamp": "2024/01/01"   // Different format!
  }
}

// Client B (flat, different field names, ISO date)
{
  "client": "client_B",
  "event_type": "payment",
  "value": 1200,              // Number
  "event_time": "2024-01-01T00:00:00Z"
}
```

### Our Solution: Configuration-Based Normalization

**Field Mappings**:
```javascript
// From normalization.js
const clientMappings = {
  client_A: {
    clientIdField: 'source',           // Path: look in .source
    metricField: 'payload.metric',     // Path: look in .payload.metric
    amountField: 'payload.amount',     // Path: look in .payload.amount
    timestampField: 'payload.timestamp'
  },
  client_B: {
    clientIdField: 'client',           // Look in .client
    metricField: 'event_type',         // Look in .event_type
    amountField: 'value',              // Look in .value
    timestampField: 'event_time'       // Look in .event_time
  }
};
```

**Type Conversions**:
```javascript
// String to number
"1200" → 1200

// Date format normalization
"2024/01/01" → "2024-01-01T00:00:00Z"
"2024-01-01T10:30:00Z" → "2024-01-01T10:30:00Z" (already good)
1704067200000 → "2024-01-01T00:00:00Z" (timestamp)
```

**Result**: Canonical Form
```javascript
{
  "client_id": "client_A",      // Always a string
  "metric": "transaction",       // Always a string
  "amount": 1200,                // Always a number
  "timestamp": "2024-01-01T00:00:00Z"  // Always ISO 8601
}
```

### Why Separate Normalization?

✅ **Decoupled** - Normalization doesn't affect processing logic  
✅ **Testable** - Can test normalization independently  
✅ **Extensible** - Add new clients by adding config  
✅ **Visible** - Clear where format variations are handled  

---

## 3. Two-Phase Processing

### Phase 1: Store in processed_events
```
CRITICAL: If this succeeds, data is safe ✓

INSERT INTO processed_events (client_id, amount, ...)
```

If this fails → return HTTP 500 → client can retry → safe

### Phase 2: Record in idempotency_keys
```
OPTIONAL CONVENIENCE: If this fails, safety mechanisms catch it

INSERT INTO idempotency_keys (idempotency_key, processed_event_id)
```

If this fails → data already safe from phase 1 → constraint catches retry

### Flow Diagram

```
Event arrives
    ↓
Normalize → Check idempotency → Process
    ↓                               ↓
Valid?                          INSERT processed_events ← CRITICAL
YES ↓ NO ↓                           ↓
    Record              Record      SUCCESS?
    failure          failure         YES ↓ NO ↓
    ↓                    ↓           INSERT Return
    HTTP 400         HTTP 400     idempotency 500
    Failed event                    ↓
    stored                         Done
                              (Try insert again
                               on retry - safe)
```

---

## 4. Database Consistency

### The UNIQUE Constraint

```sql
CREATE TABLE processed_events (
  ...
  idempotency_key TEXT UNIQUE NOT NULL,
  ...
);
```

**What it does**:
- Guarantees no two rows with same idempotency_key
- If you try to INSERT duplicate → ERROR
- Cannot accidentally create duplicate

**Why it's important**:
- If idempotency check fails (database issue)
- Retry will try to INSERT again
- UNIQUE constraint will prevent corruption
- Data stays consistent

### Multi-Layer Safety

```
Layer 1: Application Logic (Idempotency Check)
├─ Most efficient
├─ Prevents unnecessary work
└─ Query: SELECT ... WHERE idempotency_key = ?

Layer 2: Database Constraint (UNIQUE)
├─ Prevents corruption if layer 1 fails
├─ No configuration needed
└─ Automatic enforcement

Layer 3: Audit Trail (raw_events)
├─ Can verify correctness after
├─ Can replay if needed
└─ Helps with debugging
```

**Result**: Multiple independent safeguards, any one catches issues

---

## 5. Aggregation Strategy

### Why Query Only processed_events?

```
❌ DON'T query raw_events
├─ Messy (different field names, types)
├─ Unvalidated (might have errors)
├─ Inconsistent (depends on failed processing)
└─ Would give WRONG totals

✅ DO query processed_events
├─ Clean (canonical form)
├─ Validated (passed normalization)
├─ Consistent (same regardless of failures)
└─ Gives CORRECT totals
```

### Safe Aggregation

```sql
SELECT 
  client_id,
  COUNT(*) as count,
  SUM(amount) as total,
  AVG(amount) as average
FROM processed_events  ← Only canonical form
WHERE client_id = ? AND timestamp BETWEEN ? AND ?
GROUP BY client_id;
```

**Guarantees**:
- Same result even if retries happened (idempotency prevents duplicates)
- Same result even if some events failed (only processed ones counted)
- Same result at different times (unless new events added)

---

## 6. Error Handling Strategy

### Validation Error (HTTP 400)

```javascript
// From normalization.js
if (amount === null) {
  return { 
    success: false, 
    error: 'Missing or invalid amount field' 
  };
}

// Client's response:
{
  "success": false,
  "error": "Missing or invalid amount field"
}

// What client should do:
// Fix the data and retry
```

**Why 400?**
- Client has a problem (bad data)
- No point retrying without fixing it
- Server is working fine

### System Error (HTTP 500)

```javascript
// From processor.js - database failure
db.run('INSERT INTO processed_events ...')
  .catch(error => {
    // Database is down/full/broken
    return {
      success: false,
      error: error.message,
      isSystemError: true
    };
  });

// Client's response:
{
  "success": false,
  "error": "SQLITE_IOERR: disk I/O error",
  "message": "System error. Event may be retried."
}

// What client should do:
// Retry later (system will recover)
```

**Why 500?**
- Server has a problem (database down)
- Retrying makes sense (might work next time)
- Client shouldn't change anything

### Database Success (HTTP 200)

```javascript
{
  "success": true,
  "isDuplicate": false,
  "processedEventId": 42,
  "idempotencyKey": "client_A-...",
  "rawEventId": 1
}
```

**Benefits**:
- Client knows it succeeded
- Can check if duplicate for metrics
- Has ID if needs to query later

---

## 7. Timestamp Precision

### The Problem

Timestamps may:
- Come from different devices (different clocks)
- Be rounded differently
- Have different precision (seconds vs milliseconds)
- Be missing entirely

### Our Solution: Minute Precision

```javascript
// From deduplication.js
const timeKey = Math.floor(timestamp.getTime() / 60000);
// Rounds to nearest minute

// Example:
2024-01-01 10:30:14 → 2024-01-01 10:30:00  (same minute)
2024-01-01 10:30:59 → 2024-01-01 10:30:00  (same minute)
2024-01-01 10:31:00 → 2024-01-01 10:31:00  (different minute)
```

**Why?**
- Clock skew (devices clocks off by seconds)
- Rounding differences
- Precision variations

**Trade-off**:
- Two events in same minute might collide
- Acceptable because: We can't distinguish them anyway
- Future improvement: Add sequence number

---

## 8. Request/Response Cycle

### Happy Path: New Event

```
Client
  │ POST /api/events
  │ { event: {...} }
  ▼
Server: Step 1 - Store raw event
  │ INSERT into raw_events
  │ Audit trail created ✓
  ▼
Server: Step 2 - Normalize
  │ Apply field mappings
  │ Convert types
  │ Result: clean canonical form ✓
  ▼
Server: Step 3 - Check duplicate
  │ Generate idempotency key
  │ Query: SELECT WHERE idempotency_key = ?
  │ Result: not found ✓
  ▼
Server: Step 4 - Process
  │ INSERT into processed_events
  │ Data is now safe ✓
  ▼
Server: Step 5 - Record idempotency
  │ INSERT into idempotency_keys
  │ Future retries will find this
  ▼
Server: Step 6 - Mark success
  │ UPDATE raw_events SET status = 'success'
  ▼
Client ◀ HTTP 200
  │ {
  │   success: true,
  │   processedEventId: 42,
  │   idempotencyKey: "..."
  │ }
  ▼
Done ✓
```

### Error Path: Duplicate Event

```
Client
  │ POST /api/events
  │ { event: {...} } ← Same as before
  ▼
Server: Step 1 - Store raw event
  ▼
Server: Step 2 - Normalize
  ▼
Server: Step 3 - Check duplicate
  │ Generate idempotency key (SAME as before)
  │ Query: SELECT WHERE idempotency_key = ?
  │ Result: FOUND in idempotency_keys! ✓
  ▼
Server: Step 4 - Return existing
  │ Don't process again
  │ Return the previous processedEventId
  ▼
Client ◀ HTTP 200
  │ {
  │   success: true,
  │   isDuplicate: true,
  │   processedEventId: 42  ← Same as first request
  │ }
  ▼
Done ✓ (No double-counting)
```

---

## 9. Extension Points

### Add New Client Format

```javascript
// In normalization.js, add:
clientMappings.client_C = {
  clientIdField: 'origin',
  metricField: 'type',
  amountField: 'sum',
  timestampField: 'time'
};

// Test with sample event:
// {
//   "origin": "client_C",
//   "type": "sale",
//   "sum": "500",
//   "time": "2024-01-01"
// }
```

### Add New Aggregation

```javascript
// In aggregation.js, add:
const getMedianByClient = (clientId) => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    // SQL to compute median
    db.all(..., (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

// In server.js, add route:
app.get('/api/median', async (req, res) => {
  const result = await getMedianByClient(req.query.clientId);
  res.json(result);
});
```

### Add Validation Rule

```javascript
// In normalization.js, modify validation:
const validateAmount = (amount) => {
  if (amount < 0) return false;     // No negative amounts
  if (amount > 999999) return false; // No absurdly large amounts
  return true;
};
```

---

## 10. Common Questions

### Q: What if the same event arrives 1 hour apart?

Different timestamps → different timeKey → different idempotency key → processed as two separate events ✓

### Q: What if two different events have same client + metric + amount?

Same idempotency key → treated as duplicate → processed once, then skipped

Can fix by: Adding sequence number or request ID to idempotency key

### Q: What if database is slower than network?

Client may timeout before database finishes. On retry:
- Event already processed? Check idempotency (safe)
- Idempotency check fails too? UNIQUE constraint catches it (safe)

### Q: What if we add a new aggregation query?

Just write a new SQL query function in aggregation.js. Can't break existing code.

### Q: How do we add authentication?

Add middleware to server.js before route handlers:
```javascript
app.use((req, res, next) => {
  // Check API key
  if (!req.headers['x-api-key']) return res.status(401).json(...);
  next();
});
```

---

## Summary

The system uses:

✅ **Idempotency Keys** - Prevent duplicate processing  
✅ **Type Conversion** - Clean canonical form  
✅ **Two-Phase Processing** - Data safety  
✅ **Database Constraints** - Automatic consistency  
✅ **Audit Trail** - Debugging and verification  
✅ **Clear Error Codes** - Client knows what to do  
✅ **Configuration-Based** - Easy to extend  

Each mechanism serves a specific purpose. Together, they create a safe, reliable system.
