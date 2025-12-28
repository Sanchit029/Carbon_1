# Visual Guides & Diagrams

This file contains ASCII diagrams to help visualize the system.

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     EXTERNAL CLIENTS                            │
│              (Unreliable, No Strict Schema)                     │
└────┬────────────────────────────────────────────────────────────┘
     │
     │ Raw JSON (inconsistent formats)
     ▼
┌──────────────────────────────────┐
│     INGESTION LAYER              │
│  (server.js: POST /api/events)   │
├──────────────────────────────────┤
│ 1. Receive raw event             │
│ 2. Store in raw_events (audit)   │
│ 3. Pass to normalization         │
└──────────┬───────────────────────┘
           │
           │ Raw Event ID
           ▼
┌──────────────────────────────────┐
│   NORMALIZATION LAYER            │
│  (normalization.js)              │
├──────────────────────────────────┤
│ 1. Extract fields (field mapping)│
│ 2. Convert types (str → num)     │
│ 3. Normalize dates (→ ISO 8601)  │
│ 4. Handle missing fields         │
└──────────┬────────────────────────┘
           │
     ┌─────┴──────┐
     │            │
 Success      Failure
     │            │
     ▼            ▼
Normalized   Record in
Event        failed_events
     │            │
     └────┬──────┘
          │
          ▼
    Continue if success
    
    
    ┌─────────────────────────────────────────┐
    │  DEDUPLICATION LAYER                    │
    │  (deduplication.js)                     │
    ├─────────────────────────────────────────┤
    │ 1. Generate idempotency key             │
    │    = SHA256(client + metric + amount)   │
    │      + timestamp(minute precision)      │
    │ 2. Check if key exists                  │
    └────────┬──────────────────────┬─────────┘
             │                      │
        Found (dup)            Not found
             │                      │
        Return                Continue
        existing ID
             │                      │
             └──────────┬───────────┘
                        │
                        ▼
        ┌──────────────────────────────────┐
        │  PROCESSING LAYER                │
        │  (processor.js)                  │
        ├──────────────────────────────────┤
        │ 1. INSERT into processed_events  │◀── CRITICAL
        │    (data is now safe)            │    (data saved)
        │ 2. INSERT into idempotency_keys  │
        │    (prevent future retries)      │
        │ 3. Update raw_events status      │
        │ 4. Return HTTP 200               │
        └──────────┬───────────────────────┘
                   │
                   │ Canonical Event Data
                   ▼
        ┌──────────────────────────────────┐
        │  AGGREGATION LAYER               │
        │  (aggregation.js)                │
        ├──────────────────────────────────┤
        │ Query processed_events:          │
        │ • COUNT by client                │
        │ • SUM by client                  │
        │ • AVG by client                  │
        │ • Filter by time range           │
        └──────────┬───────────────────────┘
                   │
                   │ Aggregated Results
                   ▼
        ┌──────────────────────────────────┐
        │  QUERY API LAYER                 │
        │  (server.js REST)                │
        ├──────────────────────────────────┤
        │ GET /api/aggregate               │
        │ GET /api/events                  │
        │ GET /api/failed                  │
        │ GET /api/summary                 │
        └──────────┬───────────────────────┘
                   │
                   │ JSON Response
                   ▼
        ┌──────────────────────────────────┐
        │  FRONTEND UI                     │
        │  (frontend/index.html)           │
        ├──────────────────────────────────┤
        │ • Event submission form          │
        │ • Failure simulation toggle      │
        │ • Aggregation dashboard          │
        │ • Processed events viewer        │
        │ • Failed events debugger         │
        └──────────────────────────────────┘
```

## Idempotency Key Generation

```
Event: {
  "source": "client_A",
  "payload": {
    "metric": "transaction",
    "amount": "1200",
    "timestamp": "2024-01-01 10:30:45"
  }
}
    │
    ├─ Extract client_id: "client_A"
    │
    ├─ Extract metric: "transaction"
    │
    ├─ Extract amount: 1200
    │
    └─ Round timestamp to minute:
       2024-01-01 10:30:00 → 1704110400000 ms
    
    
Now create key:
┌────────────────────────────────────────────┐
│ contentHash = SHA256({                     │
│   client_id: "client_A",                   │
│   metric: "transaction",                   │
│   amount: 1200                             │
│ })                                         │
│ = "a3f2b1c9d4e5f6g7..."                    │
│ = "a3f2b1c9" (first 8 chars)               │
│                                            │
│ timeKey = 1704110400000                    │
│                                            │
│ Idempotency Key =                          │
│   "client_A-1704110400000-a3f2b1c9"        │
└────────────────────────────────────────────┘

