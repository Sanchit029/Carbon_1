# Testing Guide

This guide helps you validate all aspects of the fault-tolerant system.

## Prerequisites

```bash
npm install
npm start
# Open http://localhost:3001
```

## Test Cases

### Test 1: Basic Event Processing

**Objective**: Verify events are processed and normalized correctly

**Steps**:
1. Go to "Submit Event" section
2. Click "Sample: Client A"
3. Click "Submit Event"
4. Verify:
   - ✓ Response shows `success: true`
   - ✓ Event appears in "Processed Events" tab
   - ✓ Amount is a number (not string)
   - ✓ Timestamp is ISO format

**Expected Result**: Event successfully processed and normalized

---

### Test 2: Duplicate Detection

**Objective**: Verify same event twice doesn't cause double counting

**Steps**:
1. Note current "Processed" count in summary
2. Click "Sample: Client A" (generates random amount)
3. Submit event → note the response JSON
4. Copy the exact event from response into editor
5. Submit the same event again
6. Verify:
   - ✓ Second response shows `isDuplicate: true`
   - ✓ Same `processedEventId` in both responses
   - ✓ "Processed" count increased by 1 (not 2)

**Expected Result**: Duplicate detected, not reprocessed

---

### Test 3: Validation Failure

**Objective**: Verify invalid events are rejected safely

**Steps**:
1. Paste invalid event:
```json
{
  "source": "client_A",
  "payload": {
    "metric": "test",
    "amount": "not_a_number",
    "timestamp": "2024/01/01"
  }
}
```
2. Click "Submit Event"
3. Verify:
   - ✓ HTTP 400 response
   - ✓ Error message about amount field
   - ✓ Event appears in "Failed Events" tab
   - ✓ Not in "Processed Events"

**Expected Result**: Invalid event rejected, error recorded

---

### Test 4: Missing Fields

**Objective**: Verify handling of incomplete events

**Steps**:
1. Submit event missing amount:
```json
{
  "source": "client_A",
  "payload": {
    "metric": "test",
    "timestamp": "2024/01/01"
  }
}
```
2. Verify:
   - ✓ Error response with clear message
   - ✓ Event in "Failed Events" with error reason

**Expected Result**: Missing required field handled gracefully

---

### Test 5: Database Failure Simulation

**Objective**: Verify system handles mid-request database failures

**Steps**:
1. Check "Simulate Database Failure" checkbox
2. Click "Sample: Client A"
3. Submit event
4. Verify:
   - ✓ HTTP 500 response
   - ✓ Error message about system error
   - ✓ Event NOT in "Processed Events"
   - ✓ Event NOT in "Failed Events" (system error, not validation)

**Expected Result**: Database error returns 500, data not lost

---

### Test 6: Format Variations (Client B)

**Objective**: Verify different client formats are normalized

**Steps**:
1. Click "Sample: Client B" (flat structure, different field names)
2. Submit event
3. Verify in "Processed Events":
   - ✓ client_id is "client_B"
   - ✓ metric shows event_type value
   - ✓ amount is a number
   - ✓ timestamp is ISO format

**Expected Result**: Different format correctly normalized

---

### Test 7: Aggregation Accuracy

**Objective**: Verify aggregation counts and totals are correct

**Setup**:
1. Submit 5 events from client_A with amounts: 100, 200, 300, 400, 500
2. Submit 3 events from client_B with amounts: 50, 50, 50

**Verify**:
1. Go to "Aggregation" tab
2. Check client_A:
   - ✓ Count = 5
   - ✓ Total = 1500
   - ✓ Average = 300
3. Check client_B:
   - ✓ Count = 3
   - ✓ Total = 150
   - ✓ Average = 50

**Expected Result**: Aggregation sums are accurate

---

### Test 8: Time Range Filtering

**Objective**: Verify aggregation filters by date range

**Steps**:
1. Submit events with dates: 2024-01-01, 2024-01-15, 2024-02-01
2. In Aggregation tab, set:
   - Start Date: 2024-01-01
   - End Date: 2024-01-31
3. Click "Filter"
4. Verify:
   - ✓ Only events from Jan 1-31 shown
   - ✓ Feb 1 event excluded

**Expected Result**: Date filtering works correctly

---

### Test 9: Statistics Refresh

**Objective**: Verify summary stats update automatically

**Steps**:
1. Note current "Processed" count
2. Submit a new event
3. Click "Refresh Statistics"
4. Verify:
   - ✓ "Processed" count increased by 1
   - ✓ "Total Amount" increased
   - ✓ "Success Rate" adjusted

**Expected Result**: Stats reflect recent changes

---

### Test 10: Retry Idempotency (Manual)

**Objective**: Verify HTTP-level retry safety

**Using curl**:

```bash
# First submission
curl -X POST http://localhost:3001/api/events \
  -H "Content-Type: application/json" \
  -d '{
    "event": {
      "source": "test_client",
      "payload": {"metric": "test", "amount": "100", "timestamp": "2024/01/01"}
    }
  }'

# Save the processedEventId from response, then retry:

curl -X POST http://localhost:3001/api/events \
  -H "Content-Type: application/json" \
  -d '{
    "event": {
      "source": "test_client",
      "payload": {"metric": "test", "amount": "100", "timestamp": "2024/01/01"}
    }
  }'
```

**Verify**:
- ✓ First response: `success: true, isDuplicate: false`
- ✓ Second response: `success: true, isDuplicate: true`
- ✓ Same `processedEventId` in both

**Expected Result**: Retry returns same event ID, prevents double-processing

---

## Load Testing (Optional)

Generate multiple events rapidly:

```javascript
// In browser console
async function stress() {
  for (let i = 0; i < 50; i++) {
    fetch('http://localhost:3001/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: {
          source: 'client_A',
          payload: {
            metric: 'stress_test',
            amount: Math.random() * 1000,
            timestamp: '2024/01/01'
          }
        }
      })
    });
    await new Promise(r => setTimeout(r, 100));
  }
}
stress();
```

Then verify:
- ✓ Server remains responsive
- ✓ No duplicate processing despite overlap
- ✓ All events eventually appear in UI

---

## Debugging

### Check Database Directly

```bash
sqlite3 backend/data.db

# See all processed events
SELECT client_id, metric, amount, timestamp FROM processed_events;

# See failed events
SELECT error_message, raw_data FROM failed_events;

# See idempotency keys
SELECT * FROM idempotency_keys LIMIT 10;

# See raw event audit trail
SELECT source, processing_status FROM raw_events;
```

### Check Server Logs

The server prints logs to console:
- Processing errors
- Warnings about idempotency key recording failures
- Database connection issues

### Common Issues

**Issue**: "CORS error in browser console"
- Solution: Make sure server is running on port 3001

**Issue**: "Database locked" error
- Solution: SQLite is running another operation. Try refreshing page, or restart server

**Issue**: Duplicate detection not working
- Solution: Check that submitted events have same client_id and amount. Timestamps rounded to minute for deduplication.

---

## Success Criteria

✅ All tests pass  
✅ No manual data loss observed  
✅ Duplicate detection prevents double-counting  
✅ Database failures result in clear errors  
✅ Format variations are handled  
✅ Aggregations are accurate  
✅ UI is responsive  
