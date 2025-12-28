const { getDb } = require('./database');

// get counts and totals grouped by client
const getAggregation = (filters = {}) => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    let query = 'SELECT client_id, COUNT(*) as count, SUM(amount) as total FROM processed_events WHERE 1=1';
    const params = [];
    
    if (filters.client_id) {
      query += ' AND client_id = ?';
      params.push(filters.client_id);
    }
    
    if (filters.startDate) {
      query += ' AND timestamp >= ?';
      params.push(filters.startDate);
    }
    
    if (filters.endDate) {
      query += ' AND timestamp <= ?';
      params.push(filters.endDate);
    }
    
    query += ' GROUP BY client_id';
    
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else {
        const aggregated = rows.map(row => ({
          client_id: row.client_id,
          count: row.count,
          total: row.total,
          average: row.total / row.count
        }));
        resolve(aggregated);
      }
    });
  });
};

// get list of processed events
const getProcessedEvents = (filters = {}) => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    let query = 'SELECT * FROM processed_events WHERE 1=1';
    const params = [];
    
    if (filters.client_id) {
      query += ' AND client_id = ?';
      params.push(filters.client_id);
    }
    
    if (filters.startDate) {
      query += ' AND timestamp >= ?';
      params.push(filters.startDate);
    }
    
    if (filters.endDate) {
      query += ' AND timestamp <= ?';
      params.push(filters.endDate);
    }
    
    query += ' ORDER BY processed_at DESC LIMIT 100';
    
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

// get failed events for debugging
const getFailedEvents = () => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    db.all(
      'SELECT * FROM failed_events ORDER BY failed_at DESC LIMIT 50',
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
};

// get summary stats for dashboard
const getSummary = () => {
  return new Promise((resolve, reject) => {
    const db = getDb();
    
    const queries = [
      new Promise((res) => {
        db.get('SELECT COUNT(*) as count FROM processed_events', (err, row) => {
          res(err ? 0 : row.count);
        });
      }),
      new Promise((res) => {
        db.get('SELECT COUNT(*) as count FROM failed_events', (err, row) => {
          res(err ? 0 : row.count);
        });
      }),
      new Promise((res) => {
        db.get('SELECT SUM(amount) as total FROM processed_events', (err, row) => {
          res(err ? 0 : row.total || 0);
        });
      })
    ];
    
    Promise.all(queries).then(([processed, failed, totalAmount]) => {
      resolve({
        totalProcessed: processed,
        totalFailed: failed,
        totalAmount: totalAmount,
        successRate: processed + failed > 0 ? (processed / (processed + failed) * 100).toFixed(2) + '%' : 'N/A'
      });
    });
  });
};

module.exports = {
  getAggregation,
  getProcessedEvents,
  getFailedEvents,
  getSummary
};
