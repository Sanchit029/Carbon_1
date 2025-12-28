# Documentation Index

Welcome to the Fault-Tolerant Data Processing System! Here's how to navigate the documentation.

## 🚀 Start Here

**New to the project?** Start with one of these:

1. **[QUICKSTART.md](QUICKSTART.md)** (5 minutes)
   - How to install and run the system
   - Quick hands-on trial
   - Basic troubleshooting

2. **[OVERVIEW.md](OVERVIEW.md)** (10 minutes)
   - Visual summary of the system
   - How idempotency works
   - Why data isn't lost in failures
   - Best for: Quick understanding

## 📚 Main Documentation

### For Assignment Review

**[README.md](README.md)** ⭐ **REQUIRED READING**
- Answers all assignment questions:
  - ✅ What assumptions did you make?
  - ✅ How does your system prevent double counting?
  - ✅ What happens if the database fails mid-request?
  - ✅ What would break first at scale?
- Design decisions and trade-offs
- API reference
- Database schema
- Production roadmap

### For Deep Understanding

**[ARCHITECTURE.md](ARCHITECTURE.md)**
- Complete system flow diagram
- All failure scenarios explained
- Data flow examples
- Design decision rationale
- Extensibility points
- Best for: Understanding how everything fits together

**[DESIGN_RATIONALE.md](DESIGN_RATIONALE.md)**
- Why each decision was made
- Alternatives considered
- Trade-offs accepted
- Consistency guarantees
- Best for: Understanding the "why" behind design choices

### For System Behavior

**[OVERVIEW.md](OVERVIEW.md)** (Already listed above)
- Problem statement
- Solution architecture
- Idempotency in action
- Failure handling examples
- Best for: Visual learners

## 🧪 Testing & Validation

**[TESTING.md](TESTING.md)**
- 10 detailed test cases
- Step-by-step validation procedures
- Database debugging commands
- Load testing guidance
- Troubleshooting tips
- Best for: Validating the system works

## 📋 File Descriptions

### Code Files

**Backend** (`backend/`)
- `server.js` - Express API server and REST endpoints
- `database.js` - SQLite initialization and schema
- `normalization.js` - Convert raw events to canonical form
- `deduplication.js` - Idempotency key generation
- `processor.js` - Event processing pipeline
- `aggregation.js` - Query and aggregation functions

**Frontend** (`frontend/`)
- `index.html` - Complete web UI

**Configuration**
- `package.json` - Dependencies and scripts
- `clients.config.js` - Example client formats

### Documentation Files

