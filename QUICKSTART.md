# Quick Start Guide

## 1. Installation

```bash
# Navigate to project
cd fault-tolerant-system

# Install Node.js dependencies
npm install
```

## 2. Start the Server

```bash
npm start
```

You should see:
```
Server running on http://localhost:3001
Frontend: http://localhost:3001
```

## 3. Open in Browser

Navigate to: **http://localhost:3001**

## 4. Try It Out (5 minutes)

### 4.1 Submit Your First Event

1. Click "Sample: Client A"
2. Click "Submit Event"
3. Go to "Processed Events" tab
4. Your event should appear!

### 4.2 Test Duplicate Detection

1. Copy the event from the editor
2. Click "Submit Event" again with the same event
3. Notice the response says `isDuplicate: true`
4. The event count in "Aggregation" tab stays the same (no double-counting!)

### 4.3 View Aggregated Results

1. Go to "Aggregation" tab
2. See total count and sum for each client
3. Try filtering by date range

### 4.4 Simulate Failure

1. Check "Simulate Database Failure"
2. Click "Sample: Client A"
3. Click "Submit Event"
4. Notice: HTTP 500 error
5. Uncheck the checkbox
6. This error handling demonstrates system resilience

## 5. Database

The SQLite database is automatically created at:
```
backend/data.db
```

To inspect it:
```bash
sqlite3 backend/data.db
sqlite> SELECT * FROM processed_events LIMIT 5;
sqlite> .quit
```

## 6. API Endpoints (for programmatic use)

### Ingest Event
```bash
curl -X POST http://localhost:3001/api/events \
  -H "Content-Type: application/json" \
  -d '{
    "event": {
      "source": "client_A",
      "payload": {
        "metric": "transaction",
        "amount": "100.50",
        "timestamp": "2024/01/01"
      }
    }
  }'
```

### Get Aggregation
```bash
curl http://localhost:3001/api/aggregate?clientId=client_A
```

### Get Processed Events
```bash
curl http://localhost:3001/api/events?clientId=client_A
```

### Get Summary Stats
```bash
curl http://localhost:3001/api/summary
```

## 7. Key Features to Explore

✅ **Format Variations**: Try "Sample: Client B" with different field names  
✅ **Duplicate Prevention**: Submit same event twice, see isDuplicate flag  
✅ **Failure Handling**: Check "Simulate Database Failure" and observe HTTP 500  
✅ **Validation**: Try submitting invalid JSON or missing fields  
✅ **Filtering**: Aggregate results by date range and client  
✅ **Error Tracking**: View failed events with error messages  

## 8. File Structure

```
fault-tolerant-system/
├── package.json              # Dependencies
├── README.md                 # Full documentation
├── TESTING.md                # Comprehensive test cases
├── ARCHITECTURE.md           # System design & diagrams
├── clients.config.js         # Client configuration guide
├── setup.sh                  # Setup script
├── backend/
│   ├── server.js            # Express server & API routes
│   ├── database.js          # SQLite initialization
│   ├── normalization.js     # Data normalization
│   ├── deduplication.js     # Idempotency & duplicate detection
│   ├── processor.js         # Event processing pipeline
│   ├── aggregation.js       # Aggregation queries
│   └── data.db              # SQLite database (auto-created)
└── frontend/
    └── index.html           # Web UI (served at root)
```

## 9. Stopping the Server

Press `Ctrl+C` in the terminal

## 10. Reset Everything

```bash
# Stop the server (Ctrl+C)

# Delete the database
rm backend/data.db

# Restart
npm start
```

Fresh database will be created with empty tables.

## 11. Troubleshooting

### Port 3001 already in use
```bash
# Kill process on port 3001
lsof -i :3001
kill -9 <PID>
npm start
```

### CORS errors in browser console
Make sure server is running on port 3001 before opening the UI

### "Database is locked" errors
SQLite is single-threaded. Just refresh the page or restart server.

### Can't connect to localhost:3001
- Check server is running (should print "Server running on...")
- Check you're using http:// not https://
- Try http://127.0.0.1:3001 instead

## 12. Next Steps

- Read [README.md](README.md) for full system documentation
- Read [ARCHITECTURE.md](ARCHITECTURE.md) for design decisions
- Read [TESTING.md](TESTING.md) for comprehensive test cases
- Explore the code in `backend/` to understand the layers
- Modify `clients.config.js` to add new client formats

---

**Questions?** Check the documentation files or review the code comments!
