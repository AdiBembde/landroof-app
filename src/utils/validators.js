'use strict';
// Schema-based input cleaning shared by all models.
//
// A schema maps field name → rule:
//   { type: 'text'|'int'|'bool'|'email'|'phone'|'url'|'date'|'enum', max, min, required, default, values }
// sanitize() returns { data, error }. In "partial" mode (updates) only fields present
// in the input are returned, so a field that is sent empty is cleared, and a field
// that is not sent keeps its old value. Required fields sent empty are ignored in
// partial mode, so they keep their old value too.
//
// Email and phone use the same rules as the website forms (shared/validation.js).
const shared = require('../../shared/validation');

function str(v, max = 500) {
  return String(v ?? '').trim().slice(0, max);
}

function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function isEmail(v) {
  return !shared.rules.email(v, { required: true }).error;
}

function cleanValue(rule, raw) {
  switch (rule.type) {
    case 'int': {
      const n = toInt(raw);
      if (n === null) return rule.default ?? 0;
      return Math.min(Math.max(n, rule.min ?? -Infinity), rule.max ?? Infinity);
    }
    case 'bool':
      return raw === true || raw === 1 || raw === '1' || raw === 'true' || raw === 'on' ? 1 : 0;
    case 'enum': {
      const v = str(raw, 60);
      return rule.values.includes(v) ? v : (rule.default ?? rule.values[0]);
    }
    case 'url': {
      const v = str(raw, rule.max || 500);
      return /^https?:\/\//i.test(v) ? v : '';
    }
    case 'date': {
      const v = str(raw, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
    }
    default:
      return str(raw, rule.max || 500);
  }
}

function sanitize(schema, input = {}, { partial = false } = {}) {
  const data = {};
  for (const [field, rule] of Object.entries(schema)) {
    if (rule.type === 'image') continue; // files are handled by the upload middleware
    const present = input[field] !== undefined;
    if (!present) {
      if (partial) continue;
      if (rule.required) return { error: `${rule.label || field} is required` };
      data[field] = rule.default ?? (rule.type === 'int' || rule.type === 'bool' ? 0 : '');
      continue;
    }
    let value = cleanValue(rule, input[field]);
    if (rule.required && (value === '' || value === null)) {
      if (partial) continue; // an update can't blank a required field — the old value is kept
      return { error: `${rule.label || field} is required` };
    }
    if (rule.type === 'email' || rule.type === 'phone') {
      const r = shared.rules[rule.type](input[field], {});
      if (r.error) return { error: r.error, fields: { [field]: r.error } };
      value = r.value; // normalised: lower-case email, +91XXXXXXXXXX mobile
    }
    data[field] = value;
  }
  return { data };
}

module.exports = { str, toInt, isEmail, sanitize };
