require('dotenv').config();

(async () => {
  try {
    const { getAuthToken } = require('@heyputer/puter.js/src/init.cjs');
    const token = await getAuthToken();
    console.log('\nPUTER_AUTH_TOKEN=');
    console.log(token);
    console.log('\nCopy the token above into server/.env as PUTER_AUTH_TOKEN=<token>');
  } catch (err) {
    console.error('Failed to get Puter auth token:', err);
    process.exit(1);
  }
})();
