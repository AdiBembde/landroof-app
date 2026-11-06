'use strict';
const Lead = require('../models/Lead');
const ListingRequest = require('../models/ListingRequest');
const Mailer = require('../services/mailer');
const { adminEmail } = require('../services/notify');
const { City } = require('../models/content');

// POST /api/leads — search, enquiry, list-property, investment and contact forms
exports.create = (req, res) => {
  const { data, error, fields } = Lead.validate(req.body);
  if (error) return res.status(400).json({ error, fields });
  // "List your property": the city must be one of the cities on the website (admin Cities page)
  if (data.source === 'list-property' && data.search_city) {
    const known = City.allPublic().map(c => c.name.toLowerCase());
    if (known.length && !known.includes(data.search_city.toLowerCase())) {
      return res.status(400).json({ error: 'Please choose a city from the list', fields: { search_city: 'Please choose a city from the list' } });
    }
  }
  Lead.create(data, { ip: req.ip, userAgent: req.headers['user-agent'] });
  // "List your property" also opens a request the admin approves or rejects
  if (data.source === 'list-property') {
    const { request, existing } = ListingRequest.submit({
      name: data.name, email: data.email, phone: data.phone, city: data.search_city, type: data.search_type, message: data.message,
    });
    if (!existing) Mailer.listingRequestReceived(adminEmail(), request);
    return res.json({ ok: true, message: 'Lead saved', listing: { status: request.status, existing } });
  }
  res.json({ ok: true, message: 'Lead saved' });
};

// GET /api/admin/leads?limit=500&csv=1
exports.adminList = (req, res) => {
  const rows = Lead.list(req.query.limit);
  if (req.query.csv === '1') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="landroof-leads.csv"');
    return res.send('﻿' + Lead.toCSV(rows)); // BOM so Excel shows ₹ correctly
  }
  res.json({ ok: true, data: rows, total: rows.length });
};
