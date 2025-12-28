/**
 * Normalization Layer
 * 
 * Converts raw, inconsistent events into a canonical format.
 * Handles:
 * - Field name variations across clients
 * - Type inconsistencies (strings vs numbers)
 * - Date format normalization
 * - Missing fields with sensible defaults
 * 
 * Design Decision: Use a client-specific configuration mapping approach
 * that's easy to extend without modifying core logic
 */

const Joi = require('joi');

// Client-specific field mappings
const clientMappings = {
  client_A: {
    clientIdField: 'source',
    metricField: 'payload.metric',
    amountField: 'payload.amount',
    timestampField: 'payload.timestamp'
  },
  client_B: {
    clientIdField: 'client',
    metricField: 'event_type',
    amountField: 'value',
    timestampField: 'event_time'
  },
  default: {
    clientIdField: 'source',
    metricField: 'metric',
    amountField: 'amount',
    timestampField: 'timestamp'
  }
};

/**
 * Get nested value from object using dot notation
 */
const getNestedValue = (obj, path) => {
  return path.split('.').reduce((current, prop) => current?.[prop], obj);
};

/**
 * Parse and normalize date to ISO 8601 format
 */
const normalizeDate = (dateValue) => {
  if (!dateValue) return null;
  
  try {
    // Handle various date formats
    let date;
    
    if (typeof dateValue === 'number') {
      // Timestamp in milliseconds or seconds
      date = new Date(dateValue > 1e10 ? dateValue : dateValue * 1000);
    } else if (typeof dateValue === 'string') {
      // Try parsing various formats
      // Format: 2024/01/01, 2024-01-01, etc
      date = new Date(dateValue);
    } else {
      return null;
    }
    
    if (isNaN(date.getTime())) return null;
    return date.toISOString();
  } catch (e) {
    return null;
  }
};

/**
 * Convert string to number safely
 */
const toNumber = (value) => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const num = parseFloat(value);
    return isNaN(num) ? null : num;
  }
  return null;
};

/**
 * Normalize a raw event to canonical format
 */
const normalizeEvent = (rawEvent) => {
  // Determine client and get appropriate mapping
  const clientId = rawEvent.source || rawEvent.client || 'unknown';
  const mapping = clientMappings[clientId] || clientMappings.default;
  
  try {
    // Extract fields using mapping
    const amount = toNumber(getNestedValue(rawEvent, mapping.amountField));
    const timestamp = normalizeDate(getNestedValue(rawEvent, mapping.timestampField));
    
    // Validate required fields
    if (amount === null || amount === undefined) {
      throw new Error('Missing or invalid amount field');
    }
    
    const normalized = {
      client_id: clientId,
      metric: getNestedValue(rawEvent, mapping.metricField) || 'unknown',
      amount: amount,
      timestamp: timestamp || new Date().toISOString(),
      raw_data: JSON.stringify(rawEvent)
    };
    
    return { success: true, data: normalized };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

/**
 * Schema validation for normalized events (optional, for strict mode)
 */
const normalizedEventSchema = Joi.object({
  client_id: Joi.string().required(),
  metric: Joi.string().required(),
  amount: Joi.number().required(),
  timestamp: Joi.string().isoDate().required()
});

const validateNormalized = (event) => {
  const { error, value } = normalizedEventSchema.validate(event, { abortEarly: false });
  return { valid: !error, errors: error?.details || [] };
};

module.exports = {
  normalizeEvent,
  validateNormalized,
  clientMappings
};
