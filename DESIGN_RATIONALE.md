# System Design Decisions & Rationale

## Core Decisions Made

### 1. Idempotency Key Strategy

**Decision**: Use content hash (SHA256 of metric + amount + client_id) + minute-rounded timestamp

**Rationale**:
- No reliance on fragile client-provided IDs
- Same event retried = exact same key = no reprocessing
- Deterministic (same input always produces same key)

**Why not alternatives?**
- Client-provided IDs: Clients may not provide, may be wrong, may duplicate with other clients
- Timestamps alone: Fragile, different devices have different time
- Database sequence: Can't identify duplicates without storing first
- UUID: New ID each time, defeats deduplication purpose

**Trade-off**: Events that are identical except for sequence number will collide
- Acceptable because: Can't distinguish them without unique IDs anyway
- Mitigated by: Adding sequence number to idempotency key (future improvement)

---

### 2. Separate Raw vs Processed Tables

**Decision**: Store both raw_events (audit) and processed_events (canonical)

**Rationale**:
- Audit trail: Can see exactly what clients sent
- Debugging: Can understand why events failed
- Separation of concerns: Raw input ≠ canonical form

**Why not single table?**
- Raw data is messy: Different field names, types, formats
- Canonical form is clean: Standard structure for aggregation
- Mixing them causes: Confusion about what's "real"

**Trade-off**: Extra storage (roughly doubles data)
- Acceptable because: Raw data is small, storage is cheap
- Benefit: Can replay, debug, audit later

---

### 3. Normalization via Configuration

**Decision**: Store field mappings per client in code (easily moved to DB later)

**Rationale**:
- New clients can be added without modifying processing logic
- Keeps processor.js clean and simple
- Configuration is clear and obvious

**Why not alternatives?**
- Hardcode per-client logic: Scattered everywhere, hard to change
- Single schema: Can't handle format variations
- Schema inference: Fragile, requires ML/heuristics

**Trade-off**: Still requires code change to add new client
- Future improvement: Move mappings to database, hot-reload
- Current limitation: Server restart needed

---

### 4. Validation Approach

**Decision**: Fail fast with clear error message, don't transform invalid data

**Rationale**:
- Invalid data should not be processed
- Clients need to know what went wrong
- Clear distinction between validation error (400) vs system error (500)

**Why not alternatives?**
- Silently drop invalid events: Client never knows, loses visibility
- Auto-correct data: Risks corrupting data
- Partial acceptance: Some fields missing, others added (confusing)

**Result**: Failed events are clearly marked with specific error reasons

---

### 5. Database Choice: SQLite

**Decision**: Use SQLite (not PostgreSQL, MongoDB, etc.)

**Rationale**:
- Simple: No server to run, just a file
- Portable: Can share file easily
- Good for: Understanding system design without infrastructure
- Suitable for: Hundreds of events/day

**Why not alternatives?**
- PostgreSQL: Overkill for learning, requires server
- MongoDB: Schemaless is worse for data integrity
- Redis: In-memory, data lost on restart

**Trade-off**: Doesn't scale beyond single machine
- Acknowledged in README: "What breaks first at scale"
- Fine for 60-minute assignment showing system thinking
- Production would use PostgreSQL

---

### 6. Single-Process Architecture

**Decision**: Single Node.js server, not microservices

**Rationale**:
- Focus on system thinking, not infrastructure
- Easier to understand data flow
- Simpler to debug and test

**Why not microservices?**
- Too much infrastructure complexity
- Hides core concepts in deployment details
- Assignment says "Please do not add Docker or microservices"

**Trade-off**: Can't scale horizontally
- Fine for assignment scope
- Migration path exists (separate layers can become services)

---

### 7. Idempotency Recording

**Decision**: Record in separate idempotency_keys table AFTER successful processing

**Rationale**:
- Two-phase approach: Process first, then mark complete
- If response is lost: Client retries, key exists, no reprocessing
- Even if idempotency record fails: UNIQUE constraint catches duplicates

