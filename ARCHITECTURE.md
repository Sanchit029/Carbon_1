# Architecture Diagram

## System Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        EXTERNAL CLIENTS                         │
│                    (Unreliable, No Schema)                      │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  │ Raw Events (JSON)
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                    INGESTION LAYER                              │
│              POST /api/events (Express.js)                      │
├─────────────────────────────────────────────────────────────────┤
│  • Receive raw event                                            │
│  • Store in raw_events table (audit trail)                      │
│  • Return rawEventId                                            │
└─────────────────┬───────────────────────────────────────────────┘
                  │
                  │ Raw Event ID
                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                  NORMALIZATION LAYER                            │
│           (normalization.js + client config)                    │
├─────────────────────────────────────────────────────────────────┤
│  • Extract client_id                                            │
│  • Map fields: metric, amount, timestamp                        │
│  • Convert types: strings → numbers                             │
│  • Normalize dates: various formats → ISO 8601                  │
│  • Handle missing fields                                        │
└──────────────────┬──────────────────────────────────────────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
   Success             Fail (Validation Error)
        │                     │
        │                     ▼
        │          ┌─────────────────────────┐
        │          │  Record in failed_events│
        │          │  Return HTTP 400        │
        │          └─────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────────┐
│                   DEDUPLICATION LAYER                            │
│        (deduplication.js: Idempotency Key Generation)            │
├──────────────────────────────────────────────────────────────────┤
│  Idempotency Key = SHA256(client_id + metric + amount)           │
│                  + TimeKey(timestamp rounded to minute)          │
│                                                                  │
│  1. Check: Does key exist in idempotency_keys?                  │
│  ├─ YES → isDuplicate = true, return existing ID                │
│  └─ NO  → Continue to processing                                │
└──────────────────┬───────────────────────────────────────────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
    Duplicate            New Event
        │                     │
        ▼                     ▼
   Return 200          Continue to Storage
   isDuplicate: true
   processedEventId: X


┌──────────────────────────────────────────────────────────────────┐
│              PROCESSING PIPELINE (if new event)                  │
│                  (processor.js orchestration)                    │
├──────────────────────────────────────────────────────────────────┤
│  1. Receive normalized event                                    │
│  2. Check simulateFailure flag                                  │
│  3. INSERT into processed_events                                │
│     ├─ Database fails → HTTP 500, data lost, retry needed       │
│     └─ Database succeeds → Row inserted, event preserved ✓      │
│  4. Record idempotency_key → idempotency_keys                   │
│     ├─ Record fails → Already processed, safe (not lost)        │
│     └─ Record succeeds → Retry-safe, prevent double-processing  │
│  5. Update raw_events status to "success"                       │
│  6. Return HTTP 200 with processedEventId                       │
└──────────────────┬───────────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────────┐
│                  DATABASE TABLES                                 │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  raw_events                    processed_events                 │
│  ├─ id (PK)                   ├─ id (PK)                        │
│  ├─ received_at              ├─ client_id                      │
│  ├─ raw_data (JSON)          ├─ metric                         │
│  ├─ source                   ├─ amount (REAL)                  │
│  └─ processing_status        ├─ timestamp (ISO)                │
│                              ├─ idempotency_key (UNIQUE) ◄──┐  │
│  Audit trail of all input    ├─ raw_event_id (FK) ◄────────┼──┤
│                              └─ processed_at                    │
│                                                                 │
│  idempotency_keys            failed_events                     │
│  ├─ idempotency_key (PK)    ├─ id (PK)                        │
│  ├─ processed_event_id (FK) ├─ raw_event_id (FK)              │
│  └─ created_at              ├─ error_message                  │
│                              ├─ raw_data (JSON)                │
│  Maps keys to processed     └─ failed_at                       │
│  events for dedup           Records validation failures        │
│                                                                  │
└──────────────────┬───────────────────────────────────────────────┘
                   │
                   │ Canonical Data
                   │ (only from processed_events)
                   ▼
┌──────────────────────────────────────────────────────────────────┐
│                  AGGREGATION LAYER                               │
│                (aggregation.js - Queries only)                  │
├──────────────────────────────────────────────────────────────────┤
│  Queries:                                                        │
│  • COUNT(*) GROUP BY client_id                                  │
│  • SUM(amount) GROUP BY client_id                               │
│  • AVG(amount) GROUP BY client_id                               │
│  • Filter by: client_id, timestamp range                        │
│                                                                  │
│  CRITICAL: Never query raw_events for aggregation               │
│  ↓ Ensures consistency despite retries and failures             │
└──────────────────┬───────────────────────────────────────────────┘
                   │
                   │ Aggregated Results
                   ▼
