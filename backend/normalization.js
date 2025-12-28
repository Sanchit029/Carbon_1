const Joi = require('joi');

// different clients send data in different formats
// this maps where to find each field for each client
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

// helper to get nested values like "payload.metric"
const getNestedValue = (obj, path) => {
  return path.split('.').reduce((current, prop) => current?.[prop], obj);
};

// convert different date formats to standard format
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

// convert raw event to standard format
const normalizeEvent = (rawEvent) => {
  // figure out which client this is from
  const clientId = rawEvent.source || rawEvent.client || 'unknown';
  const mapping = clientMappings[clientId] || clientMappings.default;
  
  try {
    // get the fields we need
    const amount = toNumber(getNestedValue(rawEvent, mapping.amountField));
    const timestamp = normalizeDate(getNestedValue(rawEvent, mapping.timestampField));
    
    // amount is required
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

// validation schema (using Joi)
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
