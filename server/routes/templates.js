/** 标注模板接口及字段结构校验。 */
const express = require('express');
const createCrudRouter = require('./crudFactory');
const { requireAuth } = require('../middleware/auth');
const { readArray, readEnum, readNumber, readString } = require('../utils/requestValidation');

const router = express.Router();
router.use(requireAuth);

const TASK_TYPES = [
  'image_classification',
  'object_detection',
  'semantic_segmentation',
  'text_ner',
];
const FIELD_TYPES = [
  'input',
  'textarea',
  'radio',
  'checkbox',
  'select',
  'rating',
  'switch',
  'title',
];
const OPTION_FIELD_TYPES = new Set(['radio', 'checkbox', 'select']);

function validateOption(option, fieldIndex, optionIndex) {
  if (!option || typeof option !== 'object' || Array.isArray(option)) {
    return `fields[${fieldIndex}].options[${optionIndex}] must be an object`;
  }
  for (const key of ['id', 'label', 'value']) {
    if (typeof option[key] !== 'string' || option[key].trim() === '') {
      return `fields[${fieldIndex}].options[${optionIndex}].${key} is required`;
    }
  }
  return null;
}

function validateTemplateFields(fields) {
  if (!Array.isArray(fields)) {
    return 'fields must be an array';
  }
  if (fields.length > 100) {
    return 'fields must contain at most 100 item(s)';
  }

  const keys = new Set();
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (!field || typeof field !== 'object' || Array.isArray(field)) {
      return `fields[${index}] must be an object`;
    }
    if (typeof field.id !== 'string' || field.id.trim() === '') {
      return `fields[${index}].id is required`;
    }
    if (!FIELD_TYPES.includes(field.type)) {
      return `fields[${index}].type must be one of: ${FIELD_TYPES.join(', ')}`;
    }
    if (typeof field.label !== 'string' || field.label.trim() === '') {
      return `fields[${index}].label is required`;
    }

    if (field.type !== 'title') {
      if (typeof field.fieldKey !== 'string' || field.fieldKey.trim() === '') {
        return `fields[${index}].fieldKey is required`;
      }
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field.fieldKey)) {
        return `fields[${index}].fieldKey must be a valid identifier`;
      }
      if (keys.has(field.fieldKey)) {
        return `fields[${index}].fieldKey must be unique`;
      }
      keys.add(field.fieldKey);
    }

    if (OPTION_FIELD_TYPES.has(field.type)) {
      if (!Array.isArray(field.options) || field.options.length === 0) {
        return `fields[${index}].options must contain at least one option`;
      }
      if (field.options.length > 200) {
        return `fields[${index}].options must contain at most 200 option(s)`;
      }
      for (let optionIndex = 0; optionIndex < field.options.length; optionIndex += 1) {
        const optionError = validateOption(field.options[optionIndex], index, optionIndex);
        if (optionError) return optionError;
      }
    }
  }

  return null;
}

function validateTemplatePayload(item, { partial = false } = {}) {
  const normalized = { ...item };

  if (!partial || Object.prototype.hasOwnProperty.call(normalized, 'name')) {
    const result = readString(normalized, 'name', {
      required: !partial,
      minLength: 1,
      maxLength: 100,
    });
    if (result.error) return result.error;
    if (result.value !== undefined) normalized.name = result.value;
  }

  if (Object.prototype.hasOwnProperty.call(normalized, 'description')) {
    const result = readString(normalized, 'description', { maxLength: 1000 });
    if (result.error) return result.error;
    normalized.description = result.value || '';
  } else if (!partial) {
    normalized.description = '';
  }

  if (!partial || Object.prototype.hasOwnProperty.call(normalized, 'type')) {
    const result = readEnum(normalized, 'type', TASK_TYPES, { required: !partial });
    if (result.error) return result.error;
    if (result.value !== undefined) normalized.type = result.value;
  }

  if (!partial || Object.prototype.hasOwnProperty.call(normalized, 'fields')) {
    const result = readArray(normalized, 'fields', { required: !partial, maxLength: 100 });
    if (result.error) return result.error;
    const fieldError = validateTemplateFields(result.value);
    if (fieldError) return fieldError;
    normalized.fields = result.value;
    normalized.fieldCount = result.value.length;
  } else if (Object.prototype.hasOwnProperty.call(normalized, 'fieldCount')) {
    const result = readNumber(normalized, 'fieldCount', { integer: true, min: 0, max: 100 });
    if (result.error) return result.error;
    normalized.fieldCount = result.value;
  }

  return normalized;
}

const crud = createCrudRouter('templates', {
  beforeCreate(item, req) {
    if (req.currentUser.role !== 'owner') {
      return 'Only owner can create templates';
    }

    const validated = validateTemplatePayload(item);
    if (typeof validated === 'string') {
      return validated;
    }

    if (!validated.creator && req.currentUser) {
      validated.creator = req.currentUser.username;
    }
    return validated;
  },
  beforeUpdate(_existing, updates, req) {
    if (req.currentUser.role !== 'owner') {
      return 'Only owner can update templates';
    }

    const validated = validateTemplatePayload(updates, { partial: true });
    if (typeof validated === 'string') {
      return validated;
    }
    return validated;
  },
  beforeDelete(_existing, req) {
    if (req.currentUser.role !== 'owner') {
      return 'Only owner can delete templates';
    }
    return undefined;
  },
});

router.use(crud);

module.exports = router;
