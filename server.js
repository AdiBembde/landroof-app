'use strict';
// Entry point — starts the Landroof web server. The application itself lives in src/.
const app = require('./src/app');
const { PORT, ADMIN_USER } = require('./src/config/env');

app.listen(PORT, () => {
  console.log(`\n🏠 Landroof running at http://localhost:${PORT}`);
  console.log(`🔧 Admin panel at http://localhost:${PORT}/admin  (username: ${ADMIN_USER})\n`);
});
