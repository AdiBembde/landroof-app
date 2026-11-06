# Landroof — Real Estate Super Platform

> Buy. Sell. Rent. Manage. Invest.

Landroof is a self-contained Node.js website for the Indian real estate market:

- a public site with listings and search,
- an admin panel (CMS) for listings, leads and website content,
- visitor accounts with saved properties.

It runs on any server with Node.js. There is no separate database server and no build step.

---

## Contents

1. [Features](#features)
2. [Quick start](#quick-start)
3. [Configuration](#configuration-env)
4. [Project structure (MVC)](#project-structure-mvc)
5. [How a request flows](#how-a-request-flows)
6. [Admin panel guide](#admin-panel-guide)
7. [API reference](#api-reference)
8. [Database](#database)
9. [Form validation](#form-validation)
10. [Authentication & authorization (JWT)](#authentication--authorization-jwt)
11. [Security](#security)
12. [SEO](#seo)
13. [Testing](#testing)
14. [Deployment](#deployment)
15. [Backups](#backups)
16. [Before you go live — checklist](#before-you-go-live--checklist)
17. [Troubleshooting](#troubleshooting)

---

## Features

### Public website (`/`)

| Feature | Details |
|---|---|
| Featured listings | Homepage grid of featured properties, with Buy / Rent / Plots / Commercial filter pills |
| Search | City, budget, BHK, property sub-type, furnishing (rent), plot/carpet area, buy-or-lease (commercial). All filtering happens on the server |
| Shareable search links | `/?type=rent&city=Pune` and `/?search=baner` open the matching listings (also used by the sitemap) |
| Explore by city | City cards show the **real** number of listings in each city |
| Property details | Photo, specs, RERA number, description and enquiry form. The EMI calculator appears only for properties being sold, not rentals |
| Saved properties ❤️ | Visitors save listings with the heart button and view them under **❤️ Saved**. Saved items stay on the device; once signed in they sync to the account |
| Visitor accounts | Register with **email confirmation**, sign in, **forgot / reset password** by email, change password, sign out on all devices. JWT-based; you stay signed in for up to 30 days. Passwords are stored as strong scrypt hashes |
| Forms | Property enquiry, List your property, Investment advisor, Contact us. Each one is saved as a **lead**. A failed send shows an error and never a false "success" |
| Admin-managed content | Announcement banner, special offers (hidden automatically after their end date), events, About + team, gallery, social posts, testimonials |
| Admin-managed numbers | Hero and stats-band counters, cities count, WhatsApp number, contact email and phone all come from **Admin → Site Numbers** |
| Footer | Every link works: listing types, services, About, Careers / Press / Contact (contact form with the subject filled in), Privacy Policy, Terms, RERA info |
| Privacy | Consent bar for optional analytics data, plus a Privacy Policy page |
| 404 page | Unknown URLs show a friendly page with a link back home |

### Admin panel (`/admin`)

| Section | What you can do |
|---|---|
| Dashboard | Total / featured listings, total leads, leads today, registered users, recent leads, leads by source |
| Properties | Add, edit, delete, photo upload (drag & drop), sub-type, featured flag, search and type filter |
| Leads | Every search and form submission, with device / IP / time zone. Search and **Export CSV** |
| Registered Users | Website accounts and how many properties each has saved |
| Testimonials | Add, edit, delete, star rating, show/hide |
| Team / Leadership | Add, edit, delete, photo, display order, show/hide (shown in **About** on the homepage) |
| Events | Add, edit, delete, date, location, photo, show/hide |
| Announcements | Top-of-site banner (Info / Promotion / Important style), show/hide |
| Schemes / Offers | Add, edit, delete, photo, "valid until" date, show/hide |
| Social Posts | Platform, link, caption, photo, show/hide |
| Media Gallery | Upload images with caption and category; edit or delete |
| Site Numbers | Counters, WhatsApp number, contact email and phone, shown live on the website |

---

## Quick start

**Requirements:** Node.js 18 or newer (check with `node --version`) and npm.

```bash
# 1. Install dependencies
npm install

# 2. Create your configuration
cp .env.example .env        # Windows: copy .env.example .env

# 3. Set at least ADMIN_PASS and SITE_URL in .env (see below)

# 4. Download the logo (one time)
npm run download-logo

# 5. Start
npm start
```

The server prints:

```
🏠 Landroof running at http://localhost:3000
🔧 Admin panel at http://localhost:3000/admin  (username: admin)
```

Open **http://localhost:3000** for the website and **http://localhost:3000/admin** for the admin panel.

On first start, an empty database is created and filled with sample listings, testimonials and team members. Replace them before going live.

### npm scripts

| Command | What it does |
|---|---|
| `npm start` | Start the server |
| `npm run dev` | Start and restart automatically when a file changes |
| `npm test` | Run the automated test suite (uses a temporary database) |
| `npm run download-logo` | Download the Landroof logo to `public/images/` |
| `npm run admin:2fa` | Set up 2-step login (authenticator app code) for the admin panel |

---

## Configuration (`.env`)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port the server listens on |
| `ADMIN_USER` | `admin` | Admin panel username |
| `ADMIN_PASS` | — | Admin panel password: at least 12 characters with letters and numbers. **In production the server refuses to start** with the old default or a weak password. Changing it signs every admin out |
| `ADMIN_TOTP_SECRET` | *(off)* | Turns on 2-step login for the admin panel. Create it with `npm run admin:2fa` |
| `JWT_SECRET` | *(auto in development)* | Secret that signs login tokens, at least 32 characters. **Required in production.** In development it's generated once and saved to `data/.jwt-secret`. Changing it signs everyone out |
| `ACCESS_TOKEN_TTL` | `15m` | How long a JWT access token is valid |
| `ADMIN_REFRESH_HOURS` | `12` | How long an admin stays signed in without re-entering the password |
| `USER_REFRESH_DAYS` | `30` | How long a visitor stays signed in |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | *(off)* | Outgoing email for account confirmation and password reset. **Without `SMTP_HOST`, emails are saved as `.html` files in `data/outbox`** (open them to click the links while developing) |
| `LEAD_RETENTION_DAYS` | `730` | Leads older than this are deleted automatically |
| `IP_RETENTION_DAYS` | `90` | IP address and browser details on leads are blanked after this |
| `PASSWORD_HASH_COST` | `17` | scrypt cost (2^N). Only lower it for tests |
| `SITE_URL` | `http://localhost:PORT` | Public address of the site, with no trailing slash. Used for canonical links, the sitemap and social previews |
| `DB_PATH` | `./data/landroof.db` | SQLite database file (created automatically) |
| `UPLOAD_DIR` | `./public/uploads` | Folder for uploaded photos (created automatically) |
| `NODE_ENV` | `development` | Use `production` on a live server; it caches pages and static files |
| `TRUST_PROXY` | `0` | Set to `1` behind nginx or a load balancer, so visitor IPs (used for rate limiting) are correct |
| `CORS_ORIGINS` | *(empty)* | Optional comma-separated list of other websites allowed to call the public API |

`.env` is ignored by git. Never commit real passwords.

---

## Project structure (MVC)

The code follows the **Model–View–Controller** pattern:

- **Models** own the data and business rules (SQL, validation, search logic).
- **Controllers** handle HTTP: they read the request, call models, and send a response.
- **Views** are the HTML pages. The browser JavaScript in `public/js` acts as the client-side controller for each view.
- **Routes** map URLs to controllers. **Middleware** handles cross-cutting work: auth, uploads, rate limiting, errors.

```
landroof-app/
├── server.js                      Entry point — starts the HTTP server (npm start)
├── api/index.js                   Entry point for Vercel (serverless)
├── vercel.json                    Vercel build / routing settings
├── src/
│   ├── app.js                     Builds the Express app: middleware, static files, routes, error handlers
│   ├── config/
│   │   ├── env.js                 Every environment setting in one place
│   │   ├── jwtSecret.js           Resolves the JWT signing secret
│   │   ├── database.js            Opens SQLite, creates tables, runs migrations
│   │   └── seed.js                Sample data for a new database + one-off data fixes
│   ├── models/                    ── MODEL ──
│   │   ├── Property.js            Listings + server-side search filters
│   │   ├── Lead.js                Lead capture, validation, stats, CSV export
│   │   ├── User.js                Visitor accounts, roles, token version, saved properties
│   │   ├── Admin.js               Admin credentials check + credential fingerprint
│   │   ├── RefreshToken.js        Hashed refresh tokens (rotation / revocation)
│   │   ├── UserToken.js           One-time email links (confirm email, reset password)
│   │   ├── AuditLog.js            Activity log of security events and admin changes
│   │   ├── SiteConfig.js          Site Numbers (whitelisted keys + validation)
│   │   ├── ContentModel.js        Generic model for simple content tables
│   │   └── content.js             Testimonial, TeamMember, Event, Announcement, Scheme, SocialPost, Media
│   ├── controllers/               ── CONTROLLER ──
│   │   ├── propertyController.js  Public listing search + admin CRUD
│   │   ├── leadController.js      Lead capture + admin list / CSV
│   │   ├── authController.js      Visitor register / login / refresh / logout / password / wishlist
│   │   ├── adminController.js     Admin login / refresh / logout, dashboard stats, users, site config
│   │   ├── contentController.js   One factory serving every content type
│   │   └── pageController.js      Renders views, robots.txt, sitemap.xml
│   ├── routes/
│   │   ├── api.js                 /api/*        public JSON API
│   │   ├── admin.js               /api/admin/*  admin JSON API (admin JWT required)
│   │   └── pages.js               /, /admin, /robots.txt, /sitemap.xml
│   ├── services/
│   │   ├── tokenService.js        Signs / verifies JWTs, issues / rotates refresh tokens, cookies
│   │   ├── mailer.js              Account emails (SMTP, or data/outbox when SMTP isn't set)
│   │   ├── totp.js                Authenticator codes for admin 2-step login (RFC 6238)
│   │   └── maintenance.js         Daily data retention + clean-up of expired tokens
│   ├── middleware/
│   │   ├── auth.js                authenticate(audience) + authorize(...roles)
│   │   ├── upload.js              Image uploads (type whitelist, safe file names)
│   │   ├── rateLimit.js           Rate limits stored in SQLite (survive restarts)
│   │   ├── security.js            CSP + security headers, same-origin check for cookie endpoints
│   │   └── errors.js              404 page + error handler (no stack traces leak)
│   ├── utils/
│   │   ├── validators.js          Schema-based input cleaning
│   │   └── files.js               Upload paths + safe file deletion
│   └── views/                     ── VIEW ──
│       ├── index.html             Public website
│       ├── admin.html             Admin panel
│       └── 404.html               Not-found page
├── public/                        Static files served as-is
│   ├── js/actions.js              Runs data-on-click="…" handlers (no inline JS, so a strict CSP works)
│   ├── css/site.css, admin.css
│   ├── js/site.js                 Public site behaviour (client-side controller)
│   ├── js/admin.js                Admin panel behaviour (client-side controller)
│   ├── images/landroof-logo.png
│   └── uploads/                   Uploaded photos (not in git)
├── shared/validation.js           Validation rules used by BOTH the browser and the server
├── scripts/download-logo.js
├── scripts/admin-2fa.js           Creates the admin 2-step login secret
├── test/app.test.js               End-to-end tests
├── test/admin-2fa.test.js         Admin 2-step login tests (separate process)
├── data/                          SQLite database (not in git)
├── .env.example
└── package.json
```

### Adding a new content type

Most content (testimonials, events, …) uses the generic `ContentModel` and `contentController`. To add one, for example "Blog posts":

1. Create the table in `src/config/database.js`.
2. Define the model in `src/models/content.js` (table, field schema, sort order, optional image field).
3. Register it in `src/routes/api.js` (public list) and `src/routes/admin.js` (CRUD).
4. Add a page to `src/views/admin.html` and an entry to `CONTENT` in `public/js/admin.js`. The add/edit form is generated from the field list.
5. Render it on the homepage in `public/js/site.js`.

---

## How a request flows

```
Browser ──► route (src/routes) ──► middleware (auth / upload / rate limit)
                                        │
                                        ▼
                                  controller ──► model ──► SQLite
                                        │
                                        ▼
                          JSON response  or  rendered view (HTML)
```

Example: a visitor searches for 2 BHK rentals in Pune.

1. `public/js/site.js` calls `GET /api/properties?type=rent&city=Pune&bhk=2 BHK`.
2. `routes/api.js` sends it to `propertyController.list`.
3. The controller calls `Property.search(req.query)`, which builds a parameterised SQL query.
4. The JSON result is rendered as cards in the browser, and the search is also recorded as a lead via `POST /api/leads`.

---

## Admin panel guide

- **Sign in** at `/admin` with `ADMIN_USER` / `ADMIN_PASS`. You stay signed in for 12 hours, even after a page reload; **Sign Out** ends the session. After 10 wrong passwords from one IP, that IP is blocked for 15 minutes; after 30 wrong attempts from anywhere, the admin account itself is locked for 15 minutes. See [Authentication & authorization](#authentication--authorization-jwt).
- **2-step login (recommended):** run `npm run admin:2fa`, add the key to an authenticator app (Google Authenticator, Microsoft Authenticator, Authy), put `ADMIN_TOTP_SECRET=…` in `.env` and restart. The login then asks for the 6-digit code; each code works once.
- **Activity Log** (sidebar → Security): every admin sign-in (including failed ones), every change made in the panel, lead exports, visitor account security events and privacy actions, with time, IP and browser. Kept for one year.
- **Delete a person's data** (Leads page): removes every lead and the website account for one email address, for privacy requests under India's DPDP Act. Single leads can also be deleted.
- **Show / hide:** every content item has a "Show on website" switch, so you can prepare content before publishing.
- **Sub-type:** set it on each property so the "Property Type" search filter matches it exactly.
- **Area:** write it in sq ft (e.g. `1,480 sq ft`) so the area filter works.
- **Furnishing:** for rentals, choose *Fully Furnished*, *Semi-Furnished* or *Unfurnished* as the status. This drives the Furnishing filter.
- **Offers** disappear from the website automatically after their *Valid Until* date.
- **WhatsApp:** enter the number with country code, digits only (e.g. `919876543210`). Leave it empty to hide the WhatsApp button.
- **Times** in the admin panel are shown in your local time zone. The database stores UTC.
- **Export CSV** downloads all leads. The file opens correctly in Excel, including ₹ signs.

---

## API reference

All responses are JSON: `{ "ok": true, "data": … }` on success, `{ "error": "message" }` on failure.

### Public

| Method | Path | Description |
|---|---|---|
| GET | `/api/properties` | Search listings. Query: `type`, `city`, `q`, `featured=1`, `ids=1,2,3`, `budget` (`min-max` or `min+`), `bhk` (`2 BHK`, `4+ BHK`), `area` (sq ft, `min-max` or `min+`), `subtype`, `furnishing`, `transaction` (`buy`/`lease`), `limit` (max 500) |
| GET | `/api/properties/:id` | One listing |
| GET | `/api/city-counts` | `{ "Pune": 5, … }` |
| GET | `/api/testimonials` `/api/team` `/api/events` `/api/announcements` `/api/schemes` `/api/social-posts` `/api/media` | Active content |
| GET | `/api/site-config` | Site Numbers |
| POST | `/api/leads` | Save a lead. All fields optional; `email` must be valid if given. Limited to 30 per IP per 10 minutes |

### Visitor auth (🔒 = requires `Authorization: Bearer <access token>` with role `user`)

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` | `{name, email, password, phone?, interest?}` → `202 {pending: true, message}`. The account must be confirmed via the emailed link before signing in. The answer is identical whether or not the email already has an account |
| POST | `/api/auth/login` | `{email, password}` → `{accessToken, expiresIn, user}` + refresh cookie |
| POST | `/api/auth/refresh` | Uses the `lr_rt` cookie → new `accessToken` + rotated cookie |
| POST | `/api/auth/logout` | Revokes the refresh cookie |
| POST 🔒 | `/api/auth/logout-all` | Signs the account out on every device |
| POST 🔒 | `/api/auth/change-password` | `{currentPassword, newPassword}` → new tokens; other devices are signed out |
| POST | `/api/auth/verify-email` | `{token}` from the emailed link → confirms the address and signs in |
| POST | `/api/auth/resend-verification` | `{email}` → always the same answer |
| POST | `/api/auth/forgot-password` | `{email}` → always the same answer; emails a 30-minute, single-use reset link if the account exists |
| POST | `/api/auth/reset-password` | `{token, password}` → sets the password, signs out other devices, signs in |
| GET 🔒 | `/api/auth/me` | Current user |
| GET / PUT 🔒 | `/api/wishlist` | Saved property IDs. PUT body: `{ids:[1,2]}` |

### Admin (everything except `/auth/*` requires `Authorization: Bearer <admin access token>` with role `admin`)

| Method | Path | Description |
|---|---|---|
| POST | `/api/admin/auth/login` | `{username, password}` → `{accessToken, expiresIn, user}` + refresh cookie |
| POST | `/api/admin/auth/refresh` | Uses the `lr_admin_rt` cookie → new `accessToken` + rotated cookie |
| POST | `/api/admin/auth/logout` | Revokes the refresh cookie |
| GET | `/api/admin/auth/me` | Current admin |
| GET | `/api/admin/audit` | Activity log. `?limit=200&action=admin.` filters by action prefix |
| POST | `/api/admin/privacy/erase` | `{email}` → deletes every lead and the account for that email |
| DELETE | `/api/admin/leads/:id` | Delete one lead |
| GET | `/api/admin/stats` | Dashboard numbers |
| GET | `/api/admin/leads` | `?limit=500`, `?csv=1` for a CSV download |
| GET | `/api/admin/users` | Registered visitors |
| GET / PUT | `/api/admin/site-config` | Read / update Site Numbers |
| GET, POST, PUT `/:id`, DELETE `/:id` | `/api/admin/properties` | Listings. POST and PUT accept multipart with an `image` file |
| GET, POST, PUT `/:id`, DELETE `/:id` | `/api/admin/{testimonials, team, events, announcements, schemes, social-posts, media}` | Content. JSON or multipart (`image` file). On PUT, `remove_image=1` removes the photo |

On updates, a field you **send** replaces the old value (including empty values and `0`), and a field you **leave out** stays unchanged. Required fields such as a title can't be blanked.

---

## Database

SQLite file at `DB_PATH`. Tables:

| Table | Purpose |
|---|---|
| `properties` | Listings (`subtype` and numeric `area_sqft` power the filters) |
| `leads` | Searches and form submissions |
| `users`, `wishlist` | Visitor accounts (with `role` and `token_version`) and saved properties |
| `refresh_tokens` | SHA-256 hashes of refresh tokens for admins and visitors, with expiry, revocation and rotation family |
| `user_tokens` | SHA-256 hashes of one-time email links (confirm email: 24 h, reset password: 30 min) |
| `audit_log` | Activity log (kept 1 year) |
| `rate_limits` | Rate-limit counters |
| `testimonials`, `team_members`, `events`, `announcements`, `schemes`, `social_posts`, `media_gallery` | Website content |
| `site_config` | Site Numbers (key/value) |

**Upgrades are automatic.** On start, `src/config/database.js` adds any missing columns and tables, and `src/config/seed.js` fixes known bad data. Databases from earlier versions keep all their data.

---

## Form validation

Every form is checked **twice with the same rules**: in the browser (instant messages under each field) and on the server (nothing invalid is ever saved). The rules live in one file, [shared/validation.js](shared/validation.js). The browser loads it from `/shared/validation.js` and the server `require`s it, so the two sides can never disagree.

| Field | Rule | Stored as |
|---|---|---|
| Mobile | Indian: 10 digits starting with 6–9; may be typed as `9876543210`, `098765 43210`, `+91 98765-43210` or `919876543210`. International: `+` and country code (8–15 digits). Letters, too-short numbers and fakes like `9999999999` are rejected | `+919876543210` |
| Email | `name@domain.tld`: no spaces, no leading or double dots, a real-looking domain ending, max 254 characters | trimmed, lower-case |
| Name | 2–80 characters; letters (any language), spaces, `.` `'` `-` | extra spaces removed |
| Password | 8–128 characters, at least one letter and one number, no spaces, not a common password (e.g. `password123`), must not contain the email name. Register shows a strength meter | scrypt hash |
| Message | Contact: 10–2000 characters; other forms up to 1000 | as typed |

Required fields per form:

| Form | Required | Optional |
|---|---|---|
| Register | name, email, password | mobile |
| Sign in | email, password | — |
| Change password | current password, new password (+ matching confirmation in the browser) | — |
| List your property | name, email, **mobile**, city from the list | description |
| Investment advisor | name, email | mobile |
| Contact us | name, email, message | mobile |
| Property enquiry | email | name, mobile, message |
| Search box | — | email |
| Admin → Team member | name, role | email, mobile (same rules) |

When the server rejects a form, it returns `400` with `{ "error": "first message", "fields": { "phone": "…", "email": "…" } }`, and the page shows each message under its field. To change a rule or a form's required fields, edit `shared/validation.js`; both sides pick it up.

---

## Authentication & authorization (JWT)

**Authentication** proves who is calling. **Authorization** decides what they may do.

### Tokens

| | Access token | Refresh token |
|---|---|---|
| Format | Signed JWT (HS256) | Random 64-character string |
| Lifetime | 15 minutes (`ACCESS_TOKEN_TTL`) | Admin 12 hours, visitor 30 days |
| Where the browser keeps it | In page memory only. Never in localStorage or sessionStorage | `httpOnly`, `SameSite=Strict` cookie (`Secure` when `SITE_URL` is https). JavaScript can't read it |
| Sent as | `Authorization: Bearer <jwt>` | Cookie, only to `/api/auth/*` (visitor) or `/api/admin/auth/*` (admin) |
| Stored on the server | Not stored (stateless) | Only as a SHA-256 hash in `refresh_tokens` |

JWT claims: `iss: "landroof"`, `aud` (`landroof-admin` or `landroof-web`), `sub` (admin username or user id), `role`, `exp`, `iat`, `jti`. Visitor tokens add `tv` (token version) and admin tokens add `pv` (credential fingerprint).

### Flow

```
Sign in ──► { accessToken (JWT) }  +  Set-Cookie: refresh token (httpOnly)
   │
   ├─ each API call:  Authorization: Bearer <JWT>  ──► authenticate ──► authorize(role) ──► controller
   │
   ├─ JWT expired (401 code "token_expired") ──► POST …/auth/refresh (cookie) ──► new JWT + new cookie ──► retry
   │
   └─ page reload: the JWT in memory is gone ──► POST …/auth/refresh ──► signed in again silently
```

The browser code (`public/js/site.js`, `public/js/admin.js`) does the refresh and retry automatically.

### Authorization rules

| Route group | Audience | Allowed roles | Middleware |
|---|---|---|---|
| `/api/admin/*` (except `/auth/login`, `/refresh`, `/logout`) | `landroof-admin` | `admin` | `requireAdmin` = `authenticate('admin')` + `authorize('admin')` |
| `/api/auth/me`, `/logout-all`, `/change-password`, `/api/wishlist` | `landroof-web` | `user` | `requireUser` = `authenticate('user')` + `authorize('user')` |
| Everything else under `/api` | — | public | — |

- A visitor token can't call admin routes and an admin token can't call visitor routes, because the audiences differ. A missing, invalid or expired token gets **401**; a valid token with the wrong role gets **403**.
- To protect a new route, add `requireAdmin` or `requireUser`. For a new role, use `authenticate('user'), authorize('agent')` and add the role to `User.ROLES`.

### Revocation

| Event | Effect |
|---|---|
| Sign out | That login's refresh token is revoked; the access token expires within 15 minutes |
| Refresh | The refresh token is **rotated**: the old one stops working |
| Old refresh token reused | Treated as theft: the whole login (token family) is revoked. Exception: within 30 seconds of a rotation, a second tab presenting the just-replaced token gets its own new token (so reloading several tabs at once doesn't log you out) |
| Visitor changes password / "Sign out on all devices" | `token_version` is bumped, so every existing JWT is rejected **immediately**, and all refresh tokens are revoked |
| `ADMIN_USER` / `ADMIN_PASS` changed | Every admin JWT and refresh token stops working (credential fingerprint) |
| `JWT_SECRET` changed | Every JWT stops working |

### Response codes

`401` responses include a `code`: `no_token`, `invalid_token`, `token_expired`, `token_revoked`, `invalid_credentials`, `no_refresh_token`, `invalid_refresh_token`, `refresh_token_reused` or `refresh_token_expired`. `403` responses have code `forbidden` (wrong role), `email_not_verified` (sign-in before confirming the email) or `cross_site` (blocked cross-site request).

---

## Security

| Area | Protection |
|---|---|
| Admin login | JWT + rotating httpOnly refresh cookie (see above); constant-time credential check; optional 2-step login (TOTP, single-use codes); lockout after 10 failures per IP **and** 30 failures account-wide per 15 minutes; production refuses a weak/default `ADMIN_PASS` |
| Activity log | Admin sign-ins (incl. failures), every admin change, lead exports, account security events and privacy actions are recorded with IP and browser |
| Visitor accounts | scrypt hashing at OWASP strength (N=2^17, async so the server isn't blocked; older hashes upgraded on sign-in); email confirmation before first sign-in; reset links are single-use, hashed and expire in 30 min; password change/reset emails the owner |
| Account enumeration | Register, resend-confirmation and forgot-password give identical answers for known and unknown emails; sign-in spends the same hashing time on unknown emails |
| Tokens & cookies | HS256 only (`alg: none` and other algorithms rejected); issuer and audience checked; refresh tokens hashed at rest; cookies are `HttpOnly`, `SameSite=Strict` and always `Secure` in production; sign-in / refresh / sign-out endpoints reject cross-site requests (Origin / Sec-Fetch-Site check); CORS never sends cookies to other origins |
| Cross-site scripting | All data is escaped before it's shown; numeric lead fields only accept numbers; **strict Content-Security-Policy** (`script-src 'self'`, no inline scripts or `eval`). Pages use `data-on-click="…"` attributes run by `public/js/actions.js`, which only calls functions the page registered — never `eval` |
| Uploads | Only JPG / PNG / WebP / GIF, checked by **file content (magic bytes)**, not just the declared type; the extension comes from the checked type, never from the uploaded name; 10 MB, one file, limited form fields; `X-Content-Type-Options: nosniff` |
| Errors | Visitors and API clients never see stack traces or file paths |
| Spam | Lead form limited to 30 submissions per IP per 10 minutes, with field length limits |
| SQL | Every query is parameterised |
| CSV export | Cells starting with `=`, `+`, `-` or `@` are neutralised (no spreadsheet formula injection) |
| Headers | Content-Security-Policy, `Strict-Transport-Security` (production + https), `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`; `X-Powered-By` removed |
| Privacy | Screen size, time zone, language and referrer are sent only if the visitor accepts analytics. IP / browser details are blanked after 90 days and leads deleted after 2 years (configurable). Admins can erase all data for an email. A Privacy Policy is linked from every form |
| Configuration | In production the server refuses to start with a default/weak `ADMIN_PASS` or without `JWT_SECRET`, and warns about a non-https `SITE_URL` or missing SMTP |

Rate-limit counters are stored in the SQLite database, so they survive restarts. Behind nginx or a load balancer set `TRUST_PROXY=1` (otherwise every visitor looks like the proxy's IP); without a proxy leave it at `0` (otherwise clients could fake their IP).

**Not handled by the app (do these on the server):** HTTPS certificates, firewall, OS updates, disk encryption for `data/` and backups, and off-site encrypted backups.

---

## SEO

- Canonical URL, Open Graph and structured data (JSON-LD) are filled from `SITE_URL` at request time.
- `/sitemap.xml` lists the homepage, every listing type, and every type + city combination that **has listings**. Each of those URLs opens the matching results.
- `/robots.txt` blocks `/api/` and `/admin` and allows photos.
- The admin panel sends `X-Robots-Tag: noindex`.

---

## Testing

```bash
npm test
```

There are 43 end-to-end tests. They start the app on a random port with a **temporary** database and upload folder, so your real data is never touched. They cover:

- pages, the 404 page, robots.txt and the sitemap;
- every search filter;
- form validation: mobile, email, name and password rules, and required fields per form;
- the XSS fix and CSV safety;
- JWT authentication: cookie flags; forged, tampered, `alg:none`, expired and wrong-audience tokens; refresh rotation and reuse detection; sign-out;
- authorization: 403 for the wrong role, and visitor and admin tokens can't be swapped;
- revocation on password change and on "sign out on all devices";
- email confirmation, password reset, account-enumeration resistance and password-hash upgrades;
- strict CSP (no inline handlers), cross-site request blocking, the upload content check;
- the activity log, right to erasure and data retention;
- the production start-up checks;
- admin 2-step login, the per-IP and account-wide login lockouts;
- create / update / delete for every content type;
- image upload rules and file clean-up;
- Site Numbers;
- visitor accounts and the wishlist.

---

## Deployment

```bash
# On the server
npm ci --omit=dev
cp .env.example .env    # set ADMIN_PASS, JWT_SECRET, SITE_URL=https://yourdomain.com, NODE_ENV=production, TRUST_PROXY=1
npm run download-logo

# Keep it running with pm2
npm install -g pm2
pm2 start server.js --name landroof
pm2 save && pm2 startup
```

Example nginx reverse proxy (add HTTPS with Let's Encrypt / certbot):

```nginx
server {
    server_name yourdomain.com;
    client_max_body_size 12M;           # allow 10 MB photo uploads
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Deploying on Vercel

The repo includes `vercel.json` and `api/index.js`, so Vercel can build and run it with no extra setup.

> ⚠️ **Important: on Vercel, data is NOT permanent.** Vercel runs the app as short-lived serverless functions with a temporary disk. The SQLite database and uploaded photos live in `/tmp`. They start from the sample data on each new instance, and are **lost** when Vercel recycles it (often within minutes or hours), on every new deploy, and they differ between instances. New leads, registered users and anything changed in the admin panel will disappear.
>
> Use Vercel for a **demo / preview**. For the real site, either deploy to a host with a permanent disk (Render, Railway, Fly.io or a VPS: see above), or move the data to a hosted database (e.g. Neon / Vercel Postgres) and photos to Vercel Blob.

Steps:

1. Push the code to GitHub (`main` branch).
2. On [vercel.com](https://vercel.com) → **Add New… → Project** → import `landroof-app`. Framework preset: **Other**. Leave build/output settings as they are (`vercel.json` sets them).
3. Under **Environment Variables**, add:

   | Name | Value |
   |---|---|
   | `ADMIN_USER` | `admin` (or your choice) |
   | `ADMIN_PASS` | a strong password: **12+ characters with letters and numbers** (simple ones like `admin123` are rejected and the site won't start) |
   | `JWT_SECRET` | 64+ random characters: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
   | `SITE_URL` | your Vercel URL, e.g. `https://landroof-app.vercel.app` (no trailing slash) |
   | `SMTP_*`, `MAIL_FROM` | optional: needed for confirmation / reset emails to be sent |

   Do **not** copy `DB_PATH`, `UPLOAD_DIR` or `PORT` from your local `.env`: Vercel's project folder is read-only, so the app always uses `/tmp` there and Vercel picks the port.

4. Click **Deploy**. Vercel sets `NODE_ENV=production` automatically, which turns on HTTPS-only cookies and HSTS. The proxy setting (`TRUST_PROXY`) is turned on automatically on Vercel.

Vercel limits: request bodies are capped at **4.5 MB**, so photos larger than that can't be uploaded there (the app itself allows 10 MB). Without SMTP, emails are written to the temporary disk and can't be opened, so visitor registration can't be confirmed. Set up SMTP for that to work.

---

## Backups

Back up two things: the database (`data/`) and the uploaded photos (`public/uploads/`).

A safe online backup of the database, which works while the server is running:

```bash
node -e "const D=require('better-sqlite3');new D('data/landroof.db').backup('data/backup-'+new Date().toISOString().slice(0,10)+'.db').then(()=>console.log('done'))"
```

---

## Before you go live — checklist

- [ ] Set a strong `ADMIN_PASS` in `.env` (12+ characters; production refuses weak ones).
- [ ] Turn on admin 2-step login: `npm run admin:2fa`.
- [ ] Configure `SMTP_*` so confirmation and reset emails are really sent.
- [ ] Set `JWT_SECRET` to a long random value (the server refuses to start in production without it).
- [ ] Serve the site over **HTTPS** with an `https://` `SITE_URL`, so login cookies get the `Secure` flag.
- [ ] Set `SITE_URL` to your real domain and `NODE_ENV=production`.
- [ ] Delete or replace the **sample** listings, testimonials and team members. They are placeholders, not real people or reviews.
- [ ] In **Site Numbers**, set your real figures (listings, cities, clients, satisfaction), WhatsApp number and contact email.
- [ ] Review the Privacy Policy and Terms text in `src/views/index.html` (templates `info-privacy`, `info-terms`) with your legal advisor.
- [ ] Add real photos to listings.
- [ ] Set up HTTPS and daily backups.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `EADDRINUSE: address already in use :::3000` | Another copy is already running. Stop it, or set a different `PORT` |
| Logo shows as text "LANDROOF" | Run `npm run download-logo` |
| "Too many failed login attempts" | Wait 15 minutes or restart the server |
| Registered but no email arrived | Without `SMTP_HOST` emails are saved in `data/outbox` — open the newest `.html` file and click the link. With SMTP, check the spam folder and the server log |
| `Unsafe production configuration` on start | Production needs a strong `ADMIN_PASS` (12+ chars, letters and numbers) and a `JWT_SECRET` — the message lists what's missing |
| "The admin account is temporarily locked" | 30+ failed admin logins in 15 minutes (from any IP). Wait 15 minutes; check the Activity Log for who tried |
| Lost the authenticator phone | Remove `ADMIN_TOTP_SECRET` from `.env`, restart, sign in, then run `npm run admin:2fa` again |
| Admin panel keeps asking to sign in | The 12-hour login ended, or `ADMIN_PASS` / `JWT_SECRET` changed. Sign in again. Browsers must allow cookies for the site |
| `JWT_SECRET is not set` on start | Add `JWT_SECRET` (32+ characters) to `.env`. It's required when `NODE_ENV=production` |
| Everyone was signed out after a deploy | `JWT_SECRET` changed, or `data/.jwt-secret` was deleted (development). Set a fixed `JWT_SECRET` in `.env` |
| Area search doesn't find a property | Make sure its Area is written in sq ft, e.g. `2,500 sq ft` |
| `better-sqlite3` install error | Install build tools (Windows: "Desktop development with C++"; Linux: `build-essential python3`) and run `npm install` again |
