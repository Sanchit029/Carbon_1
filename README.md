# Fault-Tolerant Data Processing System

A robust, production-ready data ingestion and processing system designed to handle unreliable clients, schema variations, duplicates, and partial failures gracefully.

## Quick Start

```bash
# Install dependencies
npm install

# Start the server (backend + frontend)
npm start

# Server runs on http://localhost:3001
```

Access the UI at `http://localhost:3001`

## System Architecture

### Overview

```
Raw Events → Ingestion → Normalization → Deduplication → Storage → Aggregation → Query API
    ↓           ↓            ↓              ↓               ↓
  audit      validate    canonical     idempotency    processed_events
  trail       errors       form         tracking
```

### Key Components

1. **Ingestion Layer** (`backend/server.js`)
   - REST API endpoint: `POST /api/events`
   - Accepts raw, unvalidated events from clients
   - Stores raw events for audit trail

2. **Normalization Layer** (`backend/normalization.js`)
   - Converts inconsistent event formats to canonical form
   - Handles field name variations (client-specific mappings)
   - Normalizes data types (strings → numbers, date formats)
   - Handles missing fields with sensible defaults

3. **Deduplication Layer** (`backend/deduplication.js`)
   - Generates idempotency keys from content hash
   - Detects and prevents duplicate processing
   - Safe against client retries

4. **Processing Pipeline** (`backend/processor.js`)
   - Orchestrates the complete flow
   - Handles partial failures safely
   - Maintains transaction-like semantics

5. **Aggregation Layer** (`backend/aggregation.js`)
   - Queries only processed events (canonical form)
   - Supports filtering by client and time range
   - Extensible for new aggregation types

6. **Frontend UI** (`frontend/index.html`)
   - Manual event submission with JSON editing
   - Failure simulation for testing
   - Real-time views of processed/failed events
   - Aggregation dashboard

## Design Decisions & Assumptions

### Assumptions Made

1. **No Microservices**: System runs as single Node.js process with SQLite
   - Simpler to understand and debug
   - Suitable for understanding core concepts
   - Can be decomposed later if needed

2. **SQLite Database**: Used for simplicity and portability
   - All data persists to `backend/data.db`
   - Good enough for learning system design
   - Not suitable for production at scale (see "What Would Break First")

3. **Client Identification**: Using `source` or `client` field
   - Assumption: Events include some form of client identifier
   - Fallback to "unknown" if missing

4. **Timestamp Handling**: 
   - If missing, use current time
   - Support multiple date formats (ISO, slash-separated, etc)
   - Normalize all to ISO 8601 internally

5. **No Authentication**: As per requirements, not implemented
   - System assumes trusted clients
   - In production, would add OAuth/JWT

### Design Trade-offs

| Decision | Benefits | Trade-offs |
|----------|----------|-----------|
| **Content-hash based idempotency** | Works without client-assigned IDs | Two identical events look like duplicates |
| **Minute-precision timestamp grouping** | Handles clock skew | Very similar events within minute treated as same |
| **Separate raw_events table** | Audit trail, debugging | Extra storage, slightly slower writes |
| **SQLite** | Simple, portable, no setup | Not distributed, single-threaded bottleneck |
| **Configurable field mappings** | Easy to add new clients | Still requires code update for new format |

## How The System Prevents Double Counting

### Problem
Clients may resend events due to:
- Network timeouts
- Unsure if request succeeded
- Retry logic
- No unique event IDs

### Solution: Idempotency Key

```
Idempotency Key = ClientID + TimeKey + ContentHash

Example: "client_A-1705334400000-a3f2b1c9d4e5f6g7"
```

**Strategy:**
1. Generate key from: `client_id` + `metric` + `amount` + `timestamp (rounded to minute)`
2. Check if key exists in `idempotency_keys` table
3. If exists: Return the previously processed event ID (no reprocessing)
4. If new: Process normally and record key

**Key Insight:** We don't rely on client-provided IDs (fragile). Instead, we create a deterministic key from the event content that will be the **same** for retries of the same event.