Next retry with SAME event:
- Same metric, amount, client
- Generate SAME key: "client_A-1704110400000-a3f2b1c9"
- Check database: KEY FOUND!
- Return existing processedEventId
- No reprocessing ✓
```

## Database Consistency Layers

```
                    Request with same event
                            │
                            ▼
                    Generate idempotency key
                            │
        ┌───────────────────┴──────────────────┐
        │                                      │
    Layer 1:                              Layer 2:
    Application Check                   Database Constraint
        │                                   │
    Check if key                       UNIQUE(idempotency_key)
    exists in table                    on processed_events
        │                                   │
    YES │ NO                                │
        │  │                                │
    Return  │ Try to INSERT ◄───────────────┤
    existing│                          If you try to
    ID      │                          insert duplicate:
        │   ├─ Success ✓              INSERT fails ✓
        │   │ Data saved              Error caught
        │   │ Record key              No corruption
        │   │                         
        │   └─ Failure                
        │     DB down                 
        │     ├─ Return 500           
        │     └─ On retry:            
        │        Layer 1 check        
        │        might still fail,    
        │        but Layer 2          
        │        catches it           

Result: Multiple independent safeguards
        Any one catches issues
        Data never corrupted
```

## Failure Scenario: Database Down

```
Request 1: Event X arrives

Ingestion  → Normalization → Dedup Check: not found
                             ↓
                    Try INSERT processed_events
                             │
                             ├─ ❌ DATABASE FAILS
                             │
                    Rollback (nothing saved)
                             │
                    Return HTTP 500
                             │
                    Response lost (network issue)


