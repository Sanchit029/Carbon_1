/**
 * Client Configuration
 * 
 * This file documents how to add support for new clients with different
 * event formats without modifying core processing logic.
 * 
 * Key Principle: Separate configuration from code
 */

module.exports = {
  clients: {
    client_A: {
      description: 'Standard client with source and nested payload',
      eventExample: {
        source: 'client_A',
        payload: {
          metric: 'transaction',
          amount: '1200',
          timestamp: '2024/01/01'
        }
      },
      fieldMappings: {
        clientIdField: 'source',
        metricField: 'payload.metric',
        amountField: 'payload.amount',
        timestampField: 'payload.timestamp'
      }
    },
    client_B: {
      description: 'Alternative client with flat structure and different field names',
      eventExample: {
        client: 'client_B',
        event_type: 'payment',
        value: 1200,
        event_time: '2024-01-01T00:00:00Z'
      },
      fieldMappings: {
        clientIdField: 'client',
        metricField: 'event_type',
        amountField: 'value',
        timestampField: 'event_time'
      }
    },
    default: {
      description: 'Fallback for unknown clients - uses standard field names',
      fieldMappings: {
        clientIdField: 'source',
        metricField: 'metric',
        amountField: 'amount',
        timestampField: 'timestamp'
      }
    }
  },

  /**
   * HOW TO ADD A NEW CLIENT
   * 
   * Step 1: Add configuration to clients.js
   * 
   * Step 2: Update normalization.js clientMappings object:
   *   clientMappings.client_C = {
   *     clientIdField: 'origin',
   *     metricField: 'type',
   *     amountField: 'sum',
   *     timestampField: 'time'
   *   }
   * 
   * Step 3: Test with sample event from UI
   * 
   * FUTURE IMPROVEMENT: Load mappings from database to support
   * hot-reloading new client configurations without server restart
   */
};