| File | Purpose | Read When |
|------|---------|-----------|
| **README.md** | Main documentation | First (answers assignment Q's) |
| **QUICKSTART.md** | Getting started | You want to run it in 5 min |
| **OVERVIEW.md** | Visual summary | You want quick understanding |
| **ARCHITECTURE.md** | System design | You want complete picture |
| **DESIGN_RATIONALE.md** | Decision explanations | You want to understand "why" |
| **TESTING.md** | Test scenarios | You want to validate system |
| **DELIVERABLES.md** | What's included | You want to see what's done |
| **This file** | Navigation guide | You're here! |

## 🎯 Reading Paths

### Path 1: "I have 5 minutes" 🏃
1. [QUICKSTART.md](QUICKSTART.md) - How to run
2. Run the system and try it
3. Check [OVERVIEW.md](OVERVIEW.md) - Visual summary

### Path 2: "I need to review the assignment" 📋
1. [README.md](README.md) - Read fully
   - Assumptions
   - Deduplication strategy
   - Failure handling
   - Scalability issues
2. [DESIGN_RATIONALE.md](DESIGN_RATIONALE.md) - Understand decisions

### Path 3: "I want to understand everything" 🔍
1. [OVERVIEW.md](OVERVIEW.md) - Big picture
2. [README.md](README.md) - Complete details
3. [ARCHITECTURE.md](ARCHITECTURE.md) - System design
4. [DESIGN_RATIONALE.md](DESIGN_RATIONALE.md) - Why each decision
5. Code in `backend/` - Implementation details

### Path 4: "I want to test/validate it" ✅
1. [QUICKSTART.md](QUICKSTART.md) - Get it running
2. [TESTING.md](TESTING.md) - Test cases
3. Run through test scenarios
4. Check database with SQLite commands

### Path 5: "I want to modify/extend it" 🔧
1. [ARCHITECTURE.md](ARCHITECTURE.md) - Understand structure
2. [DESIGN_RATIONALE.md](DESIGN_RATIONALE.md) - Understand decisions
3. Look at extensibility points in code comments
4. Check `clients.config.js` for adding clients

## 📊 Key Concepts Explained

### Idempotency Key
- **What**: Unique fingerprint of an event
- **Why**: Prevents double-processing on retries
- **How**: Content hash + timestamp (minute precision)
- **Where**: See "How The System Prevents Double Counting" in [README.md](README.md)
- **Visual**: See [OVERVIEW.md](OVERVIEW.md) section "Idempotency In Action"

### Database Failure Safety
- **What**: System stays consistent even if database dies mid-write
- **Why**: Two-layer protection (idempotency check + UNIQUE constraint)
- **How**: Explained in [README.md](README.md) "Database Failure Mid-Request"
- **Diagram**: [ARCHITECTURE.md](ARCHITECTURE.md) "Scenario 2: Database Failure"

### Normalization
- **What**: Converting unreliable client formats to standard form
- **Why**: Clients don't follow schema, change formats, use different field names
- **How**: Configuration-based field mappings per client
- **Code**: `backend/normalization.js`
- **Example**: [OVERVIEW.md](OVERVIEW.md) "Client Format Variations Handled"

### Data Consistency
- **What**: Ensuring counts are accurate despite failures
- **Why**: Duplicates cause double-counting, partial failures lose data
- **How**: Only query processed_events, separate raw_events for audit
- **Guarantee**: See "Database Consistency Guarantees" in [OVERVIEW.md](OVERVIEW.md)

## 💡 FAQ

**Q: Where are answers to the assignment questions?**
A: [README.md](README.md) - Search for:
- "Assumptions Made"
- "How The System Prevents Double Counting"
- "What Happens If The Database Fails Mid-Request"
- "What Would Break First At Scale"

**Q: How do I run this?**
A: [QUICKSTART.md](QUICKSTART.md) - 3 commands:
```bash
npm install
npm start
# Open http://localhost:3001
```

**Q: How does duplicate detection work?**
A: 
1. Quick: [OVERVIEW.md](OVERVIEW.md) "Idempotency In Action"
2. Detailed: [README.md](README.md) "How System Prevents Double Counting"
3. Code: `backend/deduplication.js`

**Q: What if database fails?**
A: [README.md](README.md) "What Happens if The Database Fails Mid-Request"

**Q: What breaks at scale?**
A: [README.md](README.md) "What Would Break First At Scale"

**Q: Can I extend/modify it?**
A: See [DESIGN_RATIONALE.md](DESIGN_RATIONALE.md) "Extensibility Points" and code comments

**Q: How do I test it?**
A: [TESTING.md](TESTING.md) - 10 test scenarios with step-by-step instructions

**Q: What files do I need to read?**
A: Minimum: [README.md](README.md)  
Recommended: [README.md](README.md) + [ARCHITECTURE.md](ARCHITECTURE.md)  
Complete: All docs in reading paths above

## 🗂️ Directory Structure

```
fault-tolerant-system/
│
├── 📄 README.md ⭐           # Main documentation
├── 📄 QUICKSTART.md          # Getting started
├── 📄 OVERVIEW.md            # Visual summary
├── 📄 ARCHITECTURE.md        # System design
├── 📄 DESIGN_RATIONALE.md    # Why decisions were made
├── 📄 TESTING.md             # How to test
├── 📄 DELIVERABLES.md        # What's included
├── 📄 INDEX.md               # This file
│
├── 📚 backend/               # Backend code
│   ├── server.js
│   ├── database.js
│   ├── normalization.js
│   ├── deduplication.js
│   ├── processor.js
│   └── aggregation.js
│
├── 🎨 frontend/              # Frontend code
│   └── index.html
│
├── ⚙️ package.json           # Dependencies
└── 📋 clients.config.js      # Client format guide
```

## 🎓 Learning Resources

If you want to learn system design concepts used here:

- **Idempotency**: Search "idempotent operations"
- **Database constraints**: UNIQUE, FOREIGN KEY
- **Audit trails**: Why companies log everything
- **API design**: REST, HTTP status codes
- **Error handling**: Try-catch, two-phase commits (simplified)
- **Scaling challenges**: Database sharding, write bottlenecks

## 🚀 Next Steps

1. **Run It**: Follow [QUICKSTART.md](QUICKSTART.md)
2. **Understand It**: Read [OVERVIEW.md](OVERVIEW.md)
3. **Deep Dive**: Read [README.md](README.md)
4. **Test It**: Follow [TESTING.md](TESTING.md)
5. **Modify It**: Check [DESIGN_RATIONALE.md](DESIGN_RATIONALE.md)

---

**Have questions?** Check the [FAQ](#-faq) or read the relevant documentation above.

**Found an issue?** All code is commented to explain logic.

**Want to extend it?** See extensibility points in [ARCHITECTURE.md](ARCHITECTURE.md) and code comments.

Enjoy! 🚀
