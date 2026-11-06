/*
 * Landroof validation rules — ONE copy shared by the browser and the server.
 *
 *   Browser: <script src="/shared/validation.js"></script>  → window.LRValidation
 *   Server:  require('../../shared/validation')
 *
 * Every rule returns { value } (cleaned/normalised) or { error } (message for the user).
 * FORMS describes every website form; validateForm(FORMS.x, data) checks a whole form and
 * returns { values, errors } where errors maps field name → message.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LRValidation = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // local@domain.tld — no spaces, no leading/trailing/double dots, real-looking TLD
  var EMAIL_RE = /^(?!\.)(?!.*\.\.)[A-Za-z0-9._%+'-]+(?<!\.)@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}$/;
  var NAME_RE = /^[\p{L}][\p{L}\p{M} .'-]*$/u;
  var COMMON_PASSWORDS = ['password', 'password1', 'password123', '12345678', '123456789', '1234567890',
    'qwerty123', 'qwertyuiop', 'abc12345', 'abcd1234', 'iloveyou1', 'welcome1', 'welcome123', 'admin123',
    'letmein1', 'india123', 'landroof1', 'landroof123', 'passw0rd', 'test1234', '11111111', '00000000'];

  function str(v) { return v === undefined || v === null ? '' : String(v); }
  function ok(value) { return { value: value }; }
  function fail(error) { return { error: error }; }

  // ── Field rules ─────────────────────────────────────────────────────────
  function email(v, o) {
    o = o || {};
    var s = str(v).trim().toLowerCase();
    if (!s) return o.required ? fail('Please enter your email address') : ok('');
    if (s.length > 254) return fail('Email address is too long');
    if (/\s/.test(s)) return fail('Email address cannot contain spaces');
    if (s.indexOf('@') === -1) return fail('Email address must contain @, e.g. name@example.com');
    if (!EMAIL_RE.test(s)) return fail('Please enter a valid email address, e.g. name@example.com');
    return ok(s);
  }

  /**
   * Mobile numbers. Indian numbers may be typed as 9876543210, 09876543210, 919876543210 or
   * +91 98765-43210 and are stored as +919876543210. Other countries need a leading +.
   */
  function phone(v, o) {
    o = o || {};
    var raw = str(v).trim();
    if (!raw) return o.required ? fail('Please enter your mobile number') : ok('');
    if (/[^\d+\-\s().]/.test(raw)) return fail('Mobile number can only contain digits, e.g. 9876543210');
    var compact = raw.replace(/[\s\-().]/g, '');
    var plus = compact.charAt(0) === '+';
    var digits = plus ? compact.slice(1) : compact;
    if (digits.indexOf('+') !== -1 || !digits) return fail('Please enter a valid mobile number');

    var local = null;
    if (!plus && digits.length === 10) local = digits;
    else if (!plus && digits.length === 11 && digits.charAt(0) === '0') local = digits.slice(1);
    else if (digits.length === 12 && digits.slice(0, 2) === '91') local = digits.slice(2);

    if (local !== null) {
      if (!/^[6-9]\d{9}$/.test(local)) return fail('Indian mobile numbers have 10 digits and start with 6, 7, 8 or 9');
      if (/^(\d)\1{9}$/.test(local) || local === '9876543210' || local === '9123456789') return fail('Please enter your real mobile number');
      return ok('+91' + local);
    }
    if (plus && /^[1-9]\d{7,14}$/.test(digits)) return ok('+' + digits); // international (E.164)
    if (!plus && digits.length < 10) return fail('Mobile number is too short — it needs 10 digits');
    return fail('Please enter a valid 10-digit mobile number, or + and country code for international numbers');
  }

  function name(v, o) {
    o = o || {};
    var s = str(v).trim().replace(/\s+/g, ' ');
    var label = o.label || 'Name';
    if (!s) return o.required ? fail('Please enter your ' + label.toLowerCase()) : ok('');
    if (s.length < 2) return fail(label + ' must be at least 2 characters');
    if (s.length > 80) return fail(label + ' must be 80 characters or fewer');
    if (!NAME_RE.test(s)) return fail(label + ' can only contain letters, spaces, dots, apostrophes and hyphens');
    return ok(s);
  }

  function password(v, o) {
    o = o || {};
    var s = str(v);
    if (!s) return fail('Please enter a password');
    if (s.length < 8) return fail('Password must be at least 8 characters');
    if (s.length > 128) return fail('Password must be 128 characters or fewer');
    if (/\s/.test(s)) return fail('Password cannot contain spaces');
    if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) return fail('Password must include at least one letter and one number');
    if (COMMON_PASSWORDS.indexOf(s.toLowerCase()) !== -1) return fail('This password is too common — please choose another');
    var local = str(o.email).split('@')[0].toLowerCase();
    if (local.length >= 4 && s.toLowerCase().indexOf(local) !== -1) return fail('Password must not contain your email name');
    return ok(s);
  }

  /** For sign-in: only checks that something was typed (the real check is the server's) */
  function passwordEntered(v) {
    var s = str(v);
    if (!s) return fail('Please enter your password');
    if (s.length > 128) return fail('Password is incorrect');
    return ok(s);
  }

  /** 0 (empty) … 4 (strong) — for the strength meter only */
  function passwordStrength(v) {
    var s = str(v);
    if (!s) return 0;
    var score = 0;
    if (s.length >= 8) score++;
    if (s.length >= 12) score++;
    if (/[a-z]/.test(s) && /[A-Z]/.test(s)) score++;
    if (/\d/.test(s) && /[^A-Za-z0-9]/.test(s)) score++;
    if (password(s).error) score = Math.min(score, 1);
    return Math.max(score, 1);
  }

  function text(v, o) {
    o = o || {};
    var s = str(v).trim();
    var label = o.label || 'This field';
    if (!s) return o.required ? fail(o.requiredMessage || 'Please fill in ' + label.toLowerCase()) : ok('');
    if (o.min && s.length < o.min) return fail(label + ' must be at least ' + o.min + ' characters');
    if (o.max && s.length > o.max) return fail(label + ' must be ' + o.max + ' characters or fewer');
    return ok(s);
  }

  function choice(v, o) {
    var s = str(v).trim();
    if (!s) return o.required ? fail('Please choose ' + (o.label || 'an option').toLowerCase()) : ok('');
    if (o.values.indexOf(s) === -1) return fail('Please choose a valid ' + (o.label || 'option').toLowerCase());
    return ok(s);
  }

  var RULES = { email: email, phone: phone, name: name, password: password, passwordEntered: passwordEntered, text: text, choice: choice };

  // ── Forms ───────────────────────────────────────────────────────────────
  // field: [ruleName, options]. Options may be a function(data) for rules that depend on other fields.
  var CITIES = ['Pune', 'Mumbai', 'Bangalore', 'Hyderabad', 'Delhi NCR', 'Chennai', 'Ahmedabad', 'Kolkata', 'Nagpur'];
  var FORMS = {
    register: {
      name:     ['name', { required: true, label: 'Full name' }],
      email:    ['email', { required: true }],
      password: ['password', function (d) { return { email: d.email }; }],
      phone:    ['phone', {}],
      interest: ['choice', { values: ['buy', 'rent', 'sell', 'invest', 'management'], label: 'Interest' }],
    },
    login: {
      email:    ['email', { required: true }],
      password: ['passwordEntered', {}],
    },
    changePassword: {
      currentPassword: ['passwordEntered', {}],
      newPassword:     ['password', function (d) { return { email: d.email }; }],
    },
    forgotPassword: {
      email: ['email', { required: true }],
    },
    resetPassword: {
      password: ['password', function (d) { return { email: d.email }; }],
    },
    // Lead forms (POST /api/leads) — keyed by the lead "source"
    'search': {
      phone: ['phone', { required: true }],
    },
    'property-enquiry': {
      name:    ['name', {}],
      email:   ['email', { required: true }],
      phone:   ['phone', {}],
      message: ['text', { max: 1000, label: 'Message' }],
    },
    'list-property': {
      name:        ['name', { required: true, label: 'Name' }],
      email:       ['email', { required: true }],
      phone:       ['phone', { required: true }],
      search_city: ['text', { max: 80, label: 'City' }], // cities come from the admin Cities list
      message:     ['text', { max: 1000, label: 'Description' }],
    },
    'investment-enquiry': {
      name:  ['name', { required: true, label: 'Name' }],
      email: ['email', { required: true }],
      phone: ['phone', {}],
    },
    'site-visit': {
      name:    ['name', { required: true, label: 'Name' }],
      email:   ['email', { required: true }],
      phone:   ['phone', { required: true }],
      message: ['text', { max: 1000, label: 'Message' }],
    },
    // "Tell me when a matching property is listed" on an empty search
    'search-alert': {
      email: ['email', { required: true }],
    },
    'contact': {
      name:    ['name', { required: true, label: 'Name' }],
      email:   ['email', { required: true }],
      phone:   ['phone', {}],
      message: ['text', { required: true, min: 10, max: 2000, label: 'Message', requiredMessage: 'Please write your message' }],
    },
  };

  function validateField(form, field, data) {
    var spec = form[field];
    var opts = typeof spec[1] === 'function' ? spec[1](data || {}) : spec[1];
    return RULES[spec[0]]((data || {})[field], opts);
  }

  function validateForm(form, data) {
    var values = {}, errors = {}, valid = true;
    Object.keys(form).forEach(function (field) {
      var r = validateField(form, field, data);
      if (r.error) { errors[field] = r.error; valid = false; }
      else values[field] = r.value;
    });
    return { valid: valid, values: values, errors: errors };
  }

  return {
    rules: RULES,
    FORMS: FORMS,
    CITIES: CITIES,
    validateField: validateField,
    validateForm: validateForm,
    passwordStrength: passwordStrength,
  };
});