### Data Flow for Duplicates

```
Request 1: Event X
  → Generate idempotency key "key_1"
  → Check: Not found
  → Process & store
  → Record in idempotency_keys table
  → Response: { success: true, processedEventId: 42 }

Request 2: Event X (retry, same content)
  → Generate idempotency key "key_1"
  → Check: Found! (points to processedEventId: 42)
  → Return: { success: true, isDuplicate: true, processedEventId: 42 }
  → No reprocessing, no double counting
```

## What Happens If The Database Fails Mid-Request

### Scenario
```
1. Event received
2. Normalized successfully
3. Idempotency check: new event (OK)
4. Insert into processed_events: ❌ FAIL (database error)
5. Client retries
```

### Current System Behavior

**On initial failure:**
- Database error occurs during INSERT
- Transaction fails, no data written
- Return HTTP 500 to client
- Client should retry

**On retry:**
- Request comes again
- Generates same idempotency key
- Idempotency check: "not found" (because previous INSERT failed)
- Try to process again → if DB still works, succeeds
- If DB still down, fails again

### Protection Against Data Loss

```
Two failure points:

Point A: processed_events INSERT fails
├─ Data not written
├─ Client gets error (500)
├─ Retry will attempt again
└─ Safe: No data lost, just delayed

Point B: idempotency_keys INSERT fails (after processed_events succeeded)
├─ processed_events was written ✓
├─ idempotency_keys NOT written
├─ Idempotency check will "miss" next retry
├─ Would reprocess same event ❌
└─ BUT: UNIQUE constraint on processed_events.idempotency_key
   will catch duplicate, fail with constraint error
   and data consistency maintained
```

### Consistency Guarantees

1. **No Lost Data**: If processed_events INSERT succeeds, data is stored
2. **No Silent Duplicates**: If idempotency recording fails, UNIQUE constraint on `processed_events.idempotency_key` prevents corruption
3. **Client Always Gets Error or Success**: Database failures return 500, allowing retries

### Limitations

In the current implementation, if network fails between successful database write and sending response:

```
1. Event processed ✓
2. Response sent ❌ (network fails)
3. Client doesn't know if succeeded
4. Client may retry
5. Idempotency key check catches it (safe)
```

This is the limitation of HTTP-level retries without explicit acknowledgment protocols. In production, would use:
- Message queues with acknowledgments
- Idempotency tokens explicit in request header
- WAL (Write-Ahead Logging) in database

## API Reference

### Ingest Event
```
POST /api/events

Body:
{
  "event": { ... raw event object ... },
  "simulateFailure": false
}

Response (200):
{
  "success": true,
  "processedEventId": 42,
  "idempotencyKey": "client_A-...",
  "rawEventId": 1
}

Response (400 - Validation Error):
{
  "success": false,
  "error": "Invalid amount field"
}

Response (500 - System Error):
{
  "success": false,
  "error": "database error",
  "message": "System error during processing. Event may be retried."
}
```

### Get Aggregation
```
GET /api/aggregate?clientId=client_A&startDate=2024-01-01&endDate=2024-01-31

Response:
{
  "success": true,
  "data": [
    {
      "client_id": "client_A",
      "count": 42,
      "total": 50400.50,
      "average": 1200.01
    }
  ]
}
```

### Get Processed Events
```
GET /api/events?clientId=client_A

Response:
{
  "success": true,
  "data": [
    {
      "id": 1,
      "client_id": "client_A",
      "metric": "transaction",
      "amount": 1200,
      "timestamp": "2024-01-01T00:00:00Z",
      "processed_at": "2024-12-28T10:30:00Z"
    }
  ]
}
```

### Get Failed Events
```
GET /api/failed

Response:
{
  "success": true,
  "data": [
    {
      "error_message": "Invalid amount field",
      "raw_data": "{ ... }",
      "failed_at": "2024-12-28T10:30:00Z"
    }
  ]
}
```

