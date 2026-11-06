'use strict';
// Where admin notifications (new listing requests, listings waiting for review) are sent:
// the address from Email Settings (or ADMIN_EMAIL in .env), otherwise the contact email from Site Numbers.
const SiteConfig = require('../models/SiteConfig');
const MailSettings = require('../models/MailSettings');

exports.adminEmail = () => MailSettings.current().admin_email || SiteConfig.getAll().contact_email || '';