Request 2: Client retries (didn't get response)

Ingestion  → Normalization → Dedup Check: not found
                             ↓              (insert failed before)
                    Try INSERT processed_events
                             │
                             ├─ ✅ DATABASE RECOVERS
                             │
                    INSERT succeeds
                             │
                    Record in idempotency_keys
                             │
                    Return HTTP 200


Request 3: Client retries again (paranoid)

Ingestion  → Normalization → Dedup Check: FOUND!
                             ↓
                    Return existing ID
                             │
                    No INSERT (no reprocessing)
                             │
                    Return HTTP 200


Result:
• Data not lost (saved on 2nd attempt)
• Not double-counted (dedup caught 3rd)
• All requests return success or clear error
✓ System is consistent
```

## Type Conversion Pipeline

```
Input Event (Client A - nested, string amounts):
{
  "source": "client_A",
  "payload": {
    "metric": "transaction",
    "amount": "1200",
    "timestamp": "2024/01/01"
  }
}

         │
         ├─ Field extraction (using mapping)
         ├─ source → client_id: "client_A"
         ├─ payload.metric → metric: "transaction"
         ├─ payload.amount → amount (string): "1200"
         └─ payload.timestamp → timestamp: "2024/01/01"
         
         │
         ├─ Type conversion
         ├─ "transaction" (already string) → "transaction"
         ├─ "1200" (string) → 1200 (number) ✓
         └─ "2024/01/01" → "2024-01-01T00:00:00Z" ✓
         
         │
         ▼
Canonical Form:
{
  "client_id": "client_A",
  "metric": "transaction",
  "amount": 1200,
  "timestamp": "2024-01-01T00:00:00Z"
}

Same normalization for Client B → same output format ✓
Different format, same result
Aggregation can safely SUM(amount) - always a number
```

## Duplicate Detection Flow

```
┌─────────────────────────────────────────────────────┐
│ Timeline: Same event sent 3 times                  │
└─────────────────────────────────────────────────────┘

TIME        REQUEST                 DATABASE STATE
────────────────────────────────────────────────────

T0          Message 1               [empty]
  │         Event: metric=sale,     
  │         amount=100, client=A
  │                 │
  │         Generate key: "K1"
  │                 │
  │         Check: "K1" in table?
  │         Result: NO
  │                 │
  │         INSERT into processed:
  │         processedEventId = 42
  │                 │
  │         INSERT into idempotency:
  │         key="K1" → processedId=42
  │                 │
  │         ▼ Response: ✓ Success
  │
  │         processed_events:
  │         ├─ (42, "A", "sale", 100, ...)
  │         
  │         idempotency_keys:
  │         └─ ("K1", 42)


T1          Message 2               [from T0]
  │         (Network lost)
  │         Retry same event
  │                 │
  │         Generate key: "K1" ← SAME!
  │                 │
  │         Check: "K1" in table?
  │         Result: YES! Found!
  │                 │
  │         Don't INSERT again
  │                 │
  │         ▼ Response: ✓ Duplicate
  │           Return processedId=42
  │
  │         processed_events:
  │         ├─ (42, "A", "sale", 100, ...)
  │         [unchanged - no new INSERT]
  │         
  │         idempotency_keys:
  │         └─ ("K1", 42)


T2          Message 3               [from T1]
  │         Another retry
  │                 │
  │         Generate key: "K1" ← SAME!
  │                 │
  │         Check: "K1" in table?
  │         Result: YES! Found!
  │                 │
  │         Don't INSERT again
  │                 │
  │         ▼ Response: ✓ Duplicate
  │           Return processedId=42
  │
  │         processed_events:
  │         ├─ (42, "A", "sale", 100, ...)
  │         [still unchanged]
  │         
  │         idempotency_keys:
  │         └─ ("K1", 42)


RESULT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
3 identical requests
1 entry in database
0 double-counting
100% success responses
✓ System worked perfectly
```

## Aggregation Query (Safe from Duplicates)

```
Table: processed_events
┌──────────┬────────┬─────────┬────────────┐
│ id       │ client │ metric  │ amount     │
├──────────┼────────┼─────────┼────────────┤
│ 42       │ A      │ sale    │ 100        │◀─ From request 1
│ 43       │ A      │ sale    │ 200        │◀─ Separate event
│ 44       │ B      │ payment │ 50         │◀─ From client B
│ 45       │ A      │ sale    │ 150        │◀─ Another event
│ 46       │ B      │ payment │ 75         │◀─ Another from B
└──────────┴────────┴─────────┴────────────┘

Note: Even if requests 2 and 3 from diagram above
      were retried successfully, this table
      wouldn't have duplicates because:
      - Dedup check caught them
      - OR UNIQUE constraint would


Query: SELECT COUNT(*), SUM(amount) 
       FROM processed_events 
       GROUP BY client

Result:
┌────────┬───────┬──────────┐
│ client │ count │ total    │
├────────┼───────┼──────────┤
│ A      │ 3     │ 450      │ ← Correct!
│ B      │ 2     │ 125      │   (100+200+150)
└────────┴───────┴──────────┘         (50+75)

If requests 2 & 3 were accidentally processed:
- Would be 5 rows for client A
- SUM would be 650 (WRONG)

But they weren't, thanks to deduplication ✓
```

## Table Relationships

```
                  raw_events
                      │
                      ├─ Audit trail
                      ├─ Every request stored
                      ├─ status: success/failed/duplicate
                      └─ Can replay/debug
                          │
                          ├─ Validation passes?
                          │   YES ↓
                          │   processed_events
                          │   (canonical form)
                          │
                          └─ Validation fails?
                              NO ↓
                              failed_events
                              (errors)


                processed_events
                      │
            (safe, consistent data)
                      │
                      ├─ idempotency_key (UNIQUE)
                      │  ↓
                      │  idempotency_keys
                      │  (for deduplication)
                      │
                      └─ Used for:
                         ├─ Aggregation queries
                         ├─ Event listing
                         └─ Statistics


Consistency rule:
╔════════════════════════════════════════╗
║ ONLY QUERY processed_events            ║
║ NEVER include raw_events in results    ║
║ ⟹ Guarantees accuracy                  ║
╚════════════════════════════════════════╝
```

## HTTP Status Code Logic

```
Request arrives
        │
        ▼
    Validate
        │
    ┌───┴────┐
    │        │
  Valid    Invalid
    │        │
    ▼        ▼
Process   Record
          failure
    │        │
    ┌────┬───┘
    │    │
┌───┴─┐ │
│ DB? │ │
├─────┤ │
│ UP  │ │
│ ✓   │ │
└─┬───┘ │
  │     ▼
  │   HTTP 400
  │   {error: "Invalid amount"}
  │   (Client: fix data and retry)
  │
  ▼
Process
  │
  ├─ Success
  │   ▼
  │   HTTP 200
  │   {success: true}
  │   (Done!)
  │
  └─ Failure
      ▼
      HTTP 500
      {error: "Database error"}
      (Client: retry later)
```

These diagrams help visualize:
- ✅ Data flow from ingestion to API
- ✅ How idempotency prevents duplicates
- ✅ Database consistency safeguards
- ✅ Failure scenarios and recovery
- ✅ Type conversion pipeline
- ✅ Safe aggregation strategy
- ✅ Error response logic