**Why this order?**
- Process first: Ensures data exists before marking as processed
- Record second: If fails, data is safe (just won't prevent duplicate retry)
- Alternative (record first): Risks marking as processed without saving data

**Safety guarantee**:
- Level 1: Idempotency key check (optimal path)
- Level 2: UNIQUE constraint on processed_events (fallback)
- Both work together to prevent corruption

---

### 8. Frontend Architecture

**Decision**: Single-file HTML with vanilla JavaScript, no framework

**Rationale**:
- No build step needed
- Easier to understand: Just HTML, CSS, JavaScript
- Shows: System works without complex frontend setup

**Why not React/Vue?**
- Overkill for this complexity level
- Requires build tools and dependencies
- Hides what the system is actually doing

**Result**: Interactive UI that clearly shows all system behavior

---

### 9. Error Handling Strategy

**Decision**: Distinguish validation errors (400) from system errors (500)

```
Validation Error (400)          System Error (500)
├─ Invalid amount               ├─ Database connection failed
├─ Missing required field       ├─ Disk full
├─ Malformed date               ├─ Network timeout
└─ Can fix by changing data     └─ Can fix by retrying
```

**Rationale**:
- Client knows what went wrong
- Different retry strategies apply
- Clear error messages in response

---

### 10. Aggregation Query Design

**Decision**: Query ONLY processed_events, never raw_events

**Rationale**:
- Consistent results regardless of partial failures
- Raw data is messy, aggregation should be on canonical form
- Prevents accidental double-counting of raw events

**Why not include raw events?**
- Raw events may not be processed
- Raw events have inconsistent formats
- Would give wrong totals (might aggregate same event twice)

**Result**: Aggregation is correct even with retries and failures

---

## Trade-offs Accepted

| Tradeoff | Accepted | Reasoning |
|----------|----------|-----------|
| Idempotency collisions | ✅ | Can't distinguish events without client IDs |
| Extra storage (raw+processed) | ✅ | Audit trail is worth it |
| Manual client format updates | ✅ | Future: Move to database |
| Single SQLite writer | ✅ | Sufficient for 60-min demo |
| No horizontal scaling | ✅ | Foundation is there to scale |

---

## Design Patterns Used

### 1. Separation of Concerns
- Ingestion, Normalization, Deduplication, Aggregation are separate modules
- Each has single responsibility
- Easy to replace individual layer

### 2. Configuration over Convention
- Client field mappings are configurable
- Not scattered in processing logic
- Easy to add new clients

### 3. Audit Trail Pattern
- Raw events stored separately
- Can understand what happened
- Regulatory compliance ready

### 4. Idempotency Key Pattern
- Deterministic key from content
- Safe retries without special protocols
- Works with HTTP retry semantics

### 5. Layered Validation
- Check 1: Required fields exist
- Check 2: Types are correct
- Check 3: Database constraints (UNIQUE)

### 6. Read-Only Aggregation
- Aggregation queries never write
- Can be cached, replicated
- Always consistent with processed data

---

## Consistency Model

The system maintains consistency through:

1. **Idempotency Keys**: Prevent duplicate processing
2. **UNIQUE Constraints**: Database-level duplicate prevention
3. **Separate Tables**: Clear separation of raw vs canonical
4. **Audit Trail**: Can verify correctness
5. **Deterministic Normalization**: Same input → same output

## Failure Handling Guarantees

```
Level 1: No Data Loss
├─ If processed_events INSERT succeeds → data saved ✓
├─ If it fails → return 500, client can retry ✓
└─ No lost data either way ✓

Level 2: No Double Counting
├─ If retry happens → same idempotency key ✓
├─ If idempotency key found → don't reprocess ✓
├─ If not found (idempotency record failed)
│   → Try to INSERT again
│   → UNIQUE constraint fails (already exists)
│   → Caught as duplicate ✓
└─ No double counting either way ✓

Level 3: Clear Error Reporting
├─ Validation error → HTTP 400, clear message ✓
├─ System error → HTTP 500, can retry ✓
└─ Client knows what to do ✓
```

---

## What This Design Enables

✅ **Confident Retries**: Clients can safely retry without fear of duplication  
✅ **Format Evolution**: New client formats can be added without breaking existing ones  
✅ **Debugging**: Raw events stored for audit trail and troubleshooting  
✅ **Scaling Path**: Each layer can become a service later  
✅ **Type Safety**: Canonical form ensures consistent data types  
✅ **Error Visibility**: Failures are tracked and queryable  
✅ **Future Growth**: Extensible design for new aggregations  

---

## Decisions NOT Made (Intentionally)

❌ **Authentication**: Assignment says no auth needed  
❌ **Encryption**: Assignment focuses on system design, not security  
❌ **Distributed Transactions**: Single database sufficient  
❌ **Message Queues**: Synchronous sufficient for scope  
❌ **Monitoring**: Code comments document behavior  
❌ **Rate Limiting**: Not required by assignment  
❌ **Complex Validation**: Joi schema available but kept simple  

---

## Summary

This design prioritizes:

1. **Correctness** - Data integrity > performance
2. **Clarity** - Easy to understand what's happening
3. **Extensibility** - Foundation for scaling
4. **Observability** - Can see what happened (audit trail)
5. **Simplicity** - No over-engineering

The result is a system that confidently handles the challenges described in the assignment while remaining easy to understand and modify.