### Get Summary
```
GET /api/summary

Response:
{
  "success": true,
  "data": {
    "totalProcessed": 150,
    "totalFailed": 3,
    "totalAmount": 180500.00,
    "successRate": "98.04%"
  }
}
```

## Testing Strategies

### 1. Normal Processing
```
Submit: { source: "client_A", payload: { metric: "test", amount: "100", timestamp: "2024/01/01" } }
→ Should appear in "Processed Events"
→ Should appear in "Aggregation"
```

### 2. Duplicate Detection
```
Submit same event twice
→ First time: success
→ Second time: isDuplicate: true, same processedEventId
→ Count in aggregation should NOT increase
```

### 3. Failure Simulation
```
Check "Simulate Database Failure"
Submit event
→ Should get HTTP 500 error
→ Event should NOT appear in processed events
→ Event should NOT appear in failed events (system error, not validation error)
```

### 4. Format Variations
```
Submit event with different field names (client_B style)
→ Should normalize correctly
→ Amount should be a number
→ Timestamp should be ISO format
```

### 5. Missing Fields
```
Submit event with missing amount
→ Should appear in "Failed Events"
→ Should have error message
```

## Database Schema

```sql
raw_events
├── id (PK)
├── received_at
├── raw_data (JSON string)
├── source
└── processing_status (pending/success/failed/duplicate)

processed_events
├── id (PK)
├── client_id
├── metric
├── amount
├── timestamp
├── idempotency_key (UNIQUE)
├── raw_event_id (FK)
└── processed_at

idempotency_keys
├── idempotency_key (PK)
├── processed_event_id (FK)
└── created_at

failed_events
├── id (PK)
├── raw_event_id (FK)
├── error_message
├── raw_data
└── failed_at
```

## What Would Break First At Scale

### 1. **Single SQLite Process** (100+ req/sec)
- SQLite uses file-level locking
- Only one writer at a time
- Bottleneck: I/O operations
- **Solution**: PostgreSQL or cloud database

### 2. **Memory Usage** (1M+ events)
- Node.js single process → limited memory
- Queries loading all results into memory
- **Solution**: Pagination, streaming, clustering

### 3. **Idempotency Key Generation** (identical events)
- If many clients send identical events within same minute
- Will be treated as duplicates (intended behavior, but...)
- May be too strict if events are genuinely different
- **Solution**: Add sequence number or client request ID to key

### 4. **Missing Indices** (complex queries)
- Current indices: `client_id + timestamp`
- If querying by metric, error message, etc. → full table scans
- **Solution**: Add more indices based on query patterns

### 5. **No Sharding** (terabytes of data)
- Single database = single failure point
- No geographic distribution
- **Solution**: Database sharding by client_id or time

### 6. **Synchronous Processing** (failures take too long)
- If database is slow, client request blocks
- Cascading timeout failures
- **Solution**: Async job queue (Bull, RabbitMQ)

### 7. **No Monitoring** (production issues)
- No logging of processing times
- No metrics on error rates
- **Solution**: Add Prometheus metrics, structured logging

### 8. **Normalization is Hardcoded** (new client formats)
- Adding new client requires code change
- **Solution**: Store mappings in database, hot-reload

## Production Roadmap

1. ✅ **Correct semantics** (this system)
2. → **PostgreSQL** (distributed, transactions)
3. → **Redis** (cache, idempotency cache, rate limiting)
4. → **Message Queue** (async processing, resilience)
5. → **Observability** (logging, metrics, tracing)
6. → **Horizontal Scaling** (load balancer, multiple instances)
7. → **Event Streaming** (Kafka for high throughput)

## Summary

This system demonstrates:
- ✅ Clean separation of concerns (normalization, deduplication, aggregation)
- ✅ Robust duplicate detection without relying on fragile IDs
- ✅ Partial failure handling with clear error cases
- ✅ Safe retry semantics via idempotency
- ✅ Extensible design for new clients and aggregations
- ✅ Thoughtful trade-offs documented

The implementation prioritizes **correctness** and **clarity** over performance—intentional choices that set a foundation for scaling.