┌──────────────────────────────────────────────────────────────────┐
│                      QUERY API LAYER                             │
│                    (server.js REST endpoints)                   │
├──────────────────────────────────────────────────────────────────┤
│  GET /api/aggregate      → Aggregated metrics                   │
│  GET /api/events         → Processed events (canonical)         │
│  GET /api/failed         → Failed events (for debugging)        │
│  GET /api/summary        → Statistics                           │
└──────────────────┬───────────────────────────────────────────────┘
                   │
                   │ JSON Response
                   ▼
┌──────────────────────────────────────────────────────────────────┐
│                       FRONTEND UI                                │
│                  (frontend/index.html)                          │
├──────────────────────────────────────────────────────────────────┤
│  • Event submission form (manual + samples)                     │
│  • Failure simulation toggle                                    │
│  • Aggregation dashboard with filtering                         │
│  • Processed events viewer                                      │
│  • Failed events debugger                                       │
│  • System statistics                                            │
└──────────────────────────────────────────────────────────────────┘
```

## Failure Scenarios & Recovery

### Scenario 1: Invalid Event

```
Client A submits event with missing amount
                        │
                        ▼
              Normalization fails
                        │
                        ▼
          Record in failed_events table
                        │
                        ▼
            Return HTTP 400 with error
                        │
                        ▼
         ✓ Data preserved for debugging
         ✓ Client knows what went wrong
         ✓ No retry needed (validation failure)
```

### Scenario 2: Database Failure During Write

```
Event normalized successfully
                        │
                        ▼
          INSERT into processed_events
                        │
                        ▼
             ❌ Database connection lost
                        │
                        ▼
              Return HTTP 500
                        │
        ┌───────────────┴───────────────┐
        │                               │
    Client retries              Network fails
        │                         (no response)
        ▼                               │
 Fresh attempt              Client retries again
 (same content)                      │
        │                           ▼
        ▼                     Fresh attempt
 Check idempotency key    (same content)
 "not found"                       │
 (prev write failed)               ▼
        │                 Check idempotency key
        ▼                 "not found"
 Attempt again                   │
        │                        ▼
        ├─ If DB fixed → success ✓
        └─ If DB still down → HTTP 500
        
Result: Either succeeds or clear error
        No silent failures
```

### Scenario 3: Duplicate Submission

```
Request 1                          Request 2 (retry)
Submit Event                       Submit identical Event
        │                                  │
        ├─ Normalize ✓                    ├─ Normalize ✓
        ├─ Generate key: "K1"              ├─ Generate key: "K1" (same!)
        ├─ Check "K1": not found          ├─ Check "K1": FOUND!
        │                                 │
        ├─ INSERT into processed_events   └─ Return:
        │   → succeeds ✓                      {
        │                                       success: true,
        ├─ Record in idempotency_keys         isDuplicate: true,
        │   → succeeds ✓                      processedEventId: 42
        │                                    }
        └─ Return:
            {
              success: true,
              isDuplicate: false,
              processedEventId: 42
            }

Count in aggregation: 1 (not 2) ✓
```

### Scenario 4: Idempotency Recording Fails

```
Event processed:
        │
        ├─ Normalized ✓
        ├─ INSERT processed_events ✓
        │
        ├─ INSERT idempotency_key
        │   ❌ FAILS (network/disk)
        │
        ├─ Raw event marked "success"
        │   (data is safe in processed_events!)
        │
        └─ Return 500 to client

Client retries:
        │
        └─ Check idempotency: "not found"
           (because insert failed before)
           
           ├─ Try to INSERT processed_events again
           │   ❌ UNIQUE constraint violation!
           │      (idempotency_key must be unique)
           │
           └─ Error caught, data consistency maintained ✓
           
RESULT: Safe due to database constraints
        Even when idempotency table write fails
```

## Key Design Decisions

| Layer | Decision | Why | Trade-off |
|-------|----------|-----|-----------|
| **Ingestion** | Store raw events | Audit trail, debugging | Extra storage |
| **Normalization** | Config-based mappings | Add new clients without code change | Still needs restart |
| **Deduplication** | Content-hash idempotency key | No client IDs required | Very similar events in same minute collide |
| **Processing** | Separate raw/processed | Clear separation, avoid double-processing | Extra table, join complexity |
| **Storage** | SQLite | Simple, portable | Doesn't scale, single writer |
| **Aggregation** | Query only processed_events | Consistency guaranteed | Can't use raw_events for debugging counts |

## Extensibility Points

### Add New Client Format
→ Update `clientMappings` in `normalization.js`

### Add New Aggregation Type
→ Add function to `aggregation.js`

### Change Deduplication Strategy
→ Modify `generateIdempotencyKey` in `deduplication.js`

### Store Validation Rules
→ Add Joi schema per client in `normalization.js`

### Add Authentication
→ Middleware in `server.js` before route handlers

### Switch Database
→ Replace `database.js` initialization, keep interface same
