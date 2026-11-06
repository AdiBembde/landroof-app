'use strict';
// Builds the Express application (without starting it — see server.js).
const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const env = require('./config/env');
const seed = require('./config/seed');
const { securityHeaders } = require('./middleware/security');
const { notFound, errorHandler } = require('./middleware/errors');

require('./config/startupChecks').runStartupChecks();
seed();
require('./services/maintenance').startMaintenance();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', env.TRUST_PROXY);

app.use(securityHeaders);
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: true, limit: '200kb' }));
app.use(cookieParser());

// Other origins may call the API with a Bearer token, but never with cookies (credentials: false),
// so the refresh-token cookie can only be used by this site itself.
if (env.CORS_ORIGINS.length) app.use('/api', cors({ origin: env.CORS_ORIGINS, credentials: false }));

// Static assets (CSS, JS, images) and uploaded photos
app.use('/uploads', express.static(env.UPLOAD_DIR, { maxAge: '7d' }));
app.use(express.static(path.join(env.ROOT, 'public'), { index: false, maxAge: env.NODE_ENV === 'production' ? '1d' : 0 }));
// Validation rules used by both the browser and the server
app.use('/shared', express.static(path.join(env.ROOT, 'shared'), { index: false }));
// Map library (Leaflet) for the map search and location pins
app.use('/vendor/leaflet', express.static(path.join(env.ROOT, 'node_modules', 'leaflet', 'dist'), { index: false, maxAge: '7d' }));

// Routes
app.use('/api/admin', require('./routes/admin'));
app.use('/api', require('./routes/api'));
app.use('/', require('./routes/pages'));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
