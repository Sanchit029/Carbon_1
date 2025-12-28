# System Overview

## Problem We're Solving

```
Clients send events:
❌ No strict schema          → Solution: Normalization layer
❌ Format changes            → Solution: Configurable mappings  
❌ May resend events         → Solution: Idempotency keys
❌ May fail mid-request      → Solution: Partial failure handling
❌ Duplicate processing risk → Solution: Deduplication
```

## Solution Architecture

```
Raw Events
    ↓
[Ingest] → Store raw data (audit trail)
    ↓
[Normalize] → Convert to canonical form
    ↓
[Deduplicate] → Check if seen before
    ├─ YES → Return existing ID (no reprocessing)
    └─ NO  → Continue
    ↓
[Store] → Save to processed_events
    ↓
[Aggregation] → Query for insights
    ↓
[API/UI] → Expose results
```

## Key Innovation: Idempotency Key

Without unique event IDs from clients, we create our own:

```
Idempotency Key = Hash(client_id + metric + amount + timestamp_minute)

Result: Same event retried = same key = no double-processing
```

## Data Structure

```
raw_events (audit trail)
    ↓
    ├─→ passed normalization?
    │       ├─ YES → processed_events (canonical form)
    │       │       ├─→ idempotency_keys (dedup lookup)
    │       │       └─→ Aggregation queries ✓
    │       └─ NO  → failed_events (with error)
    │
    └─ Used for: Debugging, understanding what went wrong
```

## Failure Handling

### Case 1: Event Already Processed (Duplicate)
```
Request 1 → Processed ✓ → DB record created
Request 2 → Check key → Found in idempotency_keys
            → Return same ID
            → No reprocessing ✓
            → Count doesn't increase ✓
```

### Case 2: Database Fails During Write
```
Request → Normalize OK → Try to INSERT
          ❌ DB fails
          → Return HTTP 500
          → Client can retry
          → On retry: key not found (write failed)
          → Try again (safe to retry)
```

### Case 3: Validation Fails
```
Request → Normalization fails (invalid amount)
          → Record in failed_events
          → Return HTTP 400
          → Not counted in aggregation ✓
          → Error reason stored for debugging
```

## What Gets Counted

```
Aggregation counts ONLY:
┌──────────────────┐
│ processed_events │  ← Canonical form
└──────────────────┘
        ↑
        │
   Never raw_events
     (would be wrong)
```

## Idempotency In Action

```
SCENARIO: Same event sent 3 times

Message 1: Send event X (amount: $100, client: A, metric: sales)
           → Generate key: "A-1704067200000-hash123"
           → Not in idempotency_keys
           → INSERT into processed_events
           → Record key in idempotency_keys
           → Response: {success: true, processedEventId: 42}

Message 2: Network lost, client retries same event
           → Generate key: "A-1704067200000-hash123" (SAME!)
           → Check idempotency_keys: FOUND!
           → Return: {success: true, isDuplicate: true, processedEventId: 42}
           → No INSERT (no double-counting)

Message 3: Client retries again after failure
           → Generate key: "A-1704067200000-hash123" (SAME!)
           → Check idempotency_keys: FOUND!
           → Return: {success: true, isDuplicate: true, processedEventId: 42}

RESULT: All 3 requests return successfully, but only 1 entry in database ✓
```

## Database Consistency Guarantees

```
Level 1: Idempotency Check
    └─ Prevents unnecessary reprocessing

Level 2: UNIQUE Constraint
    └─ processed_events.idempotency_key UNIQUE
    └─ If level 1 fails, this catches it

Level 3: Audit Trail
    └─ raw_events stores all input
    └─ Can verify correctness later

Result: No data corruption even with failures ✓
```

## Client Format Variations Handled

```
Client A:
{
  "source": "client_A",
  "payload": {
    "metric": "transaction",
    "amount": "1200",
    "timestamp": "2024/01/01"
  }
}
        ↓ Different fields, different structure
        ↓ Normalization handles both!
Client B:
{
  "client": "client_B",
  "event_type": "payment",
  "value": 1200,
  "event_time": "2024-01-01T00:00:00Z"
}

Both end up as:
{
  "client_id": "...",
  "metric": "...",
  "amount": 1200,           ← Always a number
  "timestamp": "2024-01-01T00:00:00Z"  ← Always ISO
}
```

## Statistics Computed

```
From processed_events:

For each client:
├─ count: How many events
├─ total: Sum of amounts
├─ average: total / count

System-wide:
├─ totalProcessed: Count of successful events
├─ totalFailed: Count of validation failures
├─ totalAmount: Sum of all amounts
└─ successRate: Percentage processed successfully
```

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| /api/events | POST | Ingest raw event |
| /api/aggregate | GET | Aggregated statistics |
| /api/events | GET | List processed events |
| /api/failed | GET | Debug failed events |
| /api/summary | GET | System statistics |

## Files & Their Role

```
database.js       → SQLite schema & initialization
normalization.js  → Convert any format to canonical
deduplication.js  → Idempotency key generation & checking
processor.js      → Orchestrate the 7-step pipeline
aggregation.js    → Query interface for analytics
server.js         → REST API (routes & responses)
frontend/index.html → User interface (submit & view)
```

## Limitations & Future Work

```
Current:
✅ Simple, correct, easy to understand
✅ Good for hundreds of events/day
✅ Single process, SQLite

Doesn't scale to:
❌ Thousands of req/sec (SQLite bottleneck)
❌ Terabytes of data (single database)
❌ Multiple servers (no replication)

To scale:
→ PostgreSQL (distributed, transactions)
→ Redis (cache, idempotency cache)
→ Message queue (async, resilience)
→ Horizontal scaling (load balancer)
```

## Success Criteria Met

✅ Handles unreliable clients (schema variations, missing fields)  
✅ Prevents duplicate processing (idempotency keys)  
✅ Safe against partial failures (UNIQUE constraints, audit trail)  
✅ Consistent aggregations (queries canonical form only)  
✅ Extensible (add clients without code changes)  
✅ Clear error messages (validation vs system errors)  
✅ Auditable (stores raw events)  
✅ Testable (UI + API)  

## Next Steps to Use

1. `npm install`
2. `npm start`
3. Open http://localhost:3001
4. Try "Sample: Client A"
5. Click "Submit Event"
6. Check "Aggregation" tab
7. Try duplicate detection (submit same event twice)
8. Check "Simulate Database Failure" to test error handling

**That's the whole system!** 🚀

---

For deep dives, see:
- **README.md** - Full documentation & design decisions
- **ARCHITECTURE.md** - System design diagrams & explanations
- **TESTING.md** - How to test every feature
- **QUICKSTART.md** - Getting started in 5 minutes
