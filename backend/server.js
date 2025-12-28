const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase } = require('./database');
const { processEvent } = require('./processor');
const { getAggregation, getProcessedEvents, getFailedEvents, getSummary } = require('./aggregation');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// setup database
initDatabase().catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

// endpoint to receive events from clients
app.post('/api/events', async (req, res) => {
  try {
    const { event, simulateFailure } = req.body;
    
    if (!event) {
      return res.status(400).json({
        success: false,
        error: 'Missing event in request body'
      });
    }
    
    const result = await processEvent(event, simulateFailure || false);
    
    if (!result.success && result.isSystemError) {
      // System error (database failure) - 500
      return res.status(500).json({
        success: false,
        error: result.error,
        message: 'System error during processing. Event may be retried.'
      });
    }
    
    if (!result.success && !result.isSystemError) {
      // Validation error - 400
      return res.status(400).json(result);
    }
    
    // Success (including duplicates)
    return res.status(200).json(result);
    
  } catch (error) {
    console.error('Unexpected error in event endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// get aggregated data
app.get('/api/aggregate', async (req, res) => {
  try {
    const { clientId, startDate, endDate } = req.query;
    
    const filters = {};
    if (clientId) filters.client_id = clientId;
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;
    
    const result = await getAggregation(filters);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error getting aggregation:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// get processed events
app.get('/api/events', async (req, res) => {
  try {
    const { clientId, startDate, endDate } = req.query;
    
    const filters = {};
    if (clientId) filters.client_id = clientId;
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;
    
    const result = await getProcessedEvents(filters);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error getting events:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// get failed events
app.get('/api/failed', async (req, res) => {
  try {
    const result = await getFailedEvents();
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error getting failed events:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// get system summary stats
app.get('/api/summary', async (req, res) => {
  try {
    const result = await getSummary();
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Error getting summary:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
