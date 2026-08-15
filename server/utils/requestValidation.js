/** 请求体读取工具的 JavaScript 运行版本。 */

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readString(body, field, options = {}) {
  if (!isPlainObject(body)) {
    return { error: 'Request body must be an object' };
  }

  const value = body[field];
  const required = options.required === true;
  if (value === undefined || value === null) {
    return required ? { error: `${field} is required` } : { value: undefined };
  }
  if (typeof value !== 'string') {
    return { error: `${field} must be a string` };
  }

  const normalized = options.trim === false ? value : value.trim();
  if (required && normalized.length === 0) {
    return { error: `${field} is required` };
  }
  if (options.minLength !== undefined && normalized.length < options.minLength) {
    return { error: `${field} must be at least ${options.minLength} characters` };
  }
  if (options.maxLength !== undefined && normalized.length > options.maxLength) {
    return { error: `${field} must be at most ${options.maxLength} characters` };
  }
  if (options.pattern && !options.pattern.test(normalized)) {
    return { error: options.patternMessage || `${field} has invalid format` };
  }

  return { value: normalized };
}

function validateFields(body, fields) {
  const values = {};
  for (const field of fields) {
    const result = readString(body, field.name, field);
    if (result.error) {
      return { error: result.error, values };
    }
    if (result.value !== undefined) {
      values[field.name] = result.value;
    }
  }
  return { values };
}

function readNumber(body, field, options = {}) {
  if (!isPlainObject(body)) {
    return { error: 'Request body must be an object' };
  }

  const value = body[field];
  const required = options.required === true;
  if (value === undefined || value === null || value === '') {
    return required ? { error: `${field} is required` } : { value: undefined };
  }

  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return { error: `${field} must be a finite number` };
  }
  if (options.integer && !Number.isInteger(normalized)) {
    return { error: `${field} must be an integer` };
  }
  if (options.min !== undefined && normalized < options.min) {
    return { error: `${field} must be greater than or equal to ${options.min}` };
  }
  if (options.max !== undefined && normalized > options.max) {
    return { error: `${field} must be less than or equal to ${options.max}` };
  }

  return { value: normalized };
}

function readEnum(body, field, allowedValues, options = {}) {
  const result = readString(body, field, options);
  if (result.error || result.value === undefined) {
    return result;
  }
  if (!allowedValues.includes(result.value)) {
    return { error: `${field} must be one of: ${allowedValues.join(', ')}` };
  }
  return result;
}

function readArray(body, field, options = {}) {
  if (!isPlainObject(body)) {
    return { error: 'Request body must be an object' };
  }

  const value = body[field];
  const required = options.required === true;
  if (value === undefined || value === null) {
    return required ? { error: `${field} is required` } : { value: undefined };
  }
  if (!Array.isArray(value)) {
    return { error: `${field} must be an array` };
  }
  if (options.minLength !== undefined && value.length < options.minLength) {
    return { error: `${field} must contain at least ${options.minLength} item(s)` };
  }
  if (options.maxLength !== undefined && value.length > options.maxLength) {
    return { error: `${field} must contain at most ${options.maxLength} item(s)` };
  }

  return { value };
}

module.exports = {
  isPlainObject,
  readString,
  readNumber,
  readEnum,
  readArray,
  validateFields,
};
