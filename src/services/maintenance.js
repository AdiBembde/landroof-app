'use strict';
// Daily housekeeping: personal-data retention, removal of expired security records, and listings
// whose end date passed (they leave the search and are marked expired).
const env = require('../config/env');
const Lead = require('../models/Lead');
const UserToken = require('../models/UserToken');
const RefreshToken = require('../models/RefreshToken');
const AuditLog = require('../models/AuditLog');
const Property = require('../models/Property');
const ListingEvent = require('../models/ListingEvent');

function runMaintenance() {
  try {
    const { deleted, anonymised } = Lead.applyRetention(env.LEAD_RETENTION_DAYS, env.IP_RETENTION_DAYS);
    UserToken.purge();
    RefreshToken.purge();
    AuditLog.purge(365);
    Property.expireOld().forEach(id => ListingEvent.record(id, 'system', 'listing.status', { from: 'active', to: 'expired', note: 'End date reached' }));
    if (deleted || anonymised) {
      AuditLog.record({ actor: 'system', action: 'privacy.retention', details: { deleted, anonymised } });
    }
  } catch (e) {
    console.error('Maintenance failed:', e.message);
  }
}

function startMaintenance() {
  runMaintenance();
  setInterval(runMaintenance, 24 * 3600e3).unref();
}

module.exports = { runMaintenance, startMaintenance };
